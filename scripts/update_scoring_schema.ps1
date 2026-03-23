#!/usr/bin/env pwsh
<# 
  .SYNOPSIS
    Updates the database schema to support the new scoring utility
  
  .DESCRIPTION 
    This script runs the SQL updates needed to add fields to the score_snapshots table
    and create any new tables needed for the scoring utility to function properly.
#>

$ErrorActionPreference = "Stop"

# Set the path to the update SQL script
$sqlScriptPath = Join-Path $PSScriptRoot "..\database\update_score_snapshots.sql"

# Check if the script exists
if (-not (Test-Path $sqlScriptPath)) {
    Write-Error "SQL script not found at $sqlScriptPath"
    exit 1
}

# Database connection details (you may need to customize these)
$mysqlHost = "localhost"
$mysqlUser = "root"
$mysqlPass = "Thrills0011**"
$mysqlDb = "qtip"

# Confirmation prompt
Write-Host "This script will update the database schema for the scoring utility." -ForegroundColor Yellow
Write-Host "Database: $mysqlDb on $mysqlHost" -ForegroundColor Yellow
$confirm = Read-Host "Continue? (y/n)"

if ($confirm -ne "y") {
    Write-Host "Operation cancelled." -ForegroundColor Red
    exit 0
}

try {
    # Run the MySQL script
    Write-Host "Applying database updates..." -ForegroundColor Cyan
    
    # Using the source command in MySQL
    mysql -u $mysqlUser -p"$mysqlPass" -h $mysqlHost $mysqlDb -e "source $sqlScriptPath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Database schema updated successfully!" -ForegroundColor Green
    } else {
        Write-Error "An error occurred while updating the database schema."
        exit 1
    }
} catch {
    Write-Error "Error updating database: $_"
    exit 1
} 