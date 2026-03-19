# Wulo Scribe — Technical Documentation

**Product**: Healthcare Clinical Transcription & AI Analysis Platform  
**Stack**: Python Azure Functions (backend) · React + TypeScript (frontend) · Azure PaaS services  
**Last updated**: March 2026

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React SPA)                        │
│  Static site hosted on Azure Blob Storage ($web) / CDN             │
│  Routes: Upload · Ambient Scribe · Encounter Review · Results      │
└────────────────────────────┬────────────────────────────────────────┘
                             │  HTTPS (JSON / NDJSON / binary)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  BACKEND — Azure Functions (Python)                 │
│  function_app.py  ·  ~35 HTTP routes  ·  Anonymous auth level      │
│  Authentication via Azure Easy Auth (Google / Entra ID)            │
├────────────┬──────────┬──────────┬───────────┬─────────────────────┤
│  Auth &    │ Encounter│ Audio    │ Clinical  │ Assistant /         │
│  Tenancy   │ CRUD     │ Ingest   │ Processing│ Retrieval           │
└────────────┴──────────┴──────────┴───────────┴─────────────────────┘
       │            │          │           │              │
       ▼            ▼          ▼           ▼              ▼
  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐ ┌───────────┐
  │Cosmos DB│ │Blob Store│ │ Speech │ │ Language   │ │ AI Search │
  │(NoSQL)  │ │(audio)   │ │Service │ │(Health NER)│ │(vector +  │
  └─────────┘ └──────────┘ └────────┘ └────────────┘ │ semantic) │
                                            │         └───────────┘
                                            ▼
                                      ┌───────────┐
                                      │Azure OpenAI│
                                      │(GPT-4o-mini)│
                                      └───────────┘
```

**Key architectural decisions**:

- **Single-file backend**: All API routes and processing logic reside in `function_app.py` (~7 300 lines). This simplifies deployment to Azure Functions as a single zip package.
- **Background processing via threads**: Long-running clinical analysis is spawned in a daemon thread (`run_encounter_processing_job`) rather than a queue, keeping infrastructure simple.
- **Managed identity everywhere**: All Azure service calls prefer `DefaultAzureCredential` (managed identity) with connection-string fallback for local development.
- **Encounter-centric model**: Every user interaction (upload, ambient capture, review) produces an *encounter* that flows through a state machine from `draft` → `processing` → `ready_for_review` → `approved`.

---

## 2. Components

### 2.1 Backend — Azure Functions (Python 3.11+)

| File | Purpose |
|---|---|
| `function_app.py` | All HTTP route handlers, data models, AI processing pipeline, auth, search indexing, FHIR generation |
| `pdf_generator.py` | Converts markdown clinical summaries to professional PDF documents using fpdf2 |
| `host.json` | Azure Functions host config — route prefix `/api`, 10-minute timeout, App Insights sampling |
| `requirements.txt` | Python dependencies: `azure-functions`, `azure-cosmos`, `azure-storage-blob`, `azure-identity`, `azure-search-documents`, `fpdf2`, `requests` |

### 2.2 Frontend — React SPA

| Layer | Key files | Purpose |
|---|---|---|
| **Router** | `src/app/router/index.tsx` | Four routes: `/` (upload), `/ambient-scribe`, `/encounters/:id/review`, `/jobs/:id` |
| **Providers** | `AuthSessionProvider`, `RuntimeConfigProvider`, `PlatformShellProvider` | Manage auth state, API base URL, and UI shell |
| **Upload page** | `src/features/upload/UploadPage.tsx` | File picker and drag-and-drop audio upload |
| **Ambient Scribe** | `src/features/ambient/AmbientScribePage.tsx` | Real-time voice capture via Web Audio API + AudioWorklet |
| **Encounter Review** | `src/features/encounters/EncounterReviewPage.tsx` | Clinician review, edit, and approval of AI outputs |
| **Results page** | `src/features/results/ResultsPage.tsx` + 13 sub-components | Display transcripts, medical entities, summaries, FHIR, timeline |
| **Assistant** | `src/assistant/` (8 components, 3 stores, 2 transports) | Multi-turn clinical Q&A agent with NDJSON streaming |
| **API layer** | `src/api/client.ts`, `encountersApi.ts`, `jobsApi.ts`, `summaryApi.ts` | Typed HTTP client with auto-injected tenant header and credentials |
| **Shared types** | `src/shared/types/api.ts` | TypeScript interfaces matching every backend JSON shape |

### 2.3 Infrastructure (Bicep)

| File | Provisions |
|---|---|
| `infra/main.bicep` | Full stack: Storage Account, Cosmos DB, Azure Functions, Speech, Language, OpenAI, AI Search, App Insights, Key Vault, RBAC role assignments, Easy Auth config |
| `infra/function-only.bicep` | Lightweight: only the Function App with references to existing resources |

### 2.4 Tests

| File | Type |
|---|---|
| `tests/test_auth_context.py` | Unit — authentication claim parsing and tenant resolution |
| `tests/test_context_contract.py` | Unit — encounter context API contract validation |
| `tests/test_request_hardening.py` | Unit — input validation, payload size limits |
| `tests/clinician-flow-smoke.spec.cjs` | E2E (Playwright) — full clinician upload-to-review flow |
| `tests/retrieval-hardening.spec.cjs` | E2E (Playwright) — assistant retrieval edge cases |

---

## 3. Algorithms & Processing Logic

### 3.1 Transcription Pipeline

```
Audio bytes (WAV/MP3)
  │
  ├─ Upload to Azure Blob Storage (audio-files container)
  │
  └─ Send to Azure Speech Fast Transcription API
       ├─ Diarization enabled (up to 10 speakers)
       ├─ Profanity filter: Masked
       ├─ Returns: combined text + per-phrase speaker labels + offsets
       └─ Output stored on encounter: draft_text, diarized_phrases, speaker_count
