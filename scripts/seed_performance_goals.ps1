# Script to seed performance goals data
Write-Host "Running performance goals seed script..."

# Define database connection parameters
$mysqlUser = "root"
$mysqlPassword = "Thrills0011**"
$mysqlDatabase = "qtip"
$seedFile = "../database/seed_performance_goals.sql"

# Run the seed SQL file
try {
    Write-Host "Connecting to MySQL and running seed script..."
    mysql -u $mysqlUser -p"$mysqlPassword" $mysqlDatabase -e "source $seedFile"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Performance goals seed data successfully inserted." -ForegroundColor Green
    } else {
        Write-Host "Error running seed script. Check the SQL file for errors." -ForegroundColor Red
    }
} catch {
    Write-Error "MySQL error: $_"
} 