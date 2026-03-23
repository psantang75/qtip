# PowerShell script to start both frontend and backend servers
# Usage: .\start_app.ps1

# Function to check if a process is running on a specific port
function Test-PortInUse {
    param (
        [int]$Port
    )
    
    $connections = netstat -ano | findstr ":$Port"
    return $connections.Length -gt 0
}

# Kill any existing processes on ports 3000 and 5173
Write-Host "Checking for existing processes on ports 3000 and 5173..."

if (Test-PortInUse -Port 3000) {
    Write-Host "Killing process on port 3000..."
    $processId = (netstat -ano | findstr ":3000" | Select-String -Pattern "\s+(\d+)$").Matches.Groups[1].Value
    if ($processId) {
        taskkill /PID $processId /F
    }
}

if (Test-PortInUse -Port 5173) {
    Write-Host "Killing process on port 5173..."
    $processId = (netstat -ano | findstr ":5173" | Select-String -Pattern "\s+(\d+)$").Matches.Groups[1].Value
    if ($processId) {
        taskkill /PID $processId /F
    }
}

# Create .env file if it doesn't exist
Push-Location -Path "backend"
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
Pop-Location

# Start backend server in a new window
Write-Host "Starting backend server..."
Start-Process powershell -ArgumentList "-NoExit -Command cd '$PWD\backend'; npm run dev"

# Wait for backend to start
Write-Host "Waiting for backend to start (5 seconds)..."
Start-Sleep -Seconds 5

# Start frontend server in a new window
Write-Host "Starting frontend server..."
Start-Process powershell -ArgumentList "-NoExit -Command cd '$PWD\frontend'; npm run dev"

Write-Host "App started! Access the frontend at http://localhost:5173" 