# QTIP Database Deployment Script
# Handles database migrations, backups, and deployment verification

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment,
    
    [Parameter(Mandatory=$false)]
    [switch]$BackupFirst,
    
    [Parameter(Mandatory=$false)]
    [switch]$VerifyOnly,
    
    [Parameter(Mandatory=$false)]
    [switch]$RollbackMode
)

# Load environment variables from .env file
function Load-Environment {
    param([string]$envFile = ".env")
    
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)\s*$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim()
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
        Write-Host "✅ Environment variables loaded from $envFile" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Environment file $envFile not found" -ForegroundColor Yellow
    }
}

# Database connection function
function Test-DatabaseConnection {
    param(
        [string]$DbHost = $env:DB_HOST,
        [string]$User = $env:DB_USER,
        [string]$Password = $env:DB_PASSWORD,
        [string]$Database = $env:DB_NAME
    )
    
    try {
        $testQuery = "SELECT 1 as test"
        $result = mysql -h $DbHost -u $User -p"$Password" $Database -e "$testQuery" 2>$null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Database connection successful" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Database connection failed" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ Database connection error: $_" -ForegroundColor Red
        return $false
    }
}

# Create database backup
function New-DatabaseBackup {
    param(
        [string]$BackupPath = "./backups"
    )
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = "$BackupPath/qtip_backup_$Environment`_$timestamp.sql"
    
    # Create backup directory if it doesn't exist
    if (-not (Test-Path $BackupPath)) {
        New-Item -ItemType Directory -Path $BackupPath -Force
    }
    
    Write-Host "🔄 Creating database backup..." -ForegroundColor Cyan
    
    try {
        $dumpCmd = "mysqldump -h $env:DB_HOST -u $env:DB_USER -p`"$env:DB_PASSWORD`" --single-transaction --routines --triggers $env:DB_NAME"
        Invoke-Expression "$dumpCmd > `"$backupFile`""
        
        if ($LASTEXITCODE -eq 0 -and (Test-Path $backupFile)) {
            $fileSize = (Get-Item $backupFile).Length / 1MB
            Write-Host "✅ Backup created: $backupFile ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
            return $backupFile
        } else {
            Write-Host "❌ Backup failed" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "❌ Backup error: $_" -ForegroundColor Red
        return $null
    }
}

# Apply database migrations
function Invoke-DatabaseMigrations {
    $migrationPath = "./database"
    $migrationsPath = "$migrationPath/migrations"
    
    Write-Host "🔄 Applying database migrations..." -ForegroundColor Cyan
    
    # Apply main schema if this is a fresh deployment
    $schemaFile = "$migrationPath/qtip_database_schema_6.13.2025.sql"
    if (Test-Path $schemaFile) {
        Write-Host "📄 Applying main schema..." -ForegroundColor Yellow
        
        try {
            mysql -h $env:DB_HOST -u $env:DB_USER -p"$env:DB_PASSWORD" $env:DB_NAME -e "source $schemaFile"
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Main schema applied successfully" -ForegroundColor Green
            } else {
                Write-Host "❌ Main schema application failed" -ForegroundColor Red
                return $false
            }
        } catch {
            Write-Host "❌ Schema error: $_" -ForegroundColor Red
            return $false
        }
    }
    
    # Apply incremental migrations
    if (Test-Path $migrationsPath) {
        $migrationFiles = Get-ChildItem -Path $migrationsPath -Filter "*.sql" | Sort-Object Name
        
        foreach ($migration in $migrationFiles) {
            Write-Host "📄 Applying migration: $($migration.Name)" -ForegroundColor Yellow
            
            try {
                mysql -h $env:DB_HOST -u $env:DB_USER -p"$env:DB_PASSWORD" $env:DB_NAME -e "source $($migration.FullName)"
                
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ Migration applied: $($migration.Name)" -ForegroundColor Green
                } else {
                    Write-Host "❌ Migration failed: $($migration.Name)" -ForegroundColor Red
                    return $false
                }
            } catch {
                Write-Host "❌ Migration error ($($migration.Name)): $_" -ForegroundColor Red
                return $false
            }
        }
    }
    
    return $true
}

# Verify database deployment
function Test-DatabaseDeployment {
    Write-Host "🔍 Verifying database deployment..." -ForegroundColor Cyan
    
    $verificationTests = @(
        @{ Name = "Users table"; Query = "SELECT COUNT(*) FROM users" },
        @{ Name = "Roles table"; Query = "SELECT COUNT(*) FROM roles" },
        @{ Name = "Departments table"; Query = "SELECT COUNT(*) FROM departments" },
        @{ Name = "Forms table"; Query = "SELECT COUNT(*) FROM forms" },
        @{ Name = "Admin user exists"; Query = "SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id = r.id WHERE r.role_name = 'Admin'" }
    )
    
    $allTestsPassed = $true
    
    foreach ($test in $verificationTests) {
        try {
            $result = mysql -h $env:DB_HOST -u $env:DB_USER -p"$env:DB_PASSWORD" $env:DB_NAME -e "$($test.Query)" -N 2>$null
            
            if ($LASTEXITCODE -eq 0 -and $result -match '\d+') {
                Write-Host "✅ $($test.Name): PASS" -ForegroundColor Green
            } else {
                Write-Host "❌ $($test.Name): FAIL" -ForegroundColor Red
                $allTestsPassed = $false
            }
        } catch {
            Write-Host "❌ $($test.Name): ERROR - $_" -ForegroundColor Red
            $allTestsPassed = $false
        }
    }
    
    return $allTestsPassed
}

# Main deployment logic
function Start-DatabaseDeployment {
    Write-Host "🚀 QTIP Database Deployment - $Environment Environment" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    
    # Load environment
    Load-Environment
    
    # Verify required environment variables
    $requiredVars = @("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME")
    $missingVars = $requiredVars | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
    
    if ($missingVars) {
        Write-Host "❌ Missing required environment variables: $($missingVars -join ', ')" -ForegroundColor Red
        exit 1
    }
    
    # Test database connection
    if (-not (Test-DatabaseConnection)) {
        Write-Host "❌ Cannot connect to database. Aborting deployment." -ForegroundColor Red
        exit 1
    }
    
    # Create backup if requested
    if ($BackupFirst -and -not $RollbackMode) {
        $backupFile = New-DatabaseBackup
        if (-not $backupFile) {
            Write-Host "❌ Backup failed. Aborting deployment." -ForegroundColor Red
            exit 1
        }
    }
    
    # Verification only mode
    if ($VerifyOnly) {
        $verificationResult = Test-DatabaseDeployment
        if ($verificationResult) {
            Write-Host "✅ Database verification completed successfully" -ForegroundColor Green
            exit 0
        } else {
            Write-Host "❌ Database verification failed" -ForegroundColor Red
            exit 1
        }
    }
    
    # Apply migrations
    if (-not $RollbackMode) {
        $migrationResult = Invoke-DatabaseMigrations
        if (-not $migrationResult) {
            Write-Host "❌ Migration failed. Check logs and consider rollback." -ForegroundColor Red
            exit 1
        }
    }
    
    # Final verification
    $verificationResult = Test-DatabaseDeployment
    if ($verificationResult) {
        Write-Host "🎉 Database deployment completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Post-deployment verification failed" -ForegroundColor Red
        exit 1
    }
}

# Execute main function
Start-DatabaseDeployment 