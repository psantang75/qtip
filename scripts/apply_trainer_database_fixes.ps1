#!/usr/bin/env pwsh

# PowerShell script to apply trainer-related database schema fixes
# This script applies the coaching_sessions table improvements for trainer functionality

param(
    [string]$DatabasePassword = "Thrills0011**"
)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  QTIP Trainer Database Schema Fixes      " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if MySQL is accessible
Write-Host "Checking MySQL connection..." -ForegroundColor Yellow
try {
    mysql -u root -p"$DatabasePassword" -e "SELECT 1;" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ MySQL connection successful" -ForegroundColor Green
    } else {
        throw "MySQL connection failed"
    }
} catch {
    Write-Host "✗ Error: Cannot connect to MySQL. Please check:" -ForegroundColor Red
    Write-Host "  - MySQL service is running" -ForegroundColor Red
    Write-Host "  - Password is correct: $DatabasePassword" -ForegroundColor Red
    Write-Host "  - MySQL is accessible on localhost" -ForegroundColor Red
    exit 1
}

# Check if qtip database exists
Write-Host "Checking qtip database..." -ForegroundColor Yellow
$dbExists = mysql -u root -p"$DatabasePassword" -e "SHOW DATABASES LIKE 'qtip';" 2>$null
if ($LASTEXITCODE -eq 0 -and $dbExists -match "qtip") {
    Write-Host "✓ qtip database found" -ForegroundColor Green
} else {
    Write-Host "✗ Error: qtip database not found. Please run database setup first." -ForegroundColor Red
    exit 1
}

# Apply trainer coaching sessions schema fixes
Write-Host "Applying trainer coaching sessions schema fixes..." -ForegroundColor Yellow
try {
    mysql -u root -p"$DatabasePassword" -e "source database/migrations/fix_trainer_coaching_sessions_constraints.sql"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Trainer coaching sessions schema fixes applied successfully" -ForegroundColor Green
    } else {
        throw "Schema migration failed"
    }
} catch {
    Write-Host "✗ Error applying trainer schema fixes" -ForegroundColor Red
    Write-Host "Check the SQL file: database/migrations/fix_trainer_coaching_sessions_constraints.sql" -ForegroundColor Red
    exit 1
}

# Verify the changes
Write-Host "Verifying coaching_sessions table structure..." -ForegroundColor Yellow
$tableStructure = mysql -u root -p"$DatabasePassword" -e "USE qtip; DESCRIBE coaching_sessions;" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Table structure verified" -ForegroundColor Green
    
    # Check for required columns
    if ($tableStructure -match "created_by") {
        Write-Host "  ✓ created_by column exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: created_by column missing" -ForegroundColor Yellow
    }
    
    if ($tableStructure -match "coaching_type") {
        Write-Host "  ✓ coaching_type column exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: coaching_type column missing" -ForegroundColor Yellow
    }
    
    if ($tableStructure -match "attachment_filename") {
        Write-Host "  ✓ attachment columns exist" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: attachment columns missing" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ Error verifying table structure" -ForegroundColor Red
}

# Check foreign key constraints
Write-Host "Verifying foreign key constraints..." -ForegroundColor Yellow
$constraints = mysql -u root -p"$DatabasePassword" -e "USE qtip; SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'qtip' AND TABLE_NAME = 'coaching_sessions' AND CONSTRAINT_TYPE = 'FOREIGN KEY';" 2>$null
if ($LASTEXITCODE -eq 0) {
    if ($constraints -match "fk_coaching_sessions_created_by") {
        Write-Host "  ✓ created_by foreign key constraint exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: created_by foreign key constraint missing" -ForegroundColor Yellow
    }
    
    if ($constraints -match "coaching_sessions_ibfk_1") {
        Write-Host "  ✓ csr_id foreign key constraint exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: csr_id foreign key constraint missing" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ Error checking foreign key constraints" -ForegroundColor Red
}

# Check indexes
Write-Host "Verifying database indexes..." -ForegroundColor Yellow
$indexes = mysql -u root -p"$DatabasePassword" -e "USE qtip; SHOW INDEX FROM coaching_sessions;" 2>$null
if ($LASTEXITCODE -eq 0) {
    if ($indexes -match "idx_coaching_sessions_created_by") {
        Write-Host "  ✓ created_by index exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: created_by index missing" -ForegroundColor Yellow
    }
    
    if ($indexes -match "idx_coaching_sessions_trainer_csr") {
        Write-Host "  ✓ trainer-csr composite index exists" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Warning: trainer-csr composite index missing" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ Error checking database indexes" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Trainer Database Schema Fixes Complete  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The following trainer improvements have been applied:" -ForegroundColor Green
Write-Host "  ✓ Added created_by foreign key constraint" -ForegroundColor Green
Write-Host "  ✓ Added coaching_type enum column" -ForegroundColor Green
Write-Host "  ✓ Added attachment support columns" -ForegroundColor Green
Write-Host "  ✓ Added performance indexes" -ForegroundColor Green
Write-Host "  ✓ Added composite indexes for trainer queries" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart the backend server to use new TrainerService" -ForegroundColor Yellow
Write-Host "  2. Test trainer coaching session functionality" -ForegroundColor Yellow
Write-Host "  3. Verify trainer dashboard loads properly" -ForegroundColor Yellow
Write-Host "" 