"""
Configurazione del logging applicativo.

Principio di osservabilità (costituzione NATHION §3.7): ogni richiesta
e ogni chiamata a un provider LLM deve lasciare una traccia leggibile.
"""
import logging
import sys

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    # Evita handler duplicati sui reload di uvicorn
    root.handlers.clear()
    root.addHandler(handler)

    # Riduce il rumore delle librerie terze
    logging.getLogger("httpx").setLevel("WARNING")
    logging.getLogger("uvicorn.access").setLevel("WARNING")
