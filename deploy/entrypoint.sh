#!/bin/sh
# Konteyner ishga tushganda:
#  1) rasmlar papkasini tayyorlaydi (Railway Volume root egasi bilan ulanadi — huquqni to'g'rilaymiz)
#  2) root'dan "app" foydalanuvchisiga o'tadi
#  3) baza migratsiyalarini qo'llaydi (alembic upgrade head)
#  4) uvicorn'ni proksi sarlavhalarini hisobga olgan holda ishga tushiradi
set -eu

cd /app/backend

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "$UPLOAD_DIR"

if [ "$(id -u)" = "0" ]; then
    chown -R app:app "$UPLOAD_DIR" 2>/dev/null || echo "Ogohlantirish: $UPLOAD_DIR egasini o'zgartirib bo'lmadi"
    AS_APP="setpriv --reuid=app --regid=app --init-groups"
else
    AS_APP=""
fi

echo "[entrypoint] Baza migratsiyalari qo'llanmoqda..."
$AS_APP python -m alembic upgrade head

# Birinchi administrator: faqat ADMIN_USERNAME/ADMIN_PASSWORD berilgan va admin hali yo'q bo'lsa yaratiladi
$AS_APP python -m app.cli bootstrap-admin || true

# WEB_CONCURRENCY — uvicorn jarayonlari soni. Eslatma: so'rovlar cheklovi (rate limit) har bir
# jarayonda alohida hisoblanadi, shuning uchun jarayonlar sonini katta qilmang (1–2 yetarli).
echo "[entrypoint] Server ishga tushmoqda: port ${PORT:-8000}, jarayonlar ${WEB_CONCURRENCY:-2}"
exec $AS_APP python -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --proxy-headers \
    --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-*}" \
    --no-server-header
