#!/usr/bin/env bash
#
# §56 — nightly backup of the database and the uploaded files.
#
# Two things are backed up because losing either one alone still loses the record: the database
# holds the register, and uploads/ holds the scanned rješenja and laboratory findings the register
# points at. A dump without the files leaves an inspector's document trail full of dead links.
#
# Install on the VPS (aaPanel), as the user that owns the deployment:
#
#     crontab -e
#     15 3 * * *  /www/wwwroot/<site>/programs/moj-pcelinjak/scripts/backup.sh >> /var/log/moj-pcelinjak-backup.log 2>&1
#
# Off-site is not optional. A backup on the same disk as the database survives a bad migration and
# nothing else — no disk failure, no ransomware, no accidental `rm -rf`. Set BACKUP_REMOTE to an
# rclone remote (Hetzner Storage Box, S3, anything rclone speaks) and the archive is copied there
# before the local retention sweep runs.
#
# Restore, in the same order:
#     zcat db-YYYY-MM-DD.sql.gz | mysql -u <user> -p <database>
#     tar -xzf uploads-YYYY-MM-DD.tar.gz -C <project root>

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/../backups/moj-pcelinjak}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

# The same .env the application and migrate.cjs read, so there is one place a password lives.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:?DB_NAME is not set — check .env}"
DB_USER="${DB_USER:?DB_USER is not set — check .env}"
DB_PASSWORD="${DB_PASSWORD:-}"

STAMP="$(date +%F-%H%M)"
mkdir -p "$BACKUP_DIR"

# mysqldump reads the password from a 0600 file rather than the command line: an argument is
# visible to every user on the box through `ps`, and this one opens the whole register.
CNF="$(mktemp)"
chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT
cat >"$CNF" <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASSWORD
EOF

DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"

# A single-database dump from a GTID-enabled server carries a SET @@GLOBAL.GTID_PURGED header that
# makes the file refuse to restore anywhere except a virgin server. Only MySQL understands the
# switch that turns it off — MariaDB rejects it as an unknown option and the cron job dies at 03:15
# with nobody watching — so ask the binary first.
#
# A scalar rather than an array: bash 3.2 expands an empty array under `set -u` as an unbound
# variable, which aborts the dump and leaves a 20-byte gzip header behind.
#
# The help text is captured, not piped into grep: `grep -q` closes the pipe on its first match,
# mysqldump takes SIGPIPE, and `pipefail` then reports the whole test as failed — so the probe
# answers "not supported" on exactly the servers that do support it.
GTID_FLAG=""
MYSQLDUMP_HELP="$(mysqldump --help 2>/dev/null || true)"
case "$MYSQLDUMP_HELP" in
  *--set-gtid-purged*) GTID_FLAG="--set-gtid-purged=OFF" ;;
esac

echo "[backup] dumping $DB_NAME → $DB_FILE"
# --single-transaction keeps the dump consistent without locking the tables, so a beekeeper saving
# an inspection at 03:15 is not met with a timeout. --routines and --triggers because the derived
# columns and the LOT logic live in the schema, not only in the application.
# shellcheck disable=SC2086  # unquoted on purpose: empty must expand to no argument at all
mysqldump --defaults-extra-file="$CNF" \
  --single-transaction --quick --routines --triggers \
  --default-character-set=utf8mb4 \
  $GTID_FLAG \
  "$DB_NAME" | gzip -9 >"$DB_FILE"

UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
if [[ -d "$PROJECT_ROOT/uploads" ]]; then
  echo "[backup] archiving uploads → $UPLOADS_FILE"
  tar -czf "$UPLOADS_FILE" -C "$PROJECT_ROOT" uploads
else
  echo "[backup] no uploads/ directory — skipping file archive"
fi

# Fail loudly on a truncated dump, before the remote copy and before the retention sweep deletes
# a good one. A file-size check is not enough: a dump that dies on the first table still produces
# a plausible-looking gzip. mysqldump writes the trailer below only after the last row, so its
# presence is the one cheap proof the file is complete.
TRAILER="$(gzip -cd "$DB_FILE" | tail -5)"
if [[ "$TRAILER" != *'Dump completed'* ]]; then
  echo "[backup] FAILED — database dump is truncated (no completion marker)" >&2
  exit 1
fi

if [[ -n "$BACKUP_REMOTE" ]]; then
  echo "[backup] copying to $BACKUP_REMOTE"
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include "*-$STAMP.*"
fi

echo "[backup] pruning local copies older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'uploads-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup] done — $(du -h "$DB_FILE" | cut -f1) database, $(ls -1 "$BACKUP_DIR" | wc -l | tr -d ' ') files retained"
