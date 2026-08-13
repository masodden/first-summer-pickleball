#!/usr/bin/env sh
# Резервная копия базы. .env лежит в корне репозитория, не в infra/.
# Cron (пока не ставьте, если не просили):
#   0 4 * * * cd /root/first-summer-pickleball && sh infra/backup.sh >> /var/log/fsp-backup.log 2>&1
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"
ENV_FILE="$ROOT/.env"
BACKUP_DIR="$ROOT/infra/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H-%M)"
DUMP="$BACKUP_DIR/fsp-$STAMP.sql"

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет $ENV_FILE — без него Compose не видит пароль Postgres." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

DB_USER="${POSTGRES_USER:-fsp}"
DB_NAME="${POSTGRES_DB:-fsp}"

echo "[$(date '+%F %T')] Делаю дамп базы $DB_NAME"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists > "$DUMP"; then
  rm -f "$DUMP"
  echo "[$(date '+%F %T')] Дамп не удался" >&2
  exit 1
fi

gzip -9 "$DUMP"
echo "[$(date '+%F %T')] Готово: $DUMP.gz"

find "$BACKUP_DIR" -name 'fsp-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "[$(date '+%F %T')] Копии старше $KEEP_DAYS дней удалены"
