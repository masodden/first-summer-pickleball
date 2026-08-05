#!/usr/bin/env sh
# Резервная копия базы. Кладите в cron:
#   0 4 * * * cd /opt/first-summer-pickleball && sh infra/backup.sh >> /var/log/fsp-backup.log 2>&1
set -eu

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
BACKUP_DIR="$(dirname "$0")/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H-%M)"

mkdir -p "$BACKUP_DIR"

DB_USER="${POSTGRES_USER:-fsp}"
DB_NAME="${POSTGRES_DB:-fsp}"

echo "[$(date '+%F %T')] Делаю дамп базы $DB_NAME"
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip -9 > "$BACKUP_DIR/fsp-$STAMP.sql.gz"

echo "[$(date '+%F %T')] Готово: $BACKUP_DIR/fsp-$STAMP.sql.gz"

# Старые копии удаляем, чтобы диск VPS не заполнился.
find "$BACKUP_DIR" -name 'fsp-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "[$(date '+%F %T')] Копии старше $KEEP_DAYS дней удалены"
