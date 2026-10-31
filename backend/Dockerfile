FROM python:3.12-slim

WORKDIR /app

# Dipendenze di sistema minime (nessuna, per ora — niente build tool
# non necessari, coerente con "non introdurre dipendenze non necessarie")
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir ".[dev]"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
