"""Defense in depth: tenant predicates on ORM reads/DML and immutable ownership."""
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, with_loader_criteria

from app.core.identity import identity, owner_id
from app.db.models import Conversation, Message, Memory, MemoryVector, Run, ToolAction, Schedule, OwnedRecord

OWNED = (Conversation, Message, Memory, MemoryVector, Run, ToolAction, Schedule)


@event.listens_for(Session, "do_orm_execute")
def restrict_owner(execute_state):
    if execute_state.session.info.get("system"):
        return
    if execute_state.is_select or execute_state.is_update or execute_state.is_delete:
        current = owner_id()
        for model in OWNED:
            execute_state.statement = execute_state.statement.options(with_loader_criteria(model, model.owner_id == current, include_aliases=True))


@event.listens_for(Session, "before_flush")
def enforce_owner(session, flush_context, instances):
    if session.info.get("system"):
        return
    current = owner_id()
    for record in session.new:
        if isinstance(record, OwnedRecord):
            if identity.get() is None or (record.owner_id is not None and record.owner_id != current):
                raise PermissionError("Proprietario non autorizzato")
            record.owner_id = current
    for record in set(session.dirty) | set(session.deleted):
        if isinstance(record, OwnedRecord):
            if record.owner_id != current or inspect(record).attrs.owner_id.history.has_changes():
                raise PermissionError("La proprietà del dato non può essere modificata")


def owned_get(db, model, record_id):
    # Unlike Session.get, this always checks SQL tenant predicates even when an
    # object happens to be present in the identity map.
    return db.query(model).filter(model.id == record_id).first()
