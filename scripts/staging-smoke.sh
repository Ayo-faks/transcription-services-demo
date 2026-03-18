#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL=""
FRONTEND_URL=""
AUTH_HEADER="${SMOKE_AUTH_HEADER:-}"
TENANT_ID="${SMOKE_TENANT_ID:-}"
EXPECTED_DEFAULT_TENANT_ID="${EXPECTED_DEFAULT_TENANT_ID:-}"
VOICE_SESSION_BODY='{}'

usage() {
    cat <<'EOF'
Usage: ./scripts/staging-smoke.sh --api-base-url <url> [options]

Options:
  --api-base-url <url>             Required. Base API URL ending with /api or not.
  --frontend-url <url>             Optional. Static website URL. When provided, checks landing page and config.js.
  --auth-header <header>           Optional. Raw HTTP header used for authenticated checks, e.g. 'Cookie: AppServiceAuthSession=...'.
  --tenant-id <tenant-id>          Optional. Sends X-Clinical-Tenant-Id for tenant-scoped calls.
  --expected-default-tenant-id <id>
                                   Optional. Validates auth/session payload when authenticated.
  --voice-session-body <json>      Optional. JSON body for POST /voice-sessions. Defaults to '{}'.

Environment variable equivalents:
  SMOKE_AUTH_HEADER
  SMOKE_TENANT_ID
  EXPECTED_DEFAULT_TENANT_ID
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --api-base-url)
            API_BASE_URL="$2"
            shift 2
            ;;
        --frontend-url)
            FRONTEND_URL="$2"
            shift 2
            ;;
        --auth-header)
            AUTH_HEADER="$2"
            shift 2
            ;;
        --tenant-id)
            TENANT_ID="$2"
            shift 2
            ;;
        --expected-default-tenant-id)
            EXPECTED_DEFAULT_TENANT_ID="$2"
            shift 2
            ;;
        --voice-session-body)
            VOICE_SESSION_BODY="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -z "$API_BASE_URL" ]]; then
    echo "--api-base-url is required" >&2
    usage >&2
    exit 1
fi

API_BASE_URL="${API_BASE_URL%/}"
if [[ "$API_BASE_URL" != */api ]]; then
    API_BASE_URL="${API_BASE_URL}/api"
fi

if [[ -n "$FRONTEND_URL" ]]; then
    FRONTEND_URL="${FRONTEND_URL%/}/"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

declare -a AUTH_CURL_ARGS=()
if [[ -n "$AUTH_HEADER" ]]; then
    AUTH_CURL_ARGS+=(-H "$AUTH_HEADER")
fi
if [[ -n "$TENANT_ID" ]]; then
    AUTH_CURL_ARGS+=(-H "X-Clinical-Tenant-Id: $TENANT_ID")
fi

echo "==> Checking ${API_BASE_URL}/health"
curl -fsS --retry 6 --retry-delay 10 --retry-all-errors "${API_BASE_URL}/health" > "${TMP_DIR}/health.json"

HEALTH_PATH="${TMP_DIR}/health.json" python - <<'PY'
import json
import os

