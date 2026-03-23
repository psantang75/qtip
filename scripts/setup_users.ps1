# PowerShell script to set up users with password "pass1234"
# Usage: .\setup_users.ps1

Write-Host "Setting up users with password 'pass1234'..."

# Create .env file if it doesn't exist
if (-not (Test-Path .env)) {
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
"@ | Out-File -FilePath .env -Encoding utf8
    Write-Host ".env file created."
}

# Pre-hashed password for "pass1234" using bcrypt with salt rounds 10
$passwordHash = '$2b$10$RzZ.Hs9Wd4G.XP1/VcgXC.1pjN9aYtCkH8kRN3nPHWwRq6Ub.BdxW'

# Check if roles exist, if not create them
Write-Host "Checking if roles exist..."
mysql -u root -p"Thrills0011**" -e "USE qtip; SELECT COUNT(*) FROM roles;" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Roles table doesn't exist. Make sure the database is set up properly."
    exit 1
}

# Insert roles if they don't exist
Write-Host "Inserting roles if they don't exist..."
mysql -u root -p"Thrills0011**" -e "USE qtip; 
INSERT IGNORE INTO roles (role_name) VALUES 
('Admin'), 
('QA'), 
('CSR'), 
('Trainer'), 
('Manager'), 
('Director');"

# Check if admin user exists, if not create one
Write-Host "Checking if admin user exists..."
$adminExists = mysql -u root -p"Thrills0011**" -e "USE qtip; SELECT COUNT(*) FROM users WHERE email = 'admin@qtip.com';"
if ($adminExists -match "0") {
    Write-Host "Creating admin user..."
    mysql -u root -p"Thrills0011**" -e "USE qtip; 
    INSERT INTO users (username, email, password_hash, role_id) 
    SELECT 'admin', 'admin@qtip.com', '$passwordHash', id 
    FROM roles WHERE role_name = 'Admin';"
}

# Update all user passwords to the hashed value
Write-Host "Updating all user passwords..."
mysql -u root -p"Thrills0011**" -e "USE qtip; UPDATE users SET password_hash = '$passwordHash';"

Write-Host "Setup complete!"
Write-Host "You can now log in with the following credentials:"
Write-Host "Email: admin@qtip.com"
Write-Host "Password: pass1234" 