```

### 3.2 Medical Entity Extraction (NER)

```
Transcript text
  │
  └─ split_text_into_chunks(max_chars=4500, overlap=350)
       │
       └─ For each chunk → Azure Language "Healthcare" task (REST, async polling)
            ├─ Entities: category, subcategory, text, offset, confidence, assertion, UMLS links
            ├─ Relations: relationType, entity roles
            └─ Aggregated with deduplication across chunk boundaries
```

**Assertion detection** classifies each entity as:
- **Certainty**: positive, negative, positive_possible, negative_possible
- **Conditionality**: hypothetical, conditional
- **Association**: patient, other (e.g. family history)
- **Temporal**: past, present, future

### 3.3 Clinical Summary Generation (LLM)

```
Entities + Relations + Transcript chunks
  │
  └─ Azure OpenAI (GPT-4o-mini, temperature=0.2)
       ├─ System prompt: clinical documentation specialist
       ├─ Structured output: 13 markdown sections
       │   (Clinical Summary, Structured Findings, Timeline,
       │    Assertions, Follow-Up, Medications, Tests, Referrals,
       │    HPI, ROS, PE, Assessment, Plan)
       └─ Token usage and estimated cost tracked
```

The summary text is then parsed into a section lookup (heading → text) and used to build all clinician-facing structured outputs:

| Builder function | Output |
|---|---|
| `build_structured_findings_items()` | Findings with labels, detail, evidence |
| `build_follow_up_items()` | Patient instructions with timeframes |
| `build_medication_change_items()` | Medication starts/stops/adjustments |
| `build_test_items()` | Lab/imaging/procedure orders |
| `build_referral_items()` | Specialty referral recommendations |
| `build_assertion_items()` | Negated or uncertain clinical statements |
| `build_timeline_items()` | Temporal event sequence |
| `build_final_note_sections()` | SOAP-style note: HPI, ROS, PE, Assessment, Plan |

### 3.4 Search Indexing

After processing completes, the system indexes all artefacts into Azure AI Search:

- Transcript segments and speaker phrases → chunked by `SEARCH_TEXT_CHUNK_CHARS` (900 chars)
- Clinical entities and relations → one document each
- Clinical summary sections → one document per heading

Each document gets a vector embedding from Azure OpenAI (`text-embedding-3-small`, 1536 dimensions) enabling hybrid search (keyword + vector + semantic reranking).

### 3.5 FHIR R4 Bundle Generation

Medical entities are mapped to FHIR resource types:

| Entity category | FHIR resource |
|---|---|
| Diagnosis | Condition |
| SymptomOrSign | Observation |
| MedicationName | MedicationStatement |
| TreatmentName | Procedure |
| BodyStructure | BodyStructure |
| Allergen | AllergyIntolerance |
| FamilyRelation | FamilyMemberHistory |
| ExaminationName | DiagnosticReport |

UMLS/SNOMED/ICD codes from entity links are mapped to FHIR coding system URIs. Assertion certainty maps to FHIR verification status (e.g. "negative" → "refuted").

### 3.6 Assistant Retrieval (Q&A)

The multi-turn assistant uses a retrieval-only approach:

1. Classify the question by focus area (symptom, medication, measurement, follow_up, red_flag, timing_location)
2. Query Azure AI Search with the question text (vector + semantic + filter by encounter)
3. Score and rerank results by kind priority + signal-term hits
4. Build a structured NDJSON response with `turn.started`, `turn.text_delta`, and `turn.completed` envelopes

---

## 4. Data Structures

### 4.1 EncounterSession

The central record representing a clinical encounter.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID string | Primary key and Cosmos partition key |
| `status` | enum | State machine: `draft` → `capturing` → `review` → `processing` → `ready_for_review` → `approved` → `completed` |
| `record_type` | string | Always `"encounter"` — discriminator in shared Cosmos container |
| `draft_text` | string | Current working transcript (editable) |
| `draft_version` | int | Monotonically increasing version counter |
| `draft_segments` | list[segment] | Ordered transcript segments with role, text, timestamp |
| `finalized_text` | string | Frozen transcript submitted for processing |
| `diarized_phrases` | list[phrase] | Speaker-attributed phrase objects from transcription |
| `speaker_count` | int | Number of distinct speakers detected |
| `draft_source` | string | Origin: `"audio_transcription"`, `"manual"`, `"ambient"` |
| `process_job_id` | UUID string | FK to the processing TranscriptionJob |
| `audio_blob_url` | string | Azure Blob URL of the uploaded audio file |
| `review_result` | dict | Cached full `ClinicianReviewResult` JSON |
| `events` | list[event] | Audit trail: `{type, at, details}` |
| `metadata` | dict | Arbitrary metadata (language, source info) |
| `owner_id` | UUID string | Platform user who created the encounter |
| `tenant_id` | UUID string | Multi-tenant isolation key |
| `error_message` | string | Populated on failure |
| `created_at` / `updated_at` | ISO 8601 | Timestamps |

### 4.2 TranscriptionJob

Tracks the background processing pipeline for an encounter.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID string | Primary key |
| `record_type` | string | Always `"job"` |
| `filename` | string | Display name (e.g. `encounter-{id}.txt`) |
| `status` | enum | `pending` → `transcribing` → `analyzing` → `completed` / `failed` |
| `processing_stage` | string | Finer granularity: `queued`, `clinical_analysis`, `summary_generation`, `search_indexing`, `completed`, `failed` |
| `transcription_text` | string | Full transcript text |
| `medical_entities` | dict | Complete NER output (entities, relations, summary, diarization) |
| `llm_summary` | dict | OpenAI summary response with text, token usage, cost |
| `source_encounter_id` | UUID string | Back-reference to encounter |
| `processing_time_seconds` | float | Wall-clock duration |
| `blob_url` | string | Audio blob reference |
| `owner_id` / `tenant_id` | UUID string | Ownership |
| `error_message` | string | Error details on failure |

### 4.3 ClinicalRequestContext

Thread-local auth context created per request.

| Field | Type | Purpose |
|---|---|---|
| `user_id` | string | Platform user document ID |
| `tenant_id` | string | Active tenant for this request |
| `role` | string | Role within the active tenant (`owner`, `admin`, `editor`, `reviewer`, `viewer`) |
| `correlation_id` | UUID | Request tracing identifier |
| `email` / `name` | string | Identity claims |
| `identity_provider` | string | `aad`, `google`, or `local-dev` |
| `memberships` | list | All tenant memberships for the user |

### 4.4 Platform User Document (Cosmos)

Stored in the `platform_users` container, partitioned by `issuer_subject`.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Document ID |
| `issuer` | string | Identity issuer URL |
| `issuer_subject` | string | `{issuer}::{sub}` — globally unique identity key |
| `email` / `name` | string | Profile fields |
| `memberships` | list | Array of `{tenant_id, tenant_name, tenant_slug, role}` |

### 4.5 ClinicianReviewResult (composite output)

The main payload returned to the frontend on `GET /api/encounters/{id}/results`. Contains:

- `transcript`: text, segments, diarized phrases, speaker count
- `medical_analysis`: entities, relationships, assertions, timeline
- `clinician_outputs`: clinical summary, structured findings, follow-up instructions, medication changes, tests, referrals, final note sections (HPI/ROS/PE/Assessment/Plan)
- `final_note_text`: rendered plain-text clinical note
- `links`: hypermedia links for approve/save/regenerate actions

---

## 5. Data Formats & Packets

### 5.1 Audio Upload

- **Content-Type**: `application/octet-stream`
- **Accepted formats**: WAV, MP3 (any format supported by Azure Speech Fast Transcription API)
- **Max size**: 100 MB (configurable via `MAX_AUDIO_UPLOAD_BYTES`)
- **Chunked upload**: Supported via audio session endpoints (start → chunks → finalize)

### 5.2 JSON API Payloads

All API responses are `application/json` unless noted. Example encounter creation:

```json
// POST /api/encounters  →  response
{
  "encounter_id": "a1b2c3d4-...",
  "status": "draft",
  "draft_version": 0,
  "draft_text": "",
  "links": {
    "self": "/api/encounters/a1b2c3d4-...",
    "audio": "/api/encounters/a1b2c3d4-.../audio",
    "finalize": "/api/encounters/a1b2c3d4-.../finalize"
  }
}
```

Example audio ingest response:

```json
// POST /api/encounters/{id}/audio  →  response
{
  "encounter_id": "a1b2c3d4-...",
  "draft_text": "Doctor said the headaches started two weeks ago...",
  "speaker_count": 2,
  "draft_version": 1,
  "status": "processing",
  "job_id": "e5f6g7h8-...",
  "processing_stage": "queued"
}
```

### 5.3 NDJSON Streaming (Assistant)

The assistant endpoint returns newline-delimited JSON envelopes:

```
{"event":"turn.started","requestId":"...","threadId":"...","turnId":"...","data":{}}
{"event":"turn.text_delta","requestId":"...","data":{"delta":"Based on the transcript..."}}
{"event":"turn.text_delta","requestId":"...","data":{"delta":" the patient reported..."}}
{"event":"turn.completed","requestId":"...","data":{"finalText":"Based on the transcript, the patient reported..."}}
```

### 5.4 Medical Entity Record

```json
{
  "text": "headache",
  "category": "SymptomOrSign",
  "subcategory": null,
  "confidence_score": 0.95,
  "offset": 142,
  "length": 8,
  "assertion": {
    "certainty": "positive",
    "conditionality": null,
    "association": "patient",
    "temporal": "present"
  },
  "links": [
    { "dataSource": "UMLS", "id": "C0018681" },
    { "dataSource": "SNOMED_CT", "id": "25064002" }
  ]
}
```

### 5.5 Search Index Document

```json
{
  "id": "base64-encoded-key",
  "context_item_id": "entity-42",
  "encounter_id": "a1b2c3d4-...",
  "job_id": "e5f6g7h8-...",
  "title": "SymptomOrSign – headache",
  "text": "headache reported by patient, onset two weeks ago",
  "category": "SymptomOrSign",
  "kind": "clinical_entity",
  "source": "encounter",
  "assertion": "positive",
  "source_type": "entity",
  "source_id": "entity-42",
  "chunk_index": 0,
  "updated_at": "2026-03-19T10:00:00Z",
  "confidence_score": 0.95,
  "content_hash": "a3f8b2c1...",
  "content_vector": [0.012, -0.034, ...]
}
```

### 5.6 FHIR R4 Bundle (excerpt)

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "total": 12,
  "entry": [
    {
      "resource": {
        "resourceType": "Condition",
        "id": "condition-1",
        "code": {
          "coding": [
            { "system": "http://www.nlm.nih.gov/research/umls", "code": "C0018681", "display": "headache" }
          ],
          "text": "headache"
        },
        "verificationStatus": {
          "coding": [
            { "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "confirmed" }
          ]
        }
      }
    }
  ]
}
```

