# BETON INDUSTRY — production image (Railway yoki istalgan Docker hosting).
# Bitta konteyner: FastAPI API + frontend statik fayllari + yuklangan rasmlar (/data/uploads).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Ilova root huquqisiz ishlaydi (entrypoint.sh "app" foydalanuvchisiga o'tadi)
RUN groupadd --system app && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

# Avval faqat paketlar — kod o'zgarganda bu qatlam keshdan olinadi
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY frontend frontend
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 0755 /usr/local/bin/entrypoint.sh \
    && mkdir -p /data/uploads \
    && chown -R app:app /data \
    && find /app -name "*.pyc" -delete

ENV APP_ENV=production \
    UPLOAD_DIR=/data/uploads \
    SERVE_FRONTEND=true \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % os.environ.get('PORT', '8000'), timeout=4)" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
