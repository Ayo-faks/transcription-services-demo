# configure-frontend.ps1 - Update frontend API URL after deployment
# Usage: .\configure-frontend.ps1 -FunctionAppName <name>

param(
    [Parameter(Mandatory=$true)]
    [string]$FunctionAppName
)

$ApiUrl = "https://${FunctionAppName}.azurewebsites.net/api"

Write-Host "Updating frontend to use API: $ApiUrl" -ForegroundColor Cyan

# Update config.js
$configJsPath = "frontend/config.js"
$configJsContent = @"
window.APP_CONFIG = {
    apiBaseUrl: '$ApiUrl'
};
"@
Set-Content -Path $configJsPath -Value $configJsContent -NoNewline

Write-Host "Frontend updated!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Commit and push changes"
Write-Host "2. GitHub Actions will deploy the updated frontend"