### 5.7 PDF Clinical Report

Generated by `pdf_generator.py` using fpdf2. The rendered PDF includes:
- Patient/encounter metadata header
- Each markdown heading converted to a styled section
- Bullet lists, numbered lists, tables
- Professional healthcare colour palette

Returned as `application/pdf` from `GET /api/summary/{job_id}/pdf`.

---

## 6. Databases & Storage

| Service | Resource name | What it stores | Partitioning |
|---|---|---|---|
| **Azure Cosmos DB** (NoSQL) | Database: `transcription-db` | All application state | See containers below |
| — Container: `transcriptions` | Encounter documents and job documents (discriminated by `record_type`) | Partitioned by `/id` |
| — Container: `platform_users` | User profiles with identity bindings and tenant memberships | Partitioned by `/issuer_subject` |
| — Container: `platform_tenants` | Tenant configurations (name, slug, status, isolation mode) | Partitioned by `/id` |
| — Container: `platform_voice_sessions` | Ephemeral voice session tokens (TTL: 900 seconds) | Partitioned by `/id` |
| — Container: `platform_audit_log` | Audit events for every significant action | Partitioned by `/tenant_id` |
| **Azure Blob Storage** | Container: `audio-files` | Uploaded audio files (WAV/MP3) per encounter | Flat namespace, blob name = `{encounter_id}/{filename}` |
| **Azure AI Search** | Index: `clinical-context` | Vector + keyword searchable documents for entities, transcript chunks, summary sections, relations | Filterable by `encounter_id`, `job_id`, `category`, `kind` |

