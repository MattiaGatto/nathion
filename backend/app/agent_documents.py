"""Local source extraction and bounded retrieval for an individual agent."""
import io
import json
import re
from collections import Counter
from pathlib import PurePath
from xml.etree import ElementTree
from zipfile import ZipFile

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.identity import preference_key
from app.db.models import AppSettings

MAX_BYTES = 8 * 1024 * 1024
MAX_TEXT = 300_000
MAX_DOCUMENTS = 24
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
COMMON = set("della delle degli nello nelle questo questa questi quale quali come sono cosa puoi devo voglio agente documento richiesta the with from what this that about".split())


def extract_text(filename: str, content: bytes) -> str:
    suffix = PurePath(filename).suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted or len(reader.pages) > 100:
            raise ValueError("Usa un PDF senza password con al massimo 100 pagine.")
        pages = []
        length = 0
        for page in reader.pages:
            stream = page.get_contents()
            if stream and len(stream.get_data()) > MAX_BYTES:
                raise ValueError("Il contenuto di una pagina PDF è troppo grande.")
            text = page.extract_text()
            length += len(text)
            if length > MAX_TEXT:
                raise ValueError("Il documento supera 300.000 caratteri. Dividilo in più file.")
            pages.append(text)
        text = "\n\n".join(pages)
    elif suffix == ".docx":
        with ZipFile(io.BytesIO(content)) as archive:
            entry = archive.getinfo("word/document.xml")
            if entry.file_size > MAX_BYTES:
                raise ValueError("Il contenuto del documento Word è troppo grande.")
            raw = archive.read(entry)
        # DOCX main document XML has no DTD. Reject declarations before parsing.
        if b"<!DOCTYPE" in raw.upper().replace(b"\x00", b""):
            raise ValueError("Documento Word non supportato.")
        root = ElementTree.fromstring(raw)
        text = "\n".join("".join(t.text or "" for t in p.iter(WORD_NS + "t"))
                         for p in root.iter(WORD_NS + "p"))
    elif suffix in {".txt", ".md", ".csv"}:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("Salva il file di testo con codifica UTF-8.") from exc
    else:
        raise ValueError("Formati supportati: PDF con testo, DOCX, TXT, Markdown e CSV.")
    text = text.replace("\x00", "").strip()
    if not text:
        raise ValueError("Nessun testo estraibile. Per un PDF scansionato, usa prima l’OCR.")
    if len(text) > MAX_TEXT:
        raise ValueError("Il documento supera 300.000 caratteri. Dividilo in più file.")
    return text


def document_prefix(agent_id: str) -> str:
    return preference_key(f"agent:{agent_id}:doc:")


def documents(db: Session, agent_id: str) -> list[AppSettings]:
    return (db.query(AppSettings).filter(AppSettings.key.startswith(document_prefix(agent_id), autoescape=True))
            .order_by(AppSettings.updated_at.desc()).all())


def document_info(row: AppSettings) -> dict:
    data = json.loads(row.value)
    return {"id": row.key.rsplit(":", 1)[-1], "name": data["name"], "characters": len(data["text"]),
            "preview": data["text"][:320]}


def terms(text: str) -> Counter:
    return Counter(word for word in re.findall(r"[^\W_]+", text.casefold()) if len(word) >= 3 and word not in COMMON)


def relevant_excerpts(sources: list[dict], query: str) -> list[dict]:
    query_terms = set(terms(query))
    if not query_terms:
        return []
    ranked = []
    for source in sources:
        words = source["text"].split()
        start = 0
        while start < len(words):
            end = start
            size = 0
            while end < len(words) and size + len(words[end]) < 650:
                size += len(words[end]) + 1
                end += 1
            excerpt = " ".join(words[start:end]) if end > start else words[start][:650]
            counts = terms(excerpt)
            score = sum(2 + min(counts[word], 3) for word in query_terms & counts.keys())
            if score:
                ranked.append((score, source["name"], excerpt))
            start = max(end - 10, start + 1) if end < len(words) else end
    results = []
    for _, name, excerpt in sorted(ranked, key=lambda entry: entry[0], reverse=True):
        if any(item["source"] == name for item in results):
            continue
        results.append({"source": name, "excerpt": excerpt})
        if len(results) == 4:
            break
    return results
