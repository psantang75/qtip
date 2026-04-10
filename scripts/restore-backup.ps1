# Restore the QTIP database from a pre-migration backup
# Single-command rollback: .\restore-backup.ps1 -BackupFile "scripts\backups\pre-migration-YYYYMMDD_HHmmss.sql"

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

# Load environment variables from backend/.env
function Load-Env {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $envFile = "$ScriptDir\..\backend\.env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
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

$absBackupFile = (Resolve-Path $BackupFile).Path
Write-Host ""
Write-Host "WARNING: This will REPLACE all data in '$dbName' with the backup." -ForegroundColor Red
Write-Host "Backup file: $absBackupFile" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Type YES to confirm"
if ($confirm -ne "YES") {
    Write-Host "Restore cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host "Restoring database from backup..." -ForegroundColor Cyan

# Use mysql source command to restore
$escapedPath = $absBackupFile -replace '\\', '/'
$result = mysql -h $host_ -P $port -u $user -p"$pass" $dbName -e "source $escapedPath" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Restore failed: $result"
    exit 1
}

Write-Host "Restore complete." -ForegroundColor Green

# Print row counts for key tables
Write-Host ""
Write-Host "Row counts after restore:" -ForegroundColor Cyan
$tables = @("roles","departments","users","forms","calls","submissions","coaching_sessions","disputes","score_snapshots","audit_logs")
foreach ($t in $tables) {
    $count = mysql -h $host_ -P $port -u $user -p"$pass" $dbName -sN -e "SELECT COUNT(*) FROM \`$t\`" 2>&1
    Write-Host ("  {0,-35} {1}" -f $t, $count)
}
