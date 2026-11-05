FROM python:3.12-slim

WORKDIR /app
ARG NATHION_EXTRAS=mcp

# Dipendenze di sistema minime (nessuna, per ora — niente build tool
# non necessari, coerente con "non introdurre dipendenze non necessarie")
COPY pyproject.toml constraints.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -c constraints.txt ".[${NATHION_EXTRAS}]"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
