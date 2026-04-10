# Backup the current QTIP database before migration
# Creates a full mysqldump and prints the backup file path for use with restore-backup.ps1

param(
    [Parameter(Mandatory=$false)]
    [string]$BackupDir = ""
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $BackupDir) { $BackupDir = "$ScriptDir\backups" }

# Load environment variables from backend/.env
function Load-Env {
    $envFile = "$ScriptDir\..\backend\.env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
        Write-Host "Loaded environment from backend/.env" -ForegroundColor Cyan
    } else {
        Write-Error "Could not find backend/.env at $envFile"
        exit 1
    }
}

Load-Env

$host_   = if ($env:DB_HOST)  { $env:DB_HOST }  else { "localhost" }
$port    = if ($env:DB_PORT)  { $env:DB_PORT }  else { "3306" }
$user    = if ($env:DB_USER)  { $env:DB_USER }  else { "root" }
$pass    = $env:DB_PASSWORD
$dbName  = if ($env:DB_NAME)  { $env:DB_NAME }  else { "qtip" }

# Verify connection
$testResult = mysql -h $host_ -P $port -u $user -p"$pass" $dbName -e "SELECT 1 AS ok" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cannot connect to database. Check backend/.env credentials."
    exit 1
}
Write-Host "Database connection verified." -ForegroundColor Green

# Create backup directory
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir\pre-migration-$timestamp.sql"

Write-Host "Creating backup of '$dbName' to:" -ForegroundColor Cyan
Write-Host "  $backupFile" -ForegroundColor White

$dumpArgs = @(
    "-h", $host_,
    "-P", $port,
    "-u", $user,
    "-p$pass",
    "--single-transaction",
    "--routines",
    "--triggers",
    "--no-tablespaces",
    "--add-drop-table",
    $dbName
)

$dumpOutput = & mysqldump @dumpArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "mysqldump failed. Output: $dumpOutput"
    exit 1
}

$dumpOutput | Out-File -FilePath $backupFile -Encoding utf8

$sizeMB = [math]::Round((Get-Item $backupFile).Length / 1MB, 2)
Write-Host "Backup complete: $sizeMB MB" -ForegroundColor Green
Write-Host ""
Write-Host "To restore this backup at any time, run:" -ForegroundColor Yellow
Write-Host "  .\restore-backup.ps1 -BackupFile `"$backupFile`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "BACKUP FILE PATH (save this):" -ForegroundColor Magenta
Write-Host "  $backupFile" -ForegroundColor Magenta
