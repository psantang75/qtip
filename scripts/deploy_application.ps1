# QTIP Application Deployment Script
# Handles full application deployment with health checks and rollback capabilities

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipDatabase,
    
    [Parameter(Mandatory=$false)]
    [switch]$HealthCheckOnly,
    
    [Parameter(Mandatory=$false)]
    [switch]$Restart,
    
    [Parameter(Mandatory=$false)]
    [int]$HealthCheckTimeout = 300
)

# Configuration
$script:LogFile = "./logs/deployment_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
$script:BackupDir = "./backups"
$script:DeploymentTimeout = 600 # 10 minutes

# Ensure logs directory exists
New-Item -ItemType Directory -Path "./logs" -Force | Out-Null
New-Item -ItemType Directory -Path $script:BackupDir -Force | Out-Null

# Logging function
function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR", "SUCCESS")]
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    
    # Write to console with colors
    switch ($Level) {
        "INFO" { Write-Host $logEntry -ForegroundColor White }
        "WARN" { Write-Host $logEntry -ForegroundColor Yellow }
        "ERROR" { Write-Host $logEntry -ForegroundColor Red }
        "SUCCESS" { Write-Host $logEntry -ForegroundColor Green }
    }
    
    # Write to log file
    Add-Content -Path $script:LogFile -Value $logEntry
}

# Load environment variables
function Initialize-Environment {
    $envFile = ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)\s*$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim()
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
        Write-Log "Environment variables loaded from $envFile" "SUCCESS"
    } else {
        Write-Log "Environment file $envFile not found" "WARN"
    }
}

# Check prerequisites
function Test-Prerequisites {
    Write-Log "Checking deployment prerequisites..." "INFO"
    
    $missingTools = @()
    
    # Check for Node.js
    try {
        $nodeVersion = node --version
        Write-Log "Node.js version: $nodeVersion" "INFO"
    } catch {
        $missingTools += "Node.js"
    }
    
    # Check for npm
    try {
        $npmVersion = npm --version
        Write-Log "npm version: $npmVersion" "INFO"
    } catch {
        $missingTools += "npm"
    }
    
    # Check for PM2
    try {
        $pm2Version = pm2 --version
        Write-Log "PM2 version: $pm2Version" "INFO"
    } catch {
        Write-Log "PM2 not found - installing..." "WARN"
        npm install -g pm2
    }
    
    # Check for MySQL
    try {
        $mysqlVersion = mysql --version
        Write-Log "MySQL client available" "INFO"
    } catch {
        $missingTools += "MySQL client"
    }
    
    if ($missingTools.Count -gt 0) {
        Write-Log "Missing required tools: $($missingTools -join ', ')" "ERROR"
        return $false
    }
    
    return $true
}

# Build application
function Build-Application {
    if ($SkipBuild) {
        Write-Log "Skipping build step" "INFO"
        return $true
    }
    
    Write-Log "Building application..." "INFO"
    
    # Clean previous builds
    if (Test-Path "./backend/dist") {
        Remove-Item -Recurse -Force "./backend/dist"
        Write-Log "Cleaned previous backend build" "INFO"
    }
    
    if (Test-Path "./frontend/dist") {
        Remove-Item -Recurse -Force "./frontend/dist"
        Write-Log "Cleaned previous frontend build" "INFO"
    }
    
    try {
        # Build backend
        Write-Log "Building backend..." "INFO"
        Set-Location "./backend"
        npm install --only=production
        if ($LASTEXITCODE -ne 0) { throw "Backend npm install failed" }
        
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
        
        Set-Location ".."
        Write-Log "Backend build completed" "SUCCESS"
        
        # Build frontend
        Write-Log "Building frontend..." "INFO"
        Set-Location "./frontend"
        npm install
        if ($LASTEXITCODE -ne 0) { throw "Frontend npm install failed" }
        
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
        
        Set-Location ".."
        Write-Log "Frontend build completed" "SUCCESS"
        
        return $true
    } catch {
        Write-Log "Build failed: $_" "ERROR"
        Set-Location ".."
        return $false
    }
}

# Deploy database
function Deploy-Database {
    if ($SkipDatabase) {
        Write-Log "Skipping database deployment" "INFO"
        return $true
    }
    
    Write-Log "Deploying database..." "INFO"
    
    try {
        $deployArgs = @(
            "-Environment", $Environment,
            "-BackupFirst"
        )
        
        & "./scripts/deploy_database.ps1" @deployArgs
        
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Database deployment completed" "SUCCESS"
            return $true
        } else {
            Write-Log "Database deployment failed" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Database deployment error: $_" "ERROR"
        return $false
    }
}

# Stop existing application processes
function Stop-Application {
    Write-Log "Stopping existing application processes..." "INFO"
    
    try {
        # Stop PM2 processes
        pm2 stop all 2>$null
        pm2 delete all 2>$null
        
        Write-Log "Stopped PM2 processes" "INFO"
        
        # Kill any remaining node processes on our ports
        $portsToCheck = @(3000, 5173)
        foreach ($port in $portsToCheck) {
            $processes = netstat -ano | Select-String ":$port " | ForEach-Object {
                $fields = $_.ToString().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
                if ($fields.Length -ge 5) { $fields[4] }
            }
            
            foreach ($pid in $processes) {
                if ($pid -and $pid -match '^\d+$') {
                    try {
                        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                        Write-Log "Killed process $pid on port $port" "INFO"
                    } catch {
                        # Process might already be stopped
                    }
                }
            }
        }
        
        return $true
    } catch {
        Write-Log "Error stopping application: $_" "WARN"
        return $false
    }
}

