# Export Production Database Schema
# Creates a clean database export with only essential data for production deployment

Write-Host "=== QTIP Production Schema Export ===" -ForegroundColor Yellow
Write-Host ""

# Configuration
$DatabaseName = "qtip"
$OutputFile = "qtip_production_schema_$(Get-Date -Format 'yyyy_MM_dd').sql"
$TempCleanDb = "qtip_temp_clean"

Write-Host "Creating production-ready database schema..." -ForegroundColor Cyan
Write-Host "Output file: $OutputFile" -ForegroundColor White
Write-Host ""

try {
    # Step 1: Create temporary clean database
    Write-Host "🔧 Creating temporary clean database..." -ForegroundColor Cyan
    mysql -u root -p"Thrills0011**" -e "DROP DATABASE IF EXISTS $TempCleanDb; CREATE DATABASE $TempCleanDb;"
    
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create temporary database"
    }

    # Step 2: Copy structure from current database
    Write-Host "📋 Copying database structure..." -ForegroundColor Cyan
    mysqldump -u root -p"Thrills0011**" --no-data --routines --triggers $DatabaseName | mysql -u root -p"Thrills0011**" $TempCleanDb
    
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy database structure"
    }

    # Step 3: Copy essential data only
    Write-Host "📊 Copying essential data (users, roles, departments)..." -ForegroundColor Cyan
    
    # Export and import users table data
    mysqldump -u root -p"Thrills0011**" --no-create-info $DatabaseName users | mysql -u root -p"Thrills0011**" $TempCleanDb
    
    # Export and import roles table data  
    mysqldump -u root -p"Thrills0011**" --no-create-info $DatabaseName roles | mysql -u root -p"Thrills0011**" $TempCleanDb
    
    # Export and import departments table data
    mysqldump -u root -p"Thrills0011**" --no-create-info $DatabaseName departments | mysql -u root -p"Thrills0011**" $TempCleanDb
    
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy essential data"
    }

    # Step 4: Export clean database to file
    Write-Host "💾 Exporting production schema..." -ForegroundColor Cyan
    
    # Create header comment
    @"
-- QTIP Production Database Schema
-- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
-- Description: Clean production database with essential data only
-- 
-- Contains:
--   ✓ Complete database structure
--   ✓ Users, Roles, Departments data
--   ✗ No test/development data
--
-- Usage: mysql -u username -p database_name < $OutputFile

"@ | Out-File -FilePath $OutputFile -Encoding UTF8

    # Export the clean database
    mysqldump -u root -p"Thrills0011**" --single-transaction --routines --triggers --add-drop-database --databases $TempCleanDb | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to export production schema"
    }

    # Step 5: Fix database name in export (replace temp name with original)
    Write-Host "🔧 Fixing database references..." -ForegroundColor Cyan
    (Get-Content $OutputFile) -replace $TempCleanDb, $DatabaseName | Set-Content $OutputFile

    # Step 6: Clean up temporary database
    Write-Host "🧹 Cleaning up..." -ForegroundColor Cyan
    mysql -u root -p"Thrills0011**" -e "DROP DATABASE $TempCleanDb;"

    # Step 7: Verify export
    Write-Host "🔍 Verifying export..." -ForegroundColor Cyan
    $fileSize = (Get-Item $OutputFile).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    
    Write-Host ""
    Write-Host "✅ Production schema export completed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "File Details:" -ForegroundColor Cyan
    Write-Host "  - File: $OutputFile" -ForegroundColor White
    Write-Host "  - Size: $fileSizeKB KB" -ForegroundColor White
    Write-Host ""
    Write-Host "To deploy to production server:" -ForegroundColor Cyan
    Write-Host "  mysql -u username -p database_name < $OutputFile" -ForegroundColor White
    Write-Host ""

    # Show what data is included
    Write-Host "Data included in export:" -ForegroundColor Cyan
    mysql -u root -p"Thrills0011**" $DatabaseName -e "
        SELECT 'Users' as 'Table', COUNT(*) as 'Records' FROM users
        UNION ALL
        SELECT 'Roles', COUNT(*) FROM roles  
        UNION ALL
        SELECT 'Departments', COUNT(*) FROM departments;
    " --table

    Write-Host ""
    Write-Host "🎉 Production schema ready for deployment!" -ForegroundColor Green

} catch {
    Write-Host ""
    Write-Host "❌ Error occurred: $_" -ForegroundColor Red
    
    # Clean up on error
    mysql -u root -p"Thrills0011**" -e "DROP DATABASE IF EXISTS $TempCleanDb;" 2>$null
    
    if (Test-Path $OutputFile) {
        Remove-Item $OutputFile -ErrorAction SilentlyContinue
        Write-Host "Cleaned up incomplete export file." -ForegroundColor Yellow
    }
    
    exit 1
} 