**Blob lifecycle policy** (configured in Bicep):
- Move to Cool tier after 30 days
- Move to Archive tier after 180 days
- Delete after 2 920 days (~8 years)

**Cosmos DB throughput**: 400 RU/s per container (provisioned).

---

## 7. External Services & APIs

| Service | What it does | How it is called |
|---|---|---|
| **Azure Speech — Fast Transcription API** (`/speechtotext/transcriptions:transcribe`) | Converts audio to text with multi-speaker diarization (up to 10 speakers) | REST POST, multipart/form-data (audio + JSON definition), Bearer token via managed identity |
| **Azure Language — Text Analytics for Health** (`/language/analyze-text/jobs`) | Extracts medical entities (symptoms, medications, diagnoses, procedures), relations, and assertions with UMLS/SNOMED/ICD links | REST POST to start, then poll `Operation-Location` header for results (up to 30 attempts, 2s interval) |
| **Azure OpenAI — GPT-4o-mini** (`/openai/deployments/{name}/chat/completions`) | Generates structured clinical summaries from transcript + extracted entities | REST POST, JSON, temperature=0.2, max_tokens=2500 |
| **Azure OpenAI — text-embedding-3-small** (`/openai/deployments/{name}/embeddings`) | Produces 1536-dimension vectors for search indexing and retrieval | REST POST |
| **Azure AI Search** (data plane REST + Python SDK) | Hybrid search combining keyword, vector, and semantic ranking for the assistant | Python SDK `SearchClient` for queries; `SearchIndexClient` for index management |
| **Azure Blob Storage** (Python SDK) | Store and retrieve audio files and other binary artefacts | `BlobServiceClient` with managed identity or connection string |
| **Azure Cosmos DB** (Python SDK) | CRUD for encounters, jobs, users, tenants, audit log | `CosmosClient` with managed identity or connection string |
| **Azure App Insights** (built-in + OpenTelemetry) | Request tracing, logging, performance metrics | Auto-instrumented by Azure Functions host; optional `configure_azure_monitor` for non-Functions contexts |
| **Azure Easy Auth** (platform layer) | Google OAuth and Microsoft Entra ID authentication without application code | Configured via the Function App's auth settings; the backend reads `X-MS-CLIENT-PRINCIPAL` headers |

