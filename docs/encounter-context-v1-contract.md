# Encounter Context V1 Contract

This document freezes the production response contract for the encounter-scoped context surfaces introduced in MVP production hardening Phase 6.

## Scope

The contract covers:

1. `GET /api/encounters/{encounter_id}/context`
2. `GET /api/encounters/{encounter_id}/operational-context`

It does not add streaming chat, multi-agent runtime changes, or patient-level aggregation.

## Versioning

The encounter context response now exposes two version markers:

1. `contract_version`: semantic API contract version. Current value: `v1`.
2. `context_version`: freshness marker for the underlying encounter/job context snapshot. This is not a schema version and may change whenever the encounter or linked job is updated.

Operational context exposes:

1. `contract_version`: semantic API contract version. Current value: `v1`.

Breaking schema changes must bump `contract_version`.

## Encounter Context Response

### Shape

```json
{
  "encounter_id": "uuid",
  "status": "draft|capturing|review|ready_for_processing|processing|ready_for_review|approved|completed|failed",
  "generated_at": "2026-03-17T12:00:00Z",
  "linked_job_id": "uuid-or-null",
  "contract_version": "v1",
  "context_version": "freshness-marker",
  "items": [
    {
      "id": "stable-context-item-id",
      "category": "summary|transcript|relation|...",
      "kind": "clinical_summary|segment|clinical_entity|clinical_relation|...",
      "title": "Human-readable title",
      "text": "Renderable evidence text",
      "source": "encounter|job",
      "assertion": "optional-lowercase-assertion",
      "confidence_score": 0.98,
      "provenance": [
        {
          "source_type": "medical_entity|job_summary|encounter|...",
          "source_id": "source identifier",
          "excerpt": "optional excerpt"
        }
      ],
      "metadata": {}
    }
  ],
  "summary": {
    "total_items": 0,
    "returned_items": 0,
    "categories": [],
    "assertions": [],
    "applied_filters": {
      "q": null,
      "category": null,
      "assertion": null,
      "limit": 50
    }
  }
}
```

### Stability Rules

1. `linked_job_id` is always present and nullable.
2. `contract_version` is always present.
3. `context_version` is always present.
4. `items` is always an array.
5. `summary.categories` and `summary.assertions` are always arrays.
6. `summary.applied_filters` is always present, with nullable `q`, `category`, and `assertion` fields.
7. Each item always includes `provenance` and `metadata`; both default to empty collections.

### Empty Encounter Behavior

If the encounter has no linked processing job yet, or if the Search index contains no context documents for the encounter, the endpoint still returns `200 OK` with:

1. `items: []`
2. `summary.total_items: 0`
3. `summary.returned_items: 0`

This is a valid empty response, not an error.

## Operational Context Response

### Shape

```json
{
  "encounter_id": "uuid",
  "status": "...",
  "generated_at": "2026-03-17T12:00:00Z",
  "linked_job_id": "uuid-or-null",
  "contract_version": "v1",
  "eligibility": {
    "provider": "string",
    "status": "string",
    "member_reference": "string",
    "summary": "string",
    "freshness": {
      "fetched_at": "timestamp",
      "expires_at": "timestamp",
      "is_mock": true
    }
  },
  "scheme_qualification": {
    "provider": "string",
    "plan_name": "string",
    "qualification_status": "string",
    "summary": "string",
    "freshness": {
      "fetched_at": "timestamp",
      "expires_at": "timestamp",
      "is_mock": true
    }
  },
  "treatment_lookup": {
    "provider": "string",
    "results": [],
    "freshness": {
      "fetched_at": "timestamp",
      "expires_at": "timestamp",
      "is_mock": true
    }
  },
  "prior_auth_summaries": {
    "provider": "string",
    "results": [],
    "freshness": {
      "fetched_at": "timestamp",
      "expires_at": "timestamp",
      "is_mock": true
    }
  },
  "communication_options": {
    "provider": "string",
    "results": [],
    "freshness": {
      "fetched_at": "timestamp",
      "expires_at": "timestamp",
      "is_mock": true
    }
  },
  "audit_metadata": {}
}
```

### Stability Rules

1. `linked_job_id` is always present and nullable.
2. `contract_version` is always present.
3. `results` arrays are always arrays, never `null`.
4. `freshness` objects are always present for each provider snapshot.
5. `audit_metadata` is always an object.

## Frontend Alignment

The shared frontend contract is defined in:

1. `frontend-react/src/shared/types/api.ts`

That file must remain aligned with this document for MVP production hardening Phase 6.