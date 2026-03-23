# Setup users script for QTIP application
# This script sets up the default admin user and updates all user passwords

# Database configuration
$DB_HOST = "localhost"
$DB_USER = "root"
$DB_PASSWORD = "Thrills0011**"
$DB_NAME = "qtip"

# Create .env file if it doesn't exist
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file..."
    @"
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=Thrills0011**
DB_NAME=qtip

# JWT Configuration
JWT_SECRET=qtip_secret_key
JWT_EXPIRES_IN=8h

# Server Configuration
PORT=3000
NODE_ENV=development
"@ | Out-File -FilePath ".env" -Encoding utf8
    Write-Host ".env file created."
}

# Function to execute MySQL commands
function Execute-MySQLCommand {
    param (
        [string]$query
    )
    
    try {
        # Use single quotes for SQL and double quotes for PowerShell
        mysql -u $DB_USER -p"$DB_PASSWORD" $DB_NAME -e $query
        if ($LASTEXITCODE -eq 0) {
            return $true
        } else {
            return $false
        }
    } catch {
        Write-Error "MySQL error: $_"
        return $false
    }
}

# Check if admin user exists
Write-Host "Checking for admin user..."
$adminExists = mysql -u $DB_USER -p"$DB_PASSWORD" $DB_NAME -e "SELECT COUNT(*) FROM users WHERE email = 'admin@qtip.com';" | Select-String -Pattern "^[0-9]+"

if ($adminExists -match "0") {
    # Create admin user with password 'pass1234'
    Write-Host "Creating admin user..."
    $createAdminQuery = @"
INSERT INTO users (username, email, password_hash, role_id, created_at, updated_at)
VALUES ('admin', 'admin@qtip.com', '\$2b\$10\$YMxRwDc2Ry/9nNNsZxLEo.XUXQg1yxjFj.Jfh3lX7Jb2X7CC7BI7.', 1, NOW(), NOW());
"@
    
    Execute-MySQLCommand -query "'$createAdminQuery'"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Admin user created successfully."
    } else {
        Write-Host "Failed to create admin user."
    }
} else {
    Write-Host "Admin user already exists."
}

# Update all user passwords to 'pass1234'
Write-Host "Updating all user passwords to 'pass1234'..."
$updatePasswordsQuery = @"
UPDATE users SET password_hash = '\$2b\$10\$YMxRwDc2Ry/9nNNsZxLEo.XUXQg1yxjFj.Jfh3lX7Jb2X7CC7BI7.';
"@

Execute-MySQLCommand -query "'$updatePasswordsQuery'"
if ($LASTEXITCODE -eq 0) {
    Write-Host "All user passwords updated successfully."
} else {
    Write-Host "Failed to update user passwords."
}

Write-Host "Setup complete. Default admin user: admin@qtip.com / pass1234" 