---

## 8. Outputs & Results

### Stage-by-stage outputs

| Stage | Output | Format |
|---|---|---|
| **Audio upload** | Stored audio blob + diarized transcript | Blob (binary), encounter JSON updated |
| **Medical analysis** | Entities, relations, assertion counts, category breakdown | Nested JSON on the job's `medical_entities` field |
| **Summary generation** | 13-section markdown clinical note + token usage stats | `llm_summary` field on the job |
| **Search indexing** | Vector-indexed documents in AI Search | Search index documents |
| **Review result** | Composite `ClinicianReviewResult` combining all above | JSON, cached on `encounter.review_result` |
| **FHIR export** | FHIR R4 Bundle of all identified clinical resources | JSON, generated on-demand |
| **PDF export** | Professionally formatted clinical summary document | PDF binary |
| **Text export** | Plain-text formatted clinical note | Plain text |
| **Assistant response** | Streamed NDJSON answer based on retrieval from search index | `application/x-ndjson` |

### Final clinician output

The completed encounter delivers a "clinician review packet" containing:

1. **Clinical summary** — 2–3 sentence synopsis of the encounter
2. **Structured findings** — Labelled list of diagnoses, symptoms, signs
3. **Medication changes** — Starts, stops, dose adjustments with change type
4. **Tests & referrals** — Ordered labs, imaging, specialist consultations
5. **Follow-up instructions** — Patient-facing next steps
6. **Assertions** — Negated, uncertain, or conditional findings flagged for review
7. **Clinical timeline** — Ordered events with temporal labels
8. **Final note (SOAP-style)** — HPI, ROS, PE, Assessment, Plan — editable by clinician
9. **FHIR R4 bundle** — Interoperability-ready structured data

