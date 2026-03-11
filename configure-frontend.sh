#!/bin/bash
# configure-frontend.sh - Update frontend API URL after deployment
# Usage: ./configure-frontend.sh <function-app-name>

FUNCTION_APP_NAME=$1

if [ -z "$FUNCTION_APP_NAME" ]; then
    echo "Usage: ./configure-frontend.sh <function-app-name>"
    echo "Example: ./configure-frontend.sh healthtranscript-dev-func-abc123"
    exit 1
fi

API_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net/api"

echo "Updating frontend to use API: $API_URL"

# Update config.js
cat > frontend/config.js <<EOF
window.APP_CONFIG = {
    apiBaseUrl: '${API_URL}'
};
EOF

echo "✓ Frontend updated!"
echo ""
echo "Next steps:"
echo "1. Commit and push changes"
echo "2. GitHub Actions will deploy the updated frontend"
