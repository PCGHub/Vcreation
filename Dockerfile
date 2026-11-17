FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    VCREATION_DATABASE=/data/storage/studio.sqlite3 \
    VCREATION_ENABLE_PAID_GENERATION=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home vcreation

WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      PIP_CERT=/run/secrets/build_ca pip install --no-cache-dir -r requirements.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi
COPY app ./app

# Every runtime directory, including legacy editor files, lives on one volume.
RUN mkdir -p /data/static /data/storage \
    && ln -s /data/static /app/static \
    && ln -s /data/storage /app/storage \
    && chown -R vcreation:vcreation /data /app

USER vcreation
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/', timeout=4)"

# The local SQLite/job queue needs one process, one instance and persistent disk.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers 1"]