---

## 9. Clinician Workflow (Non-Technical Guide)

### Step 1: Sign in
Open the Wulo Scribe web application in your browser. Sign in with your Google or Microsoft work account. The system recognises you and places you in your clinic's workspace.

### Step 2: Start a new encounter
You see two options on the home screen:

- **Upload a recording** — Choose an audio file (MP3 or WAV) of a consultation you have already recorded. Click "Upload and process".
- **Start Wulo Scribe (ambient)** — Click this before or during a live consultation. The system listens through your microphone, identifies separate speakers, and writes a live transcript.

### Step 3: Wait for processing
After the audio is captured, the system automatically:
1. Converts speech to text and identifies who said what (doctor vs patient)
2. Spots medical terms — symptoms, medications, diagnoses, test results
3. Writes a draft clinical note using AI

A progress bar shows each step. Processing typically takes 30–90 seconds for a 10-minute consultation.

### Step 4: Review the outputs
You are taken to the **Review screen**, which shows:

- **Transcript** with colour-coded speakers
- **Clinical summary** — a short paragraph about the encounter
- **Structured findings** — key diagnoses and symptoms
- **Medication changes** — what was started, stopped, or adjusted
- **Tests & referrals** — labs ordered, specialist referrals
- **Follow-up instructions** — next steps for the patient
- **Clinical note** — a full HPI · ROS · PE · Assessment · Plan note ready for your records

### Step 5: Edit and correct
Click any section to edit the text. Add, remove, or reword items. The system keeps your version — it will not overwrite your edits.

### Step 6: Ask the assistant
A chat panel lets you ask questions about the encounter: "What medications were discussed?", "Were there any red flags?" The system searches the transcript and medical entities to give you a sourced answer.

### Step 7: Approve
When you are satisfied, click **Approve**. The encounter status changes to "approved" and the final note is locked.

### Step 8: Export
Download the note as a **PDF** or **plain text** file, or export the structured data as a **FHIR R4 bundle** for integration with your electronic health record system.

---

## 10. End-to-End Workflow (Developer Walkthrough)

This traces a single audio-upload request through the entire system.

### 10.1 Authentication

1. Browser sends `GET /api/auth/session`.
2. Backend reads the `X-MS-CLIENT-PRINCIPAL` header injected by Azure Easy Auth.
3. Base64-decodes the principal, normalises claims (sub, email, name, issuer).
4. Upserts the user in the `platform_users` Cosmos container. If new, assigns a default tenant membership.
5. Resolves the active tenant from the `X-Clinical-Tenant-Id` header (or single-membership auto-select).
6. Returns `AuthSessionResponse` with user profile and tenant details.

### 10.2 Encounter creation

1. Frontend sends `POST /api/encounters` with `{ source: "upload" }`.
2. Backend generates a UUID, creates an `EncounterSession` in `draft` status, writes to Cosmos.
3. Returns the encounter ID and hypermedia links.

### 10.3 Audio ingest

