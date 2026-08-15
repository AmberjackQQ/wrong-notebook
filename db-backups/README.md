# Database Backups

This directory contains compressed backups of the development database (`prisma/dev.db`).

## Backup Format

- **Original database**: `prisma/dev.db` (~106 MB)
- **Compressed backup**: `dev.db.YYYYMMDD_HHMMSS.gz` (~79 MB)
- **Compression ratio**: ~75% reduction

## Creating Backups

### Linux/Mac
```bash
./scripts/backup-db.sh
```

### Windows
```bash
scripts\backup-db.bat
```

### Manual backup
```bash
gzip -c prisma/dev.db > db-backups/dev.db.$(date +%Y%m%d_%H%M%S).gz
```

## Restoring from Backup

### Linux/Mac
```bash
gunzip -c db-backups/dev.db.YYYYMMDD_HHMMSS.gz > prisma/dev.db
```

### Windows
```bash
gunzip -c db-backups\dev.db.YYYYMMDD_HHMMSS.gz > prisma\dev.db
```

Or use 7-Zip or WinRAR to extract the .gz file.

## Backup Retention

The backup script automatically keeps only the 10 most recent backups to manage storage space. Older backups are automatically removed when creating new backups.

## Automatic Backups

Consider setting up a cron job (Linux/Mac) or Task Scheduler (Windows) to run automatic backups:

### Cron Job Example (Linux/Mac)
```bash
# Run backup every day at 2 AM
0 2 * * * cd /path/to/wrong-notebook && ./scripts/backup-db.sh
```

### Task Scheduler (Windows)
Create a scheduled task to run `scripts\backup-db.bat` at your desired interval.

## Git Integration

These backup files are tracked in Git to ensure data safety. The `.gitignore` file is configured to:
- Ignore the original uncompressed `*.db` files
- Allow compressed `*.gz` backup files in the `db-backups/` directory
