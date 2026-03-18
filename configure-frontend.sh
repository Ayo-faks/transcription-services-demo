#!/bin/bash
# configure-frontend.sh - Update frontend API URL for local or deployed environments
# Usage: ./configure-frontend.sh <function-app-name|api-url>

TARGET=$1

if [ -z "$TARGET" ]; then
    echo "Usage: ./configure-frontend.sh <function-app-name|api-url>"
    echo "Examples:"
    echo "  ./configure-frontend.sh healthtranscript-dev-func-abc123"
    echo "  ./configure-frontend.sh http://127.0.0.1:7072/api"
    exit 1
fi

if [[ "$TARGET" =~ ^https?:// ]]; then
    API_URL="$TARGET"
else
    API_URL="https://${TARGET}.azurewebsites.net/api"
fi

VOICE_LIVE_GATEWAY_URL="${VOICELIVE_GATEWAY_BASE_URL:-https://ca-web-zf52hos5pogn4.calmcoast-f5c04f8a.swedencentral.azurecontainerapps.io}"

echo "Updating frontend to use API: $API_URL"
echo "Using Voice Live gateway: $VOICE_LIVE_GATEWAY_URL"

write_config() {
    local target_path="$1"

    cat > "$target_path" <<EOF
window.APP_CONFIG = window.APP_CONFIG || {};

window.APP_CONFIG.apiBaseUrl = '${API_URL}';

window.APP_CONFIG.voiceLive = window.APP_CONFIG.voiceLive || {
    gatewayBaseUrl: '${VOICE_LIVE_GATEWAY_URL}',
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
EOF
}

# Update the React runtime config consumed by Vite from public/ during local dev and builds.
write_config frontend-react/public/config.js

echo "✓ React frontend updated!"
echo ""
echo "Next steps:"
echo "1. Start or rebuild frontend-react"
echo "2. Verify the app points at the intended API"
