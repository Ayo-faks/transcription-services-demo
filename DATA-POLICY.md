# Data Policy

## Scope

This document describes the MVP retention, deletion, and hosting posture for:

- encounter records
- transcription job records
- captured and uploaded audio blobs
- UK deployment expectations

## Data Stores

### Cosmos DB

The primary Cosmos DB database stores:

- encounter documents in the `transcriptions` container with `record_type=encounter`
- transcription job documents in the same container with `record_type=job`
- platform users, tenants, voice sessions, and audit records in dedicated platform containers when provisioned

Current MVP posture:

- encounter and job records do **not** have an automatic TTL
- platform voice sessions use TTL-backed cleanup
- audit records are retained until an explicit retention policy is added at the platform level

## Audio Blob Storage

Audio is stored in the `audio-files` blob container.

Observed blob paths in the backend include:

- `encounters/{encounter_id}/captured-audio.wav`
- `encounters/{encounter_id}/streaming/{session_id}/chunks/{sequence}.pcm`
- `{job_id}/{filename}` for direct upload jobs

## Audio Retention Lifecycle

The production Bicep templates now apply a storage lifecycle policy for encounter audio under the `encounters/` prefix:

- move to Cool tier after 30 days
- move to Archive tier after 180 days
- delete after 2920 days (8 years)

This is an MVP-safe default aligned with a conservative UK clinical-retention posture. If a deployment needs a different retention schedule, change the Bicep parameters explicitly rather than editing storage by hand.

Job-upload blobs outside the `encounters/` prefix are not currently lifecycle-managed by template. Treat them as a documented gap and include them in operational deletion reviews until a broader storage policy is introduced.

## Deletion Expectations

The MVP does not yet provide a self-service delete API for encounters, jobs, or tenant data.

Deletion therefore remains an operational task:

1. remove or tombstone the Cosmos record(s)
2. delete related audio blobs
3. remove encounter-local search documents if present
4. record the deletion in the platform audit log or deployment log

Do not delete blobs without confirming whether the associated encounter and job metadata also needs to be removed.

## UK Data Residency

Production deployments are expected to stay in approved UK regions.

Current repo posture:

- deployment workflows default to `uksouth`
- production examples and plans assume UK-hosted resources
- do not move production resources outside approved UK regions without an explicit compliance decision

## Local Auth And Resource Authentication

`LOCAL_DEV_AUTH` is a local-development aid only.

- `local.settings.example.json` now defaults `LOCAL_DEV_AUTH` to `false`
- enable it explicitly only for local test runs
- it must remain disabled in production

For supported Azure resources, local key-based auth should remain disabled in production templates:

- Cosmos DB: `disableLocalAuth=true`
- Speech: `disableLocalAuth=true`
- Language: `disableLocalAuth=true`
- Azure OpenAI: `disableLocalAuth=true`

Keep managed identity or platform-native auth as the production default.