1. Frontend sends `POST /api/encounters/{id}/audio` with raw audio bytes (`application/octet-stream`).
2. Backend validates payload size (≤ 100 MB) and encounter existence/ownership.
3. Calls `transcribe_and_store_audio()`:
   - Uploads audio to Blob Storage (`audio-files/{encounter_id}/{filename}`)
   - Sends audio to **Azure Speech Fast Transcription API** (multipart/form-data)
   - Extracts combined text, diarized phrases, speaker count
4. Updates the encounter: `draft_text`, `diarized_phrases`, `speaker_count`, `draft_source="audio_transcription"`, `finalized_text`.
5. If automatic processing is configured (OpenAI + Language endpoints set), calls `launch_encounter_processing()`.

### 10.4 Background processing job

`launch_encounter_processing()` creates a `TranscriptionJob` and spawns a daemon thread:

```
run_encounter_processing_job(encounter_id, job_id)
  │
  ├─ Stage 1: clinical_analysis
  │    generate_medical_analysis(transcript, config)
  │      └─ Split text into 4500-char overlapping chunks
  │      └─ For each chunk: POST to Language Health API → poll for results
  │      └─ Deduplicate and merge entities / relations across chunks
  │      └─ Compute assertion counts and category summaries
  │
  ├─ Stage 2: summary_generation
  │    ensure_job_summary(job, config)
  │      └─ generate_clinical_summary(job, config)
  │      └─ Build clinical data JSON (transcript chunks + entities + relations)
  │      └─ Call Azure OpenAI GPT-4o-mini with structured prompt
  │      └─ Parse 13 markdown sections from response
  │
  ├─ Stage 3: search_indexing
  │    persist_job_and_index_context(container, encounter, job, config)
  │      └─ sync_encounter_search_index(encounter, job, config)
  │      └─ Build search documents for transcript chunks, entities, relations, summary sections
  │      └─ Generate embedding vectors via text-embedding-3-small
  │      └─ Upload batch to Azure AI Search index
  │
  └─ Stage 4: completed
       └─ Update job status → completed
       └─ Update encounter status → ready_for_review
       └─ Build and cache ClinicianReviewResult on the encounter
```

**Error handling**: If any stage fails, the job's status is set to `failed` with the error message. The encounter status is also set to `failed`. Both are persisted so the frontend can display the error. If even the error persistence fails, the error is logged but not recoverable without manual intervention.

### 10.5 Frontend polling

The frontend polls `GET /api/encounters/{id}` or `GET /api/encounters/{id}/results` to detect when `status` transitions from `processing` to `ready_for_review`. The `review_result` field contains the full `ClinicianReviewResult` at every stage, including partial data during processing.

### 10.6 Review and approval

1. Clinician edits note sections via `PUT /api/encounters/{id}/review` with updated content.
2. Backend applies edits via `apply_review_action_edits()`, persists to the encounter's `review_result`.
3. Clinician approves via `POST /api/encounters/{id}/review/approve`.
4. Backend sets encounter status to `approved`, writes an audit event.
5. Clinician can regenerate the AI output via `POST /api/encounters/{id}/review/regenerate`, which re-runs the summary generation and rebuilds outputs.

### 10.7 Export

- `GET /api/summary/{job_id}/pdf` → `pdf_generator.py` converts the markdown summary to a PDF
- `GET /api/summary/{job_id}/txt` → returns the plain-text clinical note
- `GET /api/results/{job_id}` → returns the full job result with an on-demand FHIR R4 bundle

### 10.8 Error paths

| Failure point | Behaviour |
|---|---|
| Auth header missing/invalid | 401 with `AUTH_REQUIRED` |
| Encounter not found or wrong tenant | 404 with `ENCOUNTER_NOT_FOUND` |
| Audio too large (>100 MB) | 413 with `AUDIO_DATA_TOO_LARGE` |
| Speech API authentication failure | 502 with `ENCOUNTER_AUDIO_TRANSCRIPTION_FAILED` |
| Empty transcription result | RuntimeError caught → encounter set to `failed` |
| Language API timeout (60s polling) | Partial entities returned; job may still complete |
| OpenAI call failure | Summary set to `{"error": "..."}`, job continues with empty summary |
| Cosmos write conflict | 409 `CONFLICT` returned to client |
| Search indexing failure | Logged; job still marked completed (indexing is best-effort) |
| Background thread crash | Encounter stuck in `processing`; stale job detection (15-min timeout) resets to `failed` on next access |

---

*End of documentation.*
