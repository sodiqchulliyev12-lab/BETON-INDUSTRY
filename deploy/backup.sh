#!/usr/bin/env bash
# BETON INDUSTRY — zaxira nusxa: PostgreSQL bazasi + yuklangan rasmlar.
#
# Qo'lda:    sudo -u beton /opt/beton-industry/deploy/backup.sh
# Har kuni (crontab -e, "beton" foydalanuvchisi):
#   30 2 * * * /opt/beton-industry/deploy/backup.sh >> /var/log/beton-backup.log 2>&1
#
# Tiklash (DIQQAT: bazadagi joriy ma'lumotlar almashtiriladi):
#   pg_restore --clean --if-exists --no-owner --dbname="postgresql://USER:PAROL@localhost:5432/beton_industry" db-YYYYMMDD-HHMMSS.dump
#   tar -xzf uploads-YYYYMMDD-HHMMSS.tar.gz -C /opt/beton-industry/backend/
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/beton-industry}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/beton-industry}"
KEEP_DAYS="${KEEP_DAYS:-14}"
UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/backend/uploads}"

# DATABASE_URL muhitdan yoki backend/.env dan olinadi
if [ -z "${DATABASE_URL:-}" ] && [ -f "$APP_DIR/backend/.env" ]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/backend/.env" | head -n1 | cut -d= -f2-)"
fi
: "${DATABASE_URL:?DATABASE_URL topilmadi}"
# pg_dump SQLAlchemy drayver qo'shimchasini tushunmaydi: postgresql+psycopg:// → postgresql://
PG_URL="${DATABASE_URL/postgresql+psycopg:\/\//postgresql://}"

STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Baza zaxirasi..."
pg_dump --format=custom --no-owner --no-privileges --dbname="$PG_URL" --file="$BACKUP_DIR/db-$STAMP.dump"

if [ -d "$UPLOAD_DIR" ]; then
    echo "[$(date -Is)] Rasmlar zaxirasi..."
    tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
fi

# Eski nusxalarni o'chirish
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

echo "[$(date -Is)] Tayyor: $BACKUP_DIR (oxirgi $KEEP_DAYS kun saqlanadi)"
ls -lh "$BACKUP_DIR" | tail -n 4
