# WHY: python:3.12-slim has no build tools — reduces final image size by ~200 MB vs full python:3.12.
FROM python:3.12-slim

WORKDIR /app

# WHY: Install curl so Docker health check `curl -f http://localhost:8000/health` works.
# ALTERNATIVE: Use Python urllib in health check. TRADEOFF: Heavier CMD, harder to read.
# WHY: tesseract-ocr is the OCR engine for Layer 2 (image-based PDFs).
# tesseract-ocr-tur is the Turkish language pack — without it Tesseract uses
# English-only character recognition and misreads Turkish characters (ş, ğ, ı, ö, ü, ç).
# libgl1 and libglib2.0-0 are runtime deps required by pymupdf (fitz) for PDF rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tesseract-ocr \
    tesseract-ocr-tur \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# WHY: Copy requirements before source code so Docker caches the pip install layer.
# If only source changes, Docker reuses the cached dep layer — much faster rebuilds.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# WHY: --reload watches for file changes — enables hot reload when ./backend is mounted as a volume.
# ALTERNATIVE: Remove --reload in production. TRADEOFF: --reload adds ~50 MB memory overhead.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
