# Script to apply the allow_null_call_id migration

# Database credentials
$DB_USER = "root"
$DB_PASS = "Thrills0011**" 
$DB_NAME = "qtip"

# First check if submissions table already has a call_id column
Write-Host "Checking if submissions table already has call_id column..."
$checkColumnExists = mysql -u $DB_USER -p"$DB_PASS" $DB_NAME -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='submissions' AND COLUMN_NAME='call_id';"

# First backup the database
Write-Host "Creating database backup..."
$backupFile = "qtip_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
mysqldump -u $DB_USER -p"$DB_PASS" $DB_NAME > $backupFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database backup created successfully: $backupFile"
    
    # Apply migration
    Write-Host "Applying migration to allow NULL call_id in submissions table..."
    mysql -u $DB_USER -p"$DB_PASS" $DB_NAME -e "source backend/sql/migrations/allow_null_call_id.sql"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Migration applied successfully!"
        Write-Host "You can now use the manual-reviews/form with or without a call_id."
    } else {
        Write-Host "Error applying migration. Please check the SQL file."
        Write-Host "You can restore the database using: mysql -u $DB_USER -p $DB_NAME < $backupFile"
    }
} else {
    Write-Host "Error creating database backup. Migration not applied."
} 