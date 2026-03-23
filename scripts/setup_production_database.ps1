# Setup Production Database Script
# This script prepares the database for production by clearing test data
# while preserving essential data (users, roles, departments)

Write-Host "=== QTIP Production Database Setup ===" -ForegroundColor Yellow
Write-Host ""

# Configuration
$DatabaseName = "qtip"
$BackupPath = "backup_before_production_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

Write-Host "This script will:" -ForegroundColor Cyan
Write-Host "  [KEEP] Create a backup of current database" -ForegroundColor Green
Write-Host "  [KEEP] Preserve: users, roles, departments tables" -ForegroundColor Green
Write-Host "  [REMOVE] Remove: all forms, submissions, training, coaching data" -ForegroundColor Red
Write-Host "  [REMOVE] Remove: all logs, performance goals, assignments" -ForegroundColor Red
Write-Host ""

# Confirmation
$confirmation = Read-Host "Are you sure you want to continue? This will delete most data! (yes/no)"
if ($confirmation -ne "yes") {
    Write-Host "Operation cancelled." -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "Starting production database setup..." -ForegroundColor Yellow

try {
    # Step 1: Create backup
    Write-Host "[BACKUP] Creating database backup..." -ForegroundColor Cyan
    mysqldump -u root -p"Thrills0011**" --single-transaction --routines --triggers $DatabaseName > $BackupPath
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Backup created: $BackupPath" -ForegroundColor Green
    } else {
        throw "Failed to create backup"
    }

    # Step 2: Apply production setup
    Write-Host "[SETUP] Applying production database setup..." -ForegroundColor Cyan
    mysql -u root -p"Thrills0011**" -e "source scripts/build_production_database.sql"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Production database setup completed!" -ForegroundColor Green
    } else {
        throw "Failed to apply production setup"
    }

    # Step 3: Verify setup
    Write-Host "[VERIFY] Verifying database state..." -ForegroundColor Cyan
    mysql -u root -p"Thrills0011**" $DatabaseName -e "
        SELECT 'Users:' as Table_Name, COUNT(*) as Record_Count FROM users
        UNION ALL
        SELECT 'Roles:', COUNT(*) FROM roles
        UNION ALL  
        SELECT 'Departments:', COUNT(*) FROM departments
        UNION ALL
        SELECT 'Forms:', COUNT(*) FROM forms
        UNION ALL
        SELECT 'Submissions:', COUNT(*) FROM submissions
        UNION ALL
        SELECT 'Coaching Sessions:', COUNT(*) FROM coaching_sessions;
    " --table

    Write-Host ""
    Write-Host "[COMPLETE] Production database setup completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  - Backup saved to: $BackupPath" -ForegroundColor White
    Write-Host "  - Essential data preserved (users, roles, departments)" -ForegroundColor White
    Write-Host "  - All test/transactional data removed" -ForegroundColor White
    Write-Host "  - Auto-increment counters reset" -ForegroundColor White
    Write-Host ""
    Write-Host "Your database is now ready for production!" -ForegroundColor Green

} catch {
    Write-Host ""
    Write-Host "[ERROR] Error occurred: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "If you need to restore from backup:" -ForegroundColor Yellow
    Write-Host "mysql -u root -p`"Thrills0011**`" $DatabaseName < $BackupPath" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Update user passwords for production" -ForegroundColor White
Write-Host "2. Create production forms and content" -ForegroundColor White
Write-Host "3. Set up department managers" -ForegroundColor White
Write-Host "4. Configure performance goals" -ForegroundColor White 