# Start application
function Start-Application {
    Write-Log "Starting application..." "INFO"
    
    try {
        # Ensure PM2 is running
        pm2 ping
        
        # Start application using ecosystem file
        $ecosystemFile = "./ecosystem.config.js"
        if (-not (Test-Path $ecosystemFile)) {
            Write-Log "Ecosystem config file not found: $ecosystemFile" "ERROR"
            return $false
        }
        
        pm2 start $ecosystemFile --env $Environment
        
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Application started with PM2" "SUCCESS"
            
            # Show PM2 status
            pm2 status
            
            return $true
        } else {
            Write-Log "Failed to start application with PM2" "ERROR"
            return $false
        }
    } catch {
        Write-Log "Error starting application: $_" "ERROR"
        return $false
    }
}

# Health check function
function Test-ApplicationHealth {
    param([int]$TimeoutSeconds = $HealthCheckTimeout)
    
    Write-Log "Performing application health check..." "INFO"
    
    $backendUrl = "http://localhost:3000"
    $frontendUrl = "http://localhost:5173"
    $healthEndpoint = "$backendUrl/monitoring/health"
    $readyEndpoint = "$backendUrl/monitoring/ready"
    
    $startTime = Get-Date
    $timeout = (Get-Date).AddSeconds($TimeoutSeconds)
    
    while ((Get-Date) -lt $timeout) {
        try {
            # Test backend health
            $healthResponse = Invoke-RestMethod -Uri $healthEndpoint -TimeoutSec 10 -ErrorAction Stop
            if ($healthResponse.status -eq "ok") {
                Write-Log "Backend health check: PASS" "SUCCESS"
                
                # Test readiness
                $readyResponse = Invoke-RestMethod -Uri $readyEndpoint -TimeoutSec 10 -ErrorAction Stop
                if ($readyResponse.status -eq "ready") {
                    Write-Log "Backend readiness check: PASS" "SUCCESS"
                    
                    # Test frontend (basic connectivity)
                    try {
                        $frontendResponse = Invoke-WebRequest -Uri $frontendUrl -TimeoutSec 10 -ErrorAction Stop
                        if ($frontendResponse.StatusCode -eq 200) {
                            Write-Log "Frontend health check: PASS" "SUCCESS"
                            
                            $duration = (Get-Date) - $startTime
                            Write-Log "All health checks passed in $($duration.TotalSeconds) seconds" "SUCCESS"
                            return $true
                        }
                    } catch {
                        Write-Log "Frontend not ready, but backend is healthy" "WARN"
                    }
                } else {
                    Write-Log "Backend not ready: $($readyResponse.status)" "WARN"
                }
            } else {
                Write-Log "Backend not healthy: $($healthResponse.status)" "WARN"
            }
        } catch {
            Write-Log "Health check failed: $_" "WARN"
        }
        
        Write-Log "Waiting 10 seconds before next health check..." "INFO"
        Start-Sleep -Seconds 10
    }
    
    Write-Log "Health check timeout after $TimeoutSeconds seconds" "ERROR"
    return $false
}

# Main deployment function
function Start-Deployment {
    Write-Log "🚀 QTIP Application Deployment - $Environment Environment" "INFO"
    Write-Log "==========================================================" "INFO"
    
    $deploymentStart = Get-Date
    
    # Initialize environment
    Initialize-Environment
    
    # Health check only mode
    if ($HealthCheckOnly) {
        $healthResult = Test-ApplicationHealth
        if ($healthResult) {
            Write-Log "✅ Health check passed" "SUCCESS"
            exit 0
        } else {
            Write-Log "❌ Health check failed" "ERROR"
            exit 1
        }
    }
    
    # Restart only mode
    if ($Restart) {
        Write-Log "Restart mode - stopping and starting application..." "INFO"
        Stop-Application
        Start-Sleep -Seconds 5
        if (Start-Application) {
            if (Test-ApplicationHealth) {
                Write-Log "✅ Application restart successful" "SUCCESS"
                exit 0
            }
        }
        Write-Log "❌ Application restart failed" "ERROR"
        exit 1
    }
    
    # Full deployment
    try {
        # Check prerequisites
        if (-not (Test-Prerequisites)) {
            throw "Prerequisites check failed"
        }
        
        # Build application
        if (-not (Build-Application)) {
            throw "Application build failed"
        }
        
        # Deploy database
        if (-not (Deploy-Database)) {
            throw "Database deployment failed"
        }
        
        # Stop existing application
        Stop-Application
        Start-Sleep -Seconds 5
        
        # Start new application
        if (-not (Start-Application)) {
            throw "Application startup failed"
        }
        
        # Health check
        if (-not (Test-ApplicationHealth)) {
            throw "Post-deployment health check failed"
        }
        
        $deploymentDuration = (Get-Date) - $deploymentStart
        Write-Log "🎉 Deployment completed successfully in $($deploymentDuration.TotalMinutes.ToString('F1')) minutes" "SUCCESS"
        
    } catch {
        Write-Log "💥 Deployment failed: $_" "ERROR"
        Write-Log "Check logs for details: $script:LogFile" "ERROR"
        exit 1
    }
}

# Execute main function
Start-Deployment 