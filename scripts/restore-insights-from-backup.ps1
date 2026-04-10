# Restore Insights Engine tables from the pre-migration backup.
# Only touches: ie_config, ie_dim_date, ie_dim_department, ie_dim_employee,
#   ie_ingestion_log, ie_kpi, ie_kpi_threshold, ie_page, ie_page_role_access,
#   business_calendar_days
# All other tables are untouched.

param(
    [Parameter(Mandatory=$false)]
    [string]$BackupFile = ''
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Default backup location
if (-not $BackupFile) {
    $found = Get-ChildItem "$ScriptDir\backups\pre-migration-*.sql" -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending |
             Select-Object -First 1
    if ($found) { $BackupFile = $found.FullName }
}

if (-not $BackupFile -or -not (Test-Path $BackupFile)) {
    Write-Error 'Backup file not found. Pass -BackupFile path\to\backup.sql'
    exit 1
}

Write-Host "Using backup: $BackupFile" -ForegroundColor Cyan

# Load env
$envFile = "$ScriptDir\..\backend\.env"
if (-not (Test-Path $envFile)) { Write-Error "Cannot find backend/.env"; exit 1 }
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
        $n = $matches[1].Trim()
        $v = $matches[2].Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($n, $v, 'Process')
    }
}

$h    = $env:DB_HOST
$port = $env:DB_PORT
$u    = $env:DB_USER
$p    = $env:DB_PASSWORD
$db   = $env:DB_NAME

# Tables to restore (Insights Engine only)
$targetTables = @(
    'ie_config',
    'ie_dim_date',
    'ie_dim_department',
    'ie_dim_employee',
    'ie_ingestion_log',
    'ie_kpi',
    'ie_kpi_threshold',
    'ie_page',
    'ie_page_role_access',
    'business_calendar_days'
)

# Read backup content
Write-Host 'Reading backup file...' -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText($BackupFile)

# Extract INSERT statement for each target table
$sqlLines = @()
$sqlLines += 'SET FOREIGN_KEY_CHECKS = 0;'
$sqlLines += 'SET UNIQUE_CHECKS = 0;'
$sqlLines += ''

$found = @()
foreach ($t in $targetTables) {
    $pattern = "INSERT INTO ``$t``[^;]+;"
    $m = [regex]::Match($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($m.Success) {
        $sqlLines += $m.Value
        $sqlLines += ''
        $found += $t
        Write-Host "  Found INSERT for: $t" -ForegroundColor Green
    } else {
        Write-Host "  No INSERT found for: $t (table may have been empty)" -ForegroundColor DarkYellow
    }
}

# Reset AUTO_INCREMENT for tables that have an id column (not ie_config or business_calendar_days)
$autoIncrTables = @('ie_dim_date','ie_dim_department','ie_dim_employee','ie_ingestion_log','ie_kpi','ie_kpi_threshold','ie_page','ie_page_role_access')
foreach ($t in $autoIncrTables) {
    $sqlLines += "ALTER TABLE ``$t`` AUTO_INCREMENT = (SELECT IFNULL(MAX(id), 0) + 1 FROM ``$t``);"
}

$sqlLines += ''
$sqlLines += 'SET FOREIGN_KEY_CHECKS = 1;'
$sqlLines += 'SET UNIQUE_CHECKS = 1;'
$sqlLines += "SELECT 'Insights Engine restore complete.' AS status;"

# Write temp SQL file
$tmpSql = "$ScriptDir\backups\restore-insights-tmp.sql"
[System.IO.File]::WriteAllLines($tmpSql, $sqlLines, [System.Text.Encoding]::UTF8)
Write-Host "Temp SQL written to: $tmpSql" -ForegroundColor Cyan

# Run against the database
Write-Host 'Applying to database...' -ForegroundColor Cyan
$escapedPath = $tmpSql -replace '\\', '/'
$result = mysql -h $h -P $port -u $u -p"$p" $db -e "source $escapedPath" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "MySQL error: $result"
    exit 1
}
Write-Host 'SQL applied successfully.' -ForegroundColor Green

# Print row count summary
Write-Host ''
Write-Host 'Row counts after restore:' -ForegroundColor Yellow
$countSql = ($targetTables | ForEach-Object { "SELECT '$_' AS tbl, COUNT(*) AS cnt FROM ``$_``" }) -join ' UNION ALL '
mysql -h $h -P $port -u $u -p"$p" $db --table -e $countSql 2>$null

# Clean up temp file
Remove-Item $tmpSql -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Insights Engine restore complete.' -ForegroundColor Green
