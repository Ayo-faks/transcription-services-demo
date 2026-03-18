# configure-frontend.ps1 - Update frontend API URL for local or deployed environments
# Usage: .\configure-frontend.ps1 -Target <function-app-name-or-api-url>

param(
    [Parameter(Mandatory=$true)]
    [string]$Target
)

if ($Target -match '^https?://') {
    $ApiUrl = $Target
}
else {
    $ApiUrl = "https://${Target}.azurewebsites.net/api"
}

$VoiceLiveGatewayUrl = if ($env:VOICELIVE_GATEWAY_BASE_URL) {
    $env:VOICELIVE_GATEWAY_BASE_URL
} else {
    "https://ca-web-zf52hos5pogn4.calmcoast-f5c04f8a.swedencentral.azurecontainerapps.io"
}

Write-Host "Updating frontend to use API: $ApiUrl" -ForegroundColor Cyan
Write-Host "Using Voice Live gateway: $VoiceLiveGatewayUrl" -ForegroundColor Cyan

function Set-FrontendConfig($ConfigJsPath) {
    $configJsContent = @"
window.APP_CONFIG = window.APP_CONFIG || {};

window.APP_CONFIG.apiBaseUrl = '$ApiUrl';

window.APP_CONFIG.voiceLive = window.APP_CONFIG.voiceLive || {
    gatewayBaseUrl: '$VoiceLiveGatewayUrl',
    wsUrl: '',
    wsPath: '/ws',
    mode: 'model',
    model: 'gpt-realtime',
    voiceType: 'azure-standard',
    voice: 'en-US-Ava:DragonHDLatestNeural',
    transcribeModel: 'gpt-4o-transcribe',
    inputLanguage: 'en',
    instructions: 'You are an ambient clinical scribe. Do not greet, answer, or speak unless explicitly instructed. Focus on transcribing the live clinician and patient conversation accurately.'
};
"@

    Set-Content -Path $ConfigJsPath -Value $configJsContent -NoNewline
}

# Update the React runtime config consumed by Vite from public/ during local dev and builds.
Set-FrontendConfig "frontend-react/public/config.js"

Write-Host "React frontend updated!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Start or rebuild frontend-react"
Write-Host "2. Verify the app points at the intended API"
