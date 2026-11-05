"""Request identity propagated to tasks; anonymous HTTP scopes fail closed."""
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class Principal:
    id: str = "owner"
    username: str = "mattia"
    display_name: str = "Mattia"
    role: str = "admin"
    hosted_access: bool = True
    allowed_models: tuple[str, ...] = ()
    daily_limit: int = 50
    must_change_password: bool = False
    operator: bool = False
    session_hash: str = ""

    @property
    def is_admin(self):
        return self.role == "admin"


# Outside HTTP, trusted startup/tests/scheduler operate on the instance owner.
# Middleware explicitly sets None for unauthenticated requests.
identity: ContextVar[Principal | None] = ContextVar("identity", default=Principal())
database_provider: ContextVar[object | None] = ContextVar("database_provider", default=None)


def owner_id():
    principal = identity.get()
    return principal.id if principal else "__anonymous__"


def preference_key(key: str):
    owner = owner_id()
    return key if owner == "owner" else f"user:{owner}:{key}"