with open(os.environ["HEALTH_PATH"], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

bad_dependencies = sorted(
    name for name, details in (payload.get("dependencies") or {}).items()
    if details.get("status") != "healthy"
)

if payload.get("status") != "healthy":
    raise SystemExit(f"Health endpoint returned status={payload.get('status')} bad_dependencies={bad_dependencies}")

print(f"Health ok with dependencies={sorted((payload.get('dependencies') or {}).keys())}")
PY

echo "==> Checking ${API_BASE_URL}/auth/session"
AUTH_STATUS="$(curl -sS -o "${TMP_DIR}/auth-session.json" -w "%{http_code}" --retry 3 --retry-delay 5 --retry-all-errors "${AUTH_CURL_ARGS[@]}" "${API_BASE_URL}/auth/session")"

if [[ -n "$AUTH_HEADER" ]]; then
    if [[ "$AUTH_STATUS" != "200" ]]; then
        echo "Expected authenticated GET /auth/session to return 200, got ${AUTH_STATUS}" >&2
        cat "${TMP_DIR}/auth-session.json" >&2
        exit 1
    fi

    AUTH_SESSION_PATH="${TMP_DIR}/auth-session.json" EXPECTED_DEFAULT_TENANT_ID="$EXPECTED_DEFAULT_TENANT_ID" python - <<'PY'
import json
import os

with open(os.environ["AUTH_SESSION_PATH"], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

required_keys = [
    "authenticated",
    "user_id",
    "memberships",
    "can_create_tenant",
    "has_default_tenant_membership",
]
missing = [key for key in required_keys if key not in payload]
if missing:
    raise SystemExit(f"Authenticated /auth/session missing keys={missing}")

if payload.get("authenticated") is not True:
    raise SystemExit("Authenticated /auth/session did not report authenticated=true")

expected_default_tenant_id = os.environ.get("EXPECTED_DEFAULT_TENANT_ID")
if expected_default_tenant_id and payload.get("default_tenant_id") != expected_default_tenant_id:
    raise SystemExit(
        f"Expected default_tenant_id={expected_default_tenant_id} got {payload.get('default_tenant_id')}"
    )

print(
    "Auth session ok for user_id={user_id} memberships={memberships} can_create_tenant={can_create_tenant}".format(
        user_id=payload.get("user_id"),
        memberships=len(payload.get("memberships") or []),
        can_create_tenant=payload.get("can_create_tenant"),
    )
)
PY
else
    if [[ "$AUTH_STATUS" != "401" ]]; then
        echo "Expected anonymous GET /auth/session to return 401, got ${AUTH_STATUS}" >&2
        cat "${TMP_DIR}/auth-session.json" >&2
        exit 1
    fi

    echo "Anonymous auth/session check passed with expected 401"
fi

echo "==> Checking ${API_BASE_URL}/voice-sessions"
VOICE_STATUS="$(curl -sS -o "${TMP_DIR}/voice-session.json" -w "%{http_code}" --retry 3 --retry-delay 5 --retry-all-errors -X POST -H "Content-Type: application/json" "${AUTH_CURL_ARGS[@]}" -d "$VOICE_SESSION_BODY" "${API_BASE_URL}/voice-sessions")"

if [[ -n "$AUTH_HEADER" && -n "$TENANT_ID" ]]; then
    if [[ "$VOICE_STATUS" != "201" ]]; then
        echo "Expected authenticated POST /voice-sessions to return 201, got ${VOICE_STATUS}" >&2
        cat "${TMP_DIR}/voice-session.json" >&2
        exit 1
    fi

    VOICE_SESSION_PATH="${TMP_DIR}/voice-session.json" python - <<'PY'
import json
import os

with open(os.environ["VOICE_SESSION_PATH"], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

for key in ("session_token", "expires_at"):
    if not payload.get(key):
        raise SystemExit(f"Authenticated /voice-sessions missing {key}")

print(f"Voice session ok expires_at={payload.get('expires_at')}")
PY
elif [[ -n "$AUTH_HEADER" ]]; then
    if [[ "$VOICE_STATUS" != "400" ]]; then
        echo "Expected authenticated POST /voice-sessions without tenant to return 400, got ${VOICE_STATUS}" >&2
        cat "${TMP_DIR}/voice-session.json" >&2
        exit 1
    fi

    if ! grep -q 'TENANT_REQUIRED' "${TMP_DIR}/voice-session.json"; then
        echo "Expected TENANT_REQUIRED response from /voice-sessions without tenant context" >&2
        cat "${TMP_DIR}/voice-session.json" >&2
        exit 1
    fi

    echo "Authenticated voice-sessions check passed with expected 400 TENANT_REQUIRED"
else
    if [[ "$VOICE_STATUS" != "401" ]]; then
        echo "Expected anonymous POST /voice-sessions to return 401, got ${VOICE_STATUS}" >&2
        cat "${TMP_DIR}/voice-session.json" >&2
        exit 1
    fi

    echo "Anonymous voice-sessions check passed with expected 401"
fi

if [[ -n "$FRONTEND_URL" ]]; then
    echo "==> Checking ${FRONTEND_URL}"
    curl -fsS --retry 6 --retry-delay 10 --retry-all-errors "$FRONTEND_URL" > "${TMP_DIR}/index.html"
    grep -q 'id="root"' "${TMP_DIR}/index.html"

    echo "==> Checking ${FRONTEND_URL}config.js"
    curl -fsS --retry 6 --retry-delay 10 --retry-all-errors "${FRONTEND_URL}config.js" > "${TMP_DIR}/config.js"
    grep -q 'apiBaseUrl' "${TMP_DIR}/config.js"
    grep -q 'voiceLive' "${TMP_DIR}/config.js"
    grep -q 'gatewayBaseUrl' "${TMP_DIR}/config.js"
    grep -q "$API_BASE_URL" "${TMP_DIR}/config.js"

    echo "Frontend landing page and config.js checks passed"
fi

echo "Staging smoke checks passed"