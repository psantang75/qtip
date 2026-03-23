# PowerShell Script to Add 401 Error Handling to All Components
# This script adds handleErrorIfAuthentication checks to catch blocks

$ErrorActionPreference = "Stop"

# List of files to update (all component files with error handling)
$filesToUpdate = @(
    "frontend/src/components/DepartmentManagement.tsx",
    "frontend/src/components/FormManagement.tsx",
    "frontend/src/components/FormList.tsx",
    "frontend/src/components/FormBuilder.tsx",
    "frontend/src/components/SinglePageFormBuilder.tsx",
    "frontend/src/components/FormPreviewScreen.tsx",
    "frontend/src/components/QADashboard.tsx",
    "frontend/src/components/QAFormLibrary.tsx",
    "frontend/src/components/QAAssignedAuditsList.tsx",
    "frontend/src/components/QAAssignedReviews.tsx",
    "frontend/src/components/QAFormPreview.tsx",
    "frontend/src/components/ManagerDashboard.tsx",
    "frontend/src/components/ManagerTeamAudits.tsx",
    "frontend/src/components/ManagerCoachingSessions.tsx",
    "frontend/src/components/ManagerTeamTraining.tsx",
    "frontend/src/components/ManagerTeamGoals.tsx",
    "frontend/src/components/ManagerPerformanceReports.tsx",
    "frontend/src/components/ManagerDisputes.tsx",
    "frontend/src/components/TrainerManagerCoaching.tsx",
    "frontend/src/components/CSRDashboard.tsx",
    "frontend/src/components/CSRMyAudits.tsx",
    "frontend/src/components/CSRCoaching.tsx",
    "frontend/src/components/CSRTrainingDashboard.tsx",
    "frontend/src/components/CSRDisputeHistory.tsx",
    "frontend/src/components/CSRDisputeDetails.tsx",
    "frontend/src/components/CSRCourseViewer.tsx",
    "frontend/src/components/CSRCertificates.tsx",
    "frontend/src/components/TrainerDashboard.tsx",
    "frontend/src/components/TrainerAssignTraining.tsx",
    "frontend/src/components/AdminDashboard.tsx",
    "frontend/src/components/ProfileSettings.tsx",
    "frontend/src/components/AuditSubmissionForm.tsx",
    "frontend/src/components/AuditAssignmentsManagement.tsx",
    "frontend/src/components/AuditAssignment.tsx",
    "frontend/src/components/AuditAssignmentCreation.tsx",
    "frontend/src/components/DirectorAssignment.tsx",
    "frontend/src/components/MultipleCallSelector.tsx",
    "frontend/src/components/ComprehensiveAnalytics.tsx",
    "frontend/src/components/common/CoachingSessionFormModal.tsx",
    "frontend/src/components/common/CoachingSessionDetailsModal.tsx",
    "frontend/src/components/course/SimpleCourseBuilder.tsx",
    "frontend/src/components/admin/EnhancedPerformanceGoals.tsx",
    "frontend/src/components/admin/EnhancedPerformanceGoalForm.tsx"
)

$importLine = "import { handleErrorIfAuthentication } from '../utils/errorHandling';"
$importLineAlt = "import { handleErrorIfAuthentication } from '../../utils/errorHandling';" # For files in subdirectories

$filesProcessed = 0
$filesModified = 0
$errors = @()

Write-Host "Starting error handler updates..." -ForegroundColor Cyan
Write-Host ""

foreach ($file in $filesToUpdate) {
    if (-not (Test-Path $file)) {
        Write-Host "  Skipping $file (not found)" -ForegroundColor Yellow
        continue
    }
    
    $filesProcessed++
    $content = Get-Content $file -Raw
    $originalContent = $content
    $modified = $false
    
    # Determine correct import path based on subdirectory level
    $currentImport = $importLine
    if ($file -match "admin/|common/|course/|forms/|ui/|dispute/|compound/") {
        $currentImport = $importLineAlt
    }
    
    # Add import if not already present
    if ($content -notmatch "handleErrorIfAuthentication") {
        # Find the last import statement
        if ($content -match "(import .+ from .+;)\s*\n") {
            $lastImportMatch = [regex]::Matches($content, "import .+ from .+;")
            if ($lastImportMatch.Count -gt 0) {
                $lastImport = $lastImportMatch[$lastImportMatch.Count - 1]
                $insertPos = $lastImport.Index + $lastImport.Length
                $content = $content.Substring(0, $insertPos) + "`n$currentImport" + $content.Substring($insertPos)
                $modified = $true
            }
        }
    }
    
    # Pattern 1: catch (err: any) { with immediate setError/setErrorMessage
    $pattern1 = '(\} catch \((err|error)(?:: any)?\) \{)\s*\n(\s+)(setError(?:Message)?\()'
    $replacement1 = '$1' + "`n" + '$3if (handleErrorIfAuthentication($2)) {' + "`n" + '$3  return;' + "`n" + '$3}' + "`n" + '$3$4'
    if ($content -match $pattern1) {
        $content = $content -replace $pattern1, $replacement1
        $modified = $true
    }
    
    # Pattern 2: catch (err: any) { ... console.error ... setError
    $pattern2 = '(\} catch \((err|error)(?:: any)?\) \{)\s*\n(\s+)(console\.error[^;]+;)\s*\n(\s+)(setError(?:Message)?\()'
    $replacement2 = '$1' + "`n" + '$3$4' + "`n" + '$3if (handleErrorIfAuthentication($2)) {' + "`n" + '$3  return;' + "`n" + '$3}' + "`n" + '$5$6'
    if ($content -match $pattern2) {
        $content = $content -replace $pattern2, $replacement2
        $modified = $true
    }
    
    # Pattern 3: catch (err) without type annotation
    $pattern3 = '(\} catch \((err|error)\) \{)'
    $replacement3 = '} catch ($2: any) {'
    if ($content -match $pattern3) {
        $content = $content -replace $pattern3, $replacement3
        $modified = $true
    }
    
    # Write changes if modified
    if ($modified -and $content -ne $originalContent) {
        try {
            Set-Content $file -Value $content -NoNewline
            $filesModified++
            Write-Host "  ✓ Modified: $file" -ForegroundColor Green
        }
        catch {
            $errors += "Failed to write $file : $_"
            Write-Host "  ✗ Error writing: $file" -ForegroundColor Red
        }
    }
    else {
        Write-Host "  - No changes: $file" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Files processed: $filesProcessed" -ForegroundColor White
Write-Host "  Files modified: $filesModified" -ForegroundColor Green
if ($errors.Count -gt 0) {
    Write-Host "  Errors: $($errors.Count)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Errors:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "NOTE: Please review the changes and test thoroughly before committing." -ForegroundColor Yellow
Write-Host "Some catch blocks may require manual adjustment for complex error handling logic." -ForegroundColor Yellow
