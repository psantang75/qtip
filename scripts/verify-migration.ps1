# Post-migration verification: row counts + FK integrity check

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Load-Env {
    $envFile = Join-Path $ScriptDir '..\backend\.env'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
                $n = $matches[1].Trim()
                $v = $matches[2].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($n, $v, 'Process')
            }
        }
    } else {
        Write-Error 'Could not find backend/.env'
        exit 1
    }
}

Load-Env
$h    = $env:DB_HOST
$port = $env:DB_PORT
$u    = $env:DB_USER
$p    = $env:DB_PASSWORD
$db   = $env:DB_NAME

function Run-Query($sql) {
    return (mysql -h $h -P $port -u $u -p"$p" $db -sN -e $sql 2>&1)
}

Write-Host ''
Write-Host '=== QTIP Migration Verification ===' -ForegroundColor Cyan
Write-Host "Database: $db on ${h}:${port}" -ForegroundColor Gray
Write-Host ''

$tables = @(
    'roles','departments','users','forms','form_metadata_fields',
    'form_categories','form_questions','radio_options','form_question_conditions',
    'performance_goals','performance_goal_users','performance_goal_departments',
    'audit_assignments','department_managers','courses','quizzes','quiz_questions',
    'coaching_sessions','coaching_session_topics','calls','submissions',
    'submission_metadata','submission_calls','submission_answers','free_text_answers',
    'score_snapshots','disputes','dispute_score_history','audit_logs',
    'agent_activity','topics'
)

Write-Host 'Table Row Counts:' -ForegroundColor Yellow
foreach ($t in $tables) {
    $raw = Run-Query "SELECT COUNT(*) FROM \`$t\`"
    $cnt = [int]($raw -replace '[^0-9]','')
    if ($cnt -gt 0) {
        Write-Host ('  {0,-40} {1,8}' -f $t, $cnt) -ForegroundColor Green
    } else {
        Write-Host ('  {0,-40} {1,8}' -f $t, $cnt) -ForegroundColor DarkGray
    }
}

$allOk = $true
Write-Host ''
Write-Host 'FK Integrity Checks:' -ForegroundColor Yellow

$checks = @(
    'users.role_id|SELECT COUNT(*) FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE r.id IS NULL',
    'users.department_id|SELECT COUNT(*) FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.department_id IS NOT NULL AND d.id IS NULL',
    'submissions.form_id|SELECT COUNT(*) FROM submissions s LEFT JOIN forms f ON s.form_id = f.id WHERE f.id IS NULL',
    'submissions.submitted_by|SELECT COUNT(*) FROM submissions s LEFT JOIN users u ON s.submitted_by = u.id WHERE u.id IS NULL',
    'calls.csr_id|SELECT COUNT(*) FROM calls c LEFT JOIN users u ON c.csr_id = u.id WHERE u.id IS NULL',
    'coaching_sessions.csr_id|SELECT COUNT(*) FROM coaching_sessions cs LEFT JOIN users u ON cs.csr_id = u.id WHERE u.id IS NULL',
    'score_snapshots.csr_id|SELECT COUNT(*) FROM score_snapshots ss LEFT JOIN users u ON ss.csr_id = u.id WHERE u.id IS NULL',
    'disputes.submission_id|SELECT COUNT(*) FROM disputes d LEFT JOIN submissions s ON d.submission_id = s.id WHERE s.id IS NULL',
    'submission_answers.submission_id|SELECT COUNT(*) FROM submission_answers sa LEFT JOIN submissions s ON sa.submission_id = s.id WHERE s.id IS NULL'
)

foreach ($item in $checks) {
    $parts = $item -split '\|', 2
    $label = $parts[0]
    $sql   = $parts[1]
    $raw   = Run-Query $sql
    $count = [int]($raw -replace '[^0-9]','')
    if ($count -eq 0) {
        Write-Host "  PASS  $label" -ForegroundColor Green
    } else {
        Write-Host "  FAIL  $label - $count orphan rows" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ''
if ($allOk) {
    Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green
} else {
    Write-Host 'SOME CHECKS FAILED - review output above' -ForegroundColor Red
}
Write-Host ''
