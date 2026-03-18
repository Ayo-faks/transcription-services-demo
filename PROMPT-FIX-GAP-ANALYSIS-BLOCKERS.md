# Fix MVP Gap Analysis Blocker: Application Insights Structured Telemetry

## Context

The repo gap analysis (`GAP-ANALYSIS-MVP-EXPLAINABILITY.md`) identified one remaining release blocker:

**H1 — `azure-monitor-opentelemetry` is missing from `requirements.txt` and no `configure_azure_monitor()` call exists in `function_app.py`.**

The infrastructure side is already done:
- `main.bicep` provisions Application Insights and passes both `APPINSIGHTS_INSTRUMENTATIONKEY` and `APPLICATIONINSIGHTS_CONNECTION_STRING` to the Function App settings.
- `host.json` has basic Application Insights sampling config.
- The backend already uses `logging.getLogger(__name__)` throughout (7163 lines, consistent `logger.info/error/warning` calls).

What is missing is the SDK that bridges Python's stdlib `logging` to Application Insights as structured traces, requests, and dependencies.

## Scope

Fix **only** this blocker. Do not refactor logging, add new log lines, or restructure the backend.

## Required changes

### 1. `requirements.txt` — add the SDK

Add `azure-monitor-opentelemetry` to `requirements.txt`. Place it in the Azure Functions section alongside the other Azure SDKs.

### 2. `function_app.py` — call `configure_azure_monitor()` early

Add the `configure_azure_monitor()` call **before** the existing `logging.basicConfig()` and logger creation (currently around lines 22-24). The SDK must be configured before any instrumented libraries are imported or loggers are created.

The call must be **conditional** — only activate when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (i.e., in deployed environments, not local dev where it's typically absent):

```python
# Application Insights — structured telemetry (must run before logger creation)
_ai_connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
if _ai_connection_string:
    from azure.monitor.opentelemetry import configure_azure_monitor
    configure_azure_monitor(
        connection_string=_ai_connection_string,
        logger_name="function_app",
    )
```

Then ensure the existing logger uses the matching name:

```python
logger = logging.getLogger("function_app")
```

If the existing logger already uses `__name__`, change the `logger_name` parameter to match, or change the logger to use `"function_app"`. The names must match so the SDK captures all log output.

### 3. Verify — no other files need changes

- `host.json` — already has `applicationInsights.samplingSettings`. No changes needed.
- `main.bicep` — already passes `APPLICATIONINSIGHTS_CONNECTION_STRING`. No changes needed.
- `.github/workflows/deploy-function.yml` — already packages `requirements.txt` in deploy.zip. New dependency will be installed automatically.

## Constraints

- Do **not** add `opencensus` or any legacy telemetry SDK. Use only `azure-monitor-opentelemetry` (the current Microsoft-recommended OpenTelemetry distro).
- Do **not** add explicit `configure_azure_monitor()` in production-only startup guards beyond the connection string check — the presence of the env var is sufficient.
- Do **not** change the existing `logging.basicConfig(level=logging.INFO)` call. The Azure Monitor SDK hooks into the logging system alongside basicConfig, not instead of it.
- Do **not** add structured logging dimensions, custom spans, or telemetry enrichment in this change. That is a separate improvement. This change only bridges existing `logger.*` calls to Application Insights.
- Keep the import inside the `if` block so the SDK is never imported in local dev where the package may not be installed (the conditional import avoids `ImportError` in minimal local environments).

## Validation

After applying the changes:

1. Run `python -c "import function_app"` in the local venv (with `.venv` activated and `requirements.txt` installed) — must not raise `ImportError`.
2. Run the existing unit tests: `cd transcription-services-demo && python -m pytest tests/test_request_hardening.py tests/test_auth_context.py tests/test_context_contract.py -v` — all must pass (no regressions).
3. Start the local Functions host (`func start`) and confirm `/api/health` still returns 200 with healthy dependencies.
4. In a deployed environment, check Application Insights → Live Metrics or Logs (Traces) to confirm requests and log entries appear with structured fields.

## Files to edit

| File | Change |
|---|---|
| `requirements.txt` | Add `azure-monitor-opentelemetry` |
| `function_app.py` | Add conditional `configure_azure_monitor()` call before logger creation (~line 22) |

That's it. Two files, minimal diff.
