#!/bin/bash

# Database Backup Script
# Compresses and backs up the current database with timestamp

DB_FILE="prisma/dev.db"
BACKUP_DIR="db-backups"
MAX_BACKUPS=10  # Keep only the 10 most recent backups

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Database Backup Script ===${NC}"

# Check if database file exists
if [ ! -f "$DB_FILE" ]; then
    echo -e "${RED}Error: Database file not found: $DB_FILE${NC}"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dev.db.$TIMESTAMP.gz"

echo "Creating backup: $BACKUP_FILE"

# Compress database
gzip -c "$DB_FILE" > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Backup created successfully: $BACKUP_FILE ($BACKUP_SIZE)${NC}"

    # Remove old backups (keep only MAX_BACKUPS most recent)
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.gz 2>/dev/null | wc -l)
    if [ $BACKUP_COUNT -gt $MAX_BACKUPS ]; then
        echo -e "${YELLOW}Cleaning up old backups (keeping $MAX_BACKUPS most recent)...${NC}"
        ls -1t "$BACKUP_DIR"/*.gz | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f
        REMAINING=$(ls -1 "$BACKUP_DIR"/*.gz 2>/dev/null | wc -l)
        echo -e "${GREEN}✓ Cleanup complete. $REMAINING backups retained.${NC}"
    fi

    echo -e "${GREEN}=== Backup Complete ===${NC}"
    echo "Total backups: $(ls -1 "$BACKUP_DIR"/*.gz 2>/dev/null | wc -l)"
else
    echo -e "${RED}✗ Backup failed${NC}"
    exit 1
fi
