# Production Preparation Script for QTIP
# This script removes development files and prepares the codebase for production

Write-Host "🚀 QTIP Production Preparation Script" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# Function to remove files safely
function Remove-FileIfExists {
    param([string]$filePath)
    if (Test-Path $filePath) {
        Remove-Item $filePath -Force
        Write-Host "  ✅ Removed: $filePath" -ForegroundColor Yellow
    }
}

# Remove test files from root directory
Write-Host "`n📁 Removing test files from root directory..." -ForegroundColor Cyan
$testFiles = @(
    "test_analytics_comparison.js",
    "test_analytics_quick.js", 
    "test_analytics_service.js",
    "test_final_form_operations.js",
    "test_form_creation_fixed.js",
    "test_form_operations_authenticated.js",
    "test_form_operations_simple.js",
    "test_form_operations_working.js",
    "test_form_operations.js",
    "test_step8_2_services.js",
    "test_step_8.2_success.js",
    "test_login_success.js",
    "test_detailed_login.js",
    "test_hooks_implementation.js",
    "test_spinner_sizes.js",
    "test_auth.ps1",
    "debug_analytics.js",
    "toggle_analytics.js",
    "week2_realistic_assessment.js",
    "hash_password.js"
)

foreach ($file in $testFiles) {
    Remove-FileIfExists $file
}

# Remove development documentation files
Write-Host "`n📄 Removing development documentation..." -ForegroundColor Cyan
$devDocs = @(
    "README_STEP_6.1_FEATURE_FLAGS.md",
    "README_STEP_6.2_AUTH_SERVICE.md", 
    "README_STEP_7.1_USER_SERVICE.md",
    "README_STEP_7.2_DEPARTMENT_SERVICE.md",
    "README_STEP_7_2_DEPARTMENT_SERVICE.md",
    "README-scoring-preview.md",
    "QTIP_REFACTOR_GUIDE.md",
    "SAFE_QTIP_REFACTOR_GUIDE.md",
    "FORM_SYSTEM_TEST_RESULTS.md",
    "analytics_comparison_summary.md"
)

foreach ($doc in $devDocs) {
    Remove-FileIfExists $doc
}

# Remove database setup scripts (keep migration scripts)
Write-Host "`n🗄️  Removing development database scripts..." -ForegroundColor Cyan
$dbScripts = @(
    "setup_db.ps1",
    "check_db.ps1",
    "create_test_user.ps1",
    "reset_passwords.ps1"
)

foreach ($script in $dbScripts) {
    Remove-FileIfExists $script
}

# Remove backend test files
Write-Host "`n🔧 Removing backend test files..." -ForegroundColor Cyan
Remove-FileIfExists "backend/test_db.js"
Remove-FileIfExists "backend/src/test_db.ts"
Remove-FileIfExists "backend/hash_password.js"

# Remove frontend test files
Write-Host "`n🎨 Removing frontend test files..." -ForegroundColor Cyan
Remove-FileIfExists "frontend/src/TEST_FILE.txt"

# Remove unnecessary files
Write-Host "`n🗑️  Removing unnecessary files..." -ForegroundColor Cyan
$unnecessaryFiles = @(
    "form-data.json",
    "calls_structure.txt",
    "logo.png.png",
    "rs.ps1",
    "run_verification.ps1",
    "form_verification_example.sql",
    "form_verification_query.sql"
)

foreach ($file in $unnecessaryFiles) {
    Remove-FileIfExists $file
}

# Create production directories if they don't exist
Write-Host "`n📁 Creating production directories..." -ForegroundColor Cyan
$productionDirs = @(
    "logs",
    "uploads",
    "backups"
)

foreach ($dir in $productionDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir
        Write-Host "  ✅ Created: $dir/" -ForegroundColor Green
    }
}

# Create .gitignore for production
Write-Host "`n📝 Updating .gitignore..." -ForegroundColor Cyan
$gitignoreContent = @"
# Dependencies
node_modules/
backend/node_modules/
frontend/node_modules/

# Production environment files
.env
.env.local
.env.production

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Uploads
uploads/
tmp/

# Database backups
backups/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Build outputs
dist/
build/
frontend/dist/
backend/dist/

# Temporary files
*.tmp
*.temp
"@

$gitignoreContent | Out-File -FilePath ".gitignore" -Encoding utf8
Write-Host "  ✅ Updated .gitignore" -ForegroundColor Green

Write-Host "`n🎉 Production preparation complete!" -ForegroundColor Green
Write-Host "`n⚠️  NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Create .env file from deploy/production_environment_template.env" -ForegroundColor White
Write-Host "2. Update all environment variables with production values" -ForegroundColor White
Write-Host "3. Set up SSL certificates" -ForegroundColor White
Write-Host "4. Configure production database" -ForegroundColor White
Write-Host "5. Set up monitoring and logging" -ForegroundColor White
Write-Host "6. Run npm run build for both frontend and backend" -ForegroundColor White
Write-Host "7. Test the application in staging environment" -ForegroundColor White 