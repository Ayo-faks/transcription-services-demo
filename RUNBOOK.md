# Runbook

## Scope

This runbook covers the MVP rollback path for:

- Azure Function App code deploys
- static frontend deploys from `frontend-react/dist`
- current Cosmos DB recovery posture
- minimum post-rollback verification

## Function Rollback

Use this when a backend deployment breaks API behavior but infrastructure is unchanged.

1. Identify the last known-good function artifact.
2. Redeploy that artifact to the existing Function App with the same mechanism used for the forward deploy.
3. Restart the Function App.
4. Re-run the backend smoke checks:
   - `GET /api/health` must return `status=healthy` with healthy dependencies.
   - Anonymous `POST /api/encounters` must return `401`.

### GitHub Actions path

1. Re-run the last known-good `deploy-function.yml` workflow run if it published the desired artifact.
2. If the old workflow run is unavailable, redeploy the previous `deploy.zip` package through the Function App deployment channel.

### Azure CLI path

1. Upload the previous zip package to the same Function App.
2. Restart the app:

```bash
az functionapp restart --name <function-app-name> --resource-group <resource-group>
```

## Frontend Rollback

Use this when the React deployment is bad but the backend remains healthy.

1. Identify the last known-good static bundle for `frontend-react/dist`.
2. Delete the current contents of the `$web` container.
3. Upload the previous bundle.
4. Verify the landing page and runtime config.

### Azure CLI path

```bash
az storage blob delete-batch \
  --account-name <frontend-storage-account> \
  --auth-mode login \
  --source '$web' \
  --pattern '*'

az storage blob upload-batch \
  --account-name <frontend-storage-account> \
  --auth-mode login \
  --destination '$web' \
  --source ./frontend-react/dist \
  --overwrite
```

### Required verification

1. `curl <frontend-url>` returns `200` and contains `id="root"`.
2. `curl <frontend-url>/config.js` returns `200` and contains `apiBaseUrl`.
3. `curl <frontend-url>/config.js` returns `200` and contains `voiceLive` plus `gatewayBaseUrl` when ambient capture is expected to work.
4. Browser login still redirects correctly and the shell loads.
5. `./scripts/staging-smoke.sh --api-base-url https://<function-app-name>.azurewebsites.net/api --frontend-url <frontend-url>` passes the combined backend and frontend checks.

## Cosmos DB Recovery Posture

The current repo does not declare a Cosmos DB backup policy in Bicep and does not ship repo-driven restore automation.

- Treat the current recovery posture as Azure-managed account backup only.
- Do not assume point-in-time restore is operator-self-service from this repo.
- If record recovery is required, use Azure portal or Azure support procedures appropriate to the account backup mode that is active on the deployed account.

Operationally, this means code rollback is fast, but data rollback is manual and must be coordinated before production changes that could mutate encounter or tenant data at scale.

## Post-Rollback Checks

Run these after either backend or frontend rollback:

1. `GET /api/health` returns healthy dependencies.
2. Anonymous `POST /api/encounters` returns `401`.
3. Authenticated session bootstrap still loads `/api/auth/session`.
4. Encounter read, review, and results routes still load for a known-good tenant user.
5. Frontend landing page returns `200` and loads `config.js` with the expected Voice Live gateway configuration.
6. `./scripts/staging-smoke.sh --api-base-url https://<function-app-name>.azurewebsites.net/api --frontend-url <frontend-url>` passes.
7. Application Insights or deployment logs show the new instance has stabilized.

## Escalation Notes

- If health is degraded because of dependency configuration, fix configuration first; do not keep redeploying code.
- If rollback requires data restoration, pause further deploys until the Cosmos recovery path is confirmed.