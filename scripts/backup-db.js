#!/usr/bin/env node

/**
 * Cross-platform Database Backup Script
 * Compresses and backs up the current database with timestamp
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const DB_FILE = path.join(__dirname, '..', 'prisma', 'dev.db');
const BACKUP_DIR = path.join(__dirname, '..', 'db-backups');
const MAX_BACKUPS = 10;

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function createBackup() {
  log('=== Database Backup Script ===', 'green');

  // Check if database file exists
  if (!fs.existsSync(DB_FILE)) {
    log(`Error: Database file not found: ${DB_FILE}`, 'red');
    process.exit(1);
  }

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Generate backup filename with timestamp
  const timestamp = generateTimestamp();
  const backupFile = path.join(BACKUP_DIR, `dev.db.${timestamp}.gz`);

  log(`Creating backup: ${backupFile}`);

  try {
    // Compress database using zlib
    const zlib = require('zlib');
    const dbContent = fs.readFileSync(DB_FILE);
    const compressed = zlib.gzipSync(dbContent);
    fs.writeFileSync(backupFile, compressed);

    const backupSize = formatBytes(compressed.length);
    log(`✓ Backup created successfully: ${backupFile} (${backupSize})`, 'green');

    // Clean up old backups
    cleanupOldBackups();

    log('=== Backup Complete ===', 'green');
    const backupCount = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.gz')).length;
    log(`Total backups: ${backupCount}`);

  } catch (error) {
    log(`✗ Backup failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

function cleanupOldBackups() {
  const backupFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.gz'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time); // Sort by time descending (newest first)

  if (backupFiles.length > MAX_BACKUPS) {
    log(`Cleaning up old backups (keeping ${MAX_BACKUPS} most recent)...`, 'yellow');

    const filesToDelete = backupFiles.slice(MAX_BACKUPS);
    filesToDelete.forEach(file => {
      fs.unlinkSync(file.path);
      log(`  Removed: ${file.name}`);
    });

    const remaining = backupFiles.length - filesToDelete.length;
    log(`✓ Cleanup complete. ${remaining} backups retained.`, 'green');
  }
}

// Run backup
createBackup();
