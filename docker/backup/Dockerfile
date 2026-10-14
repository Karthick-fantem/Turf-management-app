FROM postgres:15-alpine

# Security: Install only necessary utilities for backup, verification, and encryption
RUN apk add --no-cache \
    bash \
    curl \
    openssl \
    coreutils \
    tzdata \
    jq \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY scripts/db-backup.sh /app/db-backup.sh
COPY scripts/db-restore.sh /app/db-restore.sh
COPY scripts/wal-archive.sh /app/wal-archive.sh
COPY scripts/wal-restore.sh /app/wal-restore.sh
COPY scripts/wal-sync.sh /app/wal-sync.sh
COPY docker/backup/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/*.sh && \
    mkdir -p /backups /wal_archive && \
    chown -R postgres:postgres /app /backups /wal_archive

# Security: Run as unprivileged non-root postgres user (UID 70)
USER postgres

ENTRYPOINT ["/app/entrypoint.sh"]
