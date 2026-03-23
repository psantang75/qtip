Write-Host "Killing existing server processes on specific ports..." -ForegroundColor Yellow

# Find and kill processes on port 3000 (backend)
Write-Host "Checking for processes on port 3000 (backend)..." -ForegroundColor Cyan
$backendProcess = netstat -ano | findstr :3000
if ($backendProcess) {
    $processId = ($backendProcess -split '\s+')[-1]
    try {
        taskkill /PID $processId /F
        Write-Host "Killed process on port 3000 (PID: $processId)" -ForegroundColor Green
    } catch {
        Write-Host "Failed to kill process on port 3000: $_" -ForegroundColor Red
    }
} else {
    Write-Host "No process found on port 3000" -ForegroundColor Cyan
}

# Find and kill processes on port 5173 (frontend)
Write-Host "Checking for processes on port 5173 (frontend)..." -ForegroundColor Cyan
$frontendProcess = netstat -ano | findstr :5173
if ($frontendProcess) {
    $processId = ($frontendProcess -split '\s+')[-1]
    try {
        taskkill /PID $processId /F
        Write-Host "Killed process on port 5173 (PID: $processId)" -ForegroundColor Green
    } catch {
        Write-Host "Failed to kill process on port 5173: $_" -ForegroundColor Red
    }
} else {
    Write-Host "No process found on port 5173" -ForegroundColor Cyan
}

# Wait a moment to ensure processes are closed
Start-Sleep -Seconds 2

# Start Backend Server
Write-Host "Starting backend server..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command cd '$backendPath'; npm start" -WindowStyle Normal

# Wait a moment before starting frontend
Start-Sleep -Seconds 2

# Start Frontend Server
Write-Host "Starting frontend server..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command cd '$frontendPath'; npm run dev" -WindowStyle Normal

Write-Host "Servers have been restarted!" -ForegroundColor Green
Write-Host "Backend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan 