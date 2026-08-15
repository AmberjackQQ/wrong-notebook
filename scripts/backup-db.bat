@echo off
REM Database Backup Script for Windows
REM Compresses and backs up the current database with timestamp

setlocal

set DB_FILE=prisma\dev.db
set BACKUP_DIR=db-backups
set MAX_BACKUPS=10

echo === Database Backup Script ===

REM Check if database file exists
if not exist "%DB_FILE%" (
    echo Error: Database file not found: %DB_FILE%
    exit /b 1
)

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Generate timestamp
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set TIMESTAMP=%dt:~0,8%_%dt:~8,6%

set BACKUP_FILE=%BACKUP_DIR%\dev.db.%TIMESTAMP%.gz

echo Creating backup: %BACKUP_FILE%

REM Compress database (using PowerShell for gzip)
powershell -Command "Compress-Archive -Path '%DB_FILE%' -DestinationPath '%BACKUP_FILE%' -Force"

if %ERRORLEVEL% EQU 0 (
    echo ✓ Backup created successfully: %BACKUP_FILE%

    REM Count backups and clean up if needed
    for /f %%i in ('dir /b "%BACKUP_DIR%\*.gz" ^| find /c /v ""') do set COUNT=%%i
    if %COUNT% GTR %MAX_BACKUPS% (
        echo Cleaning up old backups ^(keeping %MAX_BACKUPS% most recent^)...
        for /f "skip=%MAX_BACKUPS% delims=" %%f in ('dir /b /o-d "%BACKUP_DIR%\*.gz"') do del "%BACKUP_DIR%\%%f"
    )

    echo === Backup Complete ===
) else (
    echo ✗ Backup failed
    exit /b 1
)

endlocal
