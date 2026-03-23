# Test authentication endpoint
$baseUrl = "http://localhost:3000/api/auth"
$testEmail = "admin@qtip.com" # Use admin email
$testPassword = "pass1234"

Write-Host "Testing auth endpoint at $baseUrl..."

# Test login endpoint
Write-Host "Sending login request to $baseUrl/login"
try {
    $loginRequest = @{
        Method = "POST"
        Uri = "$baseUrl/login"
        Body = @{
            email = $testEmail
            password = $testPassword
        } | ConvertTo-Json
        ContentType = "application/json"
    }
    
    $response = Invoke-RestMethod @loginRequest
    Write-Host "Login successful!" -ForegroundColor Green
    Write-Host "User: $($response.user.username) (ID: $($response.user.id), Role: $($response.user.role_id))"
    Write-Host "Token received: $($response.token.Substring(0, 10))..."
} catch {
    Write-Host "Login failed with status $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    
    # Try to get error details
    try {
        $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "Error: $($errorDetails.error)" -ForegroundColor Red
    } catch {
        Write-Host "Error details: $_" -ForegroundColor Red
    }
} 