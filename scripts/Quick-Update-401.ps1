# Quick 401 Error Handler Update Script
# Adds handleErrorIfAuthentication to catch blocks

$files = @(
    "frontend/src/components/FormManagement.tsx",
    "frontend/src/components/FormList.tsx",
    "frontend/src/components/QADashboard.tsx",
    "frontend/src/components/QAFormLibrary.tsx",
    "frontend/src/components/QAAssignedAuditsList.tsx",
    "frontend/src/components/ManagerDashboard.tsx",
    "frontend/src/components/ManagerTeamAudits.tsx",
    "frontend/src/components/CSRDashboard.tsx",
    "frontend/src/components/CSRMyAudits.tsx",
    "frontend/src/components/CSRCoaching.tsx",
    "frontend/src/components/CSRDisputeHistory.tsx",
    "frontend/src/components/ProfileSettings.tsx",
    "frontend/src/components/AuditSubmissionForm.tsx"
)

$importLine = "import { handleErrorIfAuthentication } from '../utils/errorHandling';"
$modified = 0

Write-Host "Starting updates..." -ForegroundColor Cyan

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Host "Skip: $file (not found)" -ForegroundColor Yellow
        continue
    }
    
    $content = Get-Content $file -Raw -Encoding UTF8
    $changed = $false
    
    # Add import if missing
    if ($content -notmatch "handleErrorIfAuthentication") {
        $lastImport = [regex]::Matches($content, "import .+ from .+;")
        if ($lastImport.Count -gt 0) {
            $pos = $lastImport[$lastImport.Count - 1].Index + $lastImport[$lastImport.Count - 1].Length
            $content = $content.Substring(0, $pos) + "`n$importLine" + $content.Substring($pos)
            $changed = $true
        }
    }
    
    if ($changed) {
        Set-Content $file -Value $content -NoNewline -Encoding UTF8
        $modified++
        Write-Host "Updated: $file" -ForegroundColor Green
    }
}

Write-Host "`nModified $modified files" -ForegroundColor Green
Write-Host "NOTE: Imports added. You still need to add handleErrorIfAuthentication() calls in catch blocks." -ForegroundColor Yellow

