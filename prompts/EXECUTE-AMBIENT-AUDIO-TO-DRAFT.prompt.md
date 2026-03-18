---
mode: agent
description: "Execute the Ambient Audio-to-Draft plan for HealthTranscribe"
tools:
  - read_file
  - edit_file
  - run_in_terminal
  - get_errors
  - grep_search
  - file_search
  - semantic_search
---

# Execute: Ambient Audio-to-Draft Implementation

You are implementing the Ambient Audio-to-Draft feature for the HealthTranscribe clinical transcription application. This is a working Azure Functions (Python) + static frontend (vanilla JS) application.

## Context

The app has two transcription paths:
- **Upload path** (`/api/upload` → `/api/process/{job_id}`): Accepts audio files, runs Azure Speech Fast Transcription with diarization, then generates full clinical output (entities, relations, summaries, FHIR). Works correctly.
- **Ambient path** (encounter workflow): Captures microphone audio via browser, streams to a Voice Live websocket for provisional transcript, then allows clinical processing. **Currently broken** — it only collects websocket transcript text fragments, producing 1-speaker output with no diarization and no entity/relation extraction.

**Root cause:** The ambient path never processes actual audio bytes. It only saves websocket text into encounter `draft_text`. The `process_encounter()` function calls `generate_medical_analysis(transcript_text, config)` WITHOUT diarization data.

**Solution:** Capture browser audio locally during ambient sessions. On Stop Recording, submit the audio to a new backend endpoint that runs the same `transcribe_audio_rest()` used by the upload path. Write the result (transcript + diarization) into the encounter, then let Process Clinically use it.

## Full Plan

Read the full plan first: `/home/ayoola/streaming_agents/transcription-services-demo/AMBIENT-AUDIO-TO-DRAFT-PLAN.md`

## Project Layout

- Backend: `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
- Frontend: `/home/ayoola/streaming_agents/transcription-services-demo/frontend/app.js`
- Audio worklet: `/home/ayoola/streaming_agents/transcription-services-demo/frontend/audio-capture-worklet.js`
- Frontend HTML: `/home/ayoola/streaming_agents/transcription-services-demo/frontend/index.html`
- README: `/home/ayoola/streaming_agents/transcription-services-demo/README.md`
- Test audio: `/home/ayoola/streaming_agents/transcription-services-demo/samples/sample-clinical.mp3`

## Key Existing Functions (DO NOT break these)

### Backend (`function_app.py`)

| Function | Line | Signature | Role |
|----------|------|-----------|------|
| `transcribe_audio_rest` | L636 | `def transcribe_audio_rest(audio_bytes: bytes, config: AzureConfig, enable_diarization: bool = True) -> dict` | Core transcription — returns `{ text, phrases, speaker_count }` |
| `generate_medical_analysis` | L1088 | `def generate_medical_analysis(transcription_text: str, config: AzureConfig, diarized_phrases: Optional[list] = None, speaker_count: int = 0) -> dict` | Clinical analysis — entities, relations, summaries, FHIR |
| `upload_audio` | L1702 | `def upload_audio(req: func.HttpRequest) -> func.HttpResponse` | Upload path entry — stores blob, creates job |
| `process_transcription` | L1748 | `def process_transcription(req: func.HttpRequest) -> func.HttpResponse` | Upload path processing — downloads blob, transcribes, analyzes |
| `process_encounter` | L1573 | `def process_encounter(req: func.HttpRequest) -> func.HttpResponse` | Encounter path processing — **currently text-only, needs diarization** |
| `create_encounter` | L1226 | `def create_encounter(req: func.HttpRequest) -> func.HttpResponse` | Creates encounter session |
| `start_encounter_capture` | L1315 | `def start_encounter_capture(req: func.HttpRequest) -> func.HttpResponse` | Starts ambient capture |
| `finalize_encounter_draft` | L1521 | `def finalize_encounter_draft(req: func.HttpRequest) -> func.HttpResponse` | Freezes draft for processing |

### Data Model (`function_app.py`)

**`EncounterSession` dataclass at L159:**
```python
@dataclass
class EncounterSession:
    id: str
    status: str
    created_at: str
    updated_at: str
    record_type: str = "encounter"
    draft_text: str = ""
    draft_version: int = 0
    draft_segments: Optional[list] = None
    finalized_text: Optional[str] = None
    process_job_id: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Optional[dict] = None
    events: Optional[list] = None
```

**`EncounterStatus` at L103:**
```python
class EncounterStatus:
    DRAFT = "draft"
    CAPTURING = "capturing"
    REVIEW = "review"
    READY = "ready_for_processing"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
```

### Frontend (`app.js`)

| Function | Line | Role |
|----------|------|------|
| `startAssistantAudioCapture()` | L393 | Gets mic stream, creates AudioWorklet, streams PCM chunks via websocket |
| `stopAssistantAudioCapture()` | L442 | Disconnects audio nodes, clears buffer |
| `startAssistantCapture()` | L811 | High-level start — creates encounter, starts capture, opens websocket |
| `stopAssistantCapture()` | L876 | High-level stop — closes websocket, syncs draft from transcript, saves |
| `processAssistantDraft()` | L1005 | Finalizes draft, calls `/encounters/{id}/process`, loads results |
| `flushAssistantAudioBuffer(buffer)` | L385 | Sends Int16 audio chunk to websocket as base64 |
| `syncAssistantDraftFromTranscript()` | L461 | Builds draft text from websocket transcript entries |

**Audio constants** (check top of app.js for exact values):
- `ASSISTANT_AUDIO_SAMPLE_RATE` — the sample rate used for capture
- `ASSISTANT_AUDIO_BUFFER_BYTES` — chunk size for websocket streaming

## Implementation Steps

Execute these in order. Each step should leave the app in a working state.

### Step 1: Extract shared backend helper

In `function_app.py`, create a new function near `transcribe_audio_rest()`:

```python
def transcribe_and_store_audio(audio_bytes, identifier, config):
```

This function should:
- Upload `audio_bytes` to blob storage at path `encounters/{identifier}/captured-audio.wav` using `get_blob_client(config, blob_name)`
- Call `transcribe_audio_rest(audio_bytes, config, enable_diarization=True)`
- Return a dict with keys: `blob_url`, `text`, `phrases` (diarized), `speaker_count`

Reference `upload_audio()` (L1702) for blob upload pattern and `process_transcription()` (L1748) for transcription result extraction pattern.

### Step 2: Extend EncounterSession dataclass

Add these fields to `EncounterSession` at L159 (after existing fields, before closing):
- `audio_blob_url: Optional[str] = None`
- `diarized_phrases: Optional[list] = None`
- `speaker_count: int = 0`
- `draft_source: Optional[str] = None`

Also update `to_dict()` and `from_dict()` methods (search for them) to include the new fields.

### Step 3: Add POST /encounters/{encounter_id}/audio endpoint

Add a new Azure Function route in `function_app.py`:
- Route: `encounters/{encounter_id}/audio`
- Method: POST
- Accept: audio bytes from `req.get_body()` (WAV, `application/octet-stream`)
- Validate encounter exists and is in CAPTURING or REVIEW status
- Call `transcribe_and_store_audio(audio_bytes, encounter_id, config)`
- Update encounter: `draft_text`, `draft_version += 1`, `audio_blob_url`, `diarized_phrases`, `speaker_count`, `draft_source = "audio_transcription"`, `status = EncounterStatus.REVIEW`
- Return JSON: `{ encounter_id, draft_text, speaker_count, draft_version }`

Follow the pattern of existing encounter endpoints (e.g. `start_encounter_capture` at L1315) for error handling, config loading, and Cosmos operations.

### Step 4: Update process_encounter() to pass diarization

At L1573 in `process_encounter()`, change:
```python
job.medical_entities = generate_medical_analysis(transcript_text, config)
```
to:
```python
job.medical_entities = generate_medical_analysis(
    transcript_text, config,
    diarized_phrases=encounter.diarized_phrases,
    speaker_count=encounter.speaker_count
)
```

### Step 5: Buffer PCM locally in frontend

In `frontend/app.js`:

1. Add a module-level variable near other assistant variables:
   ```javascript
   let assistantLocalAudioChunks = [];
   ```

2. In `startAssistantAudioCapture()` (L393), inside the `assistantAudioNode.port.onmessage` handler, BEFORE the existing websocket chunking logic, add:
   ```javascript
   assistantLocalAudioChunks.push(new Int16Array(incoming));
   ```
   (Push a COPY so it isn't transferred away)

3. In `startAssistantCapture()` (L811), clear the buffer at session start:
   ```javascript
   assistantLocalAudioChunks = [];
   ```

4. In `stopAssistantAudioCapture()` (L442), do NOT clear `assistantLocalAudioChunks` — it's needed for upload.

### Step 6: Assemble WAV and submit on stop

In `frontend/app.js`, add a helper function:

```javascript
function assembleWavBlob(chunks, sampleRate) {
    // Concatenate all Int16Array chunks
    // Calculate total length
    // Create WAV header (44 bytes): RIFF, fmt chunk (PCM 16-bit mono), data chunk
    // Return Blob with type 'audio/wav'
}
```

WAV header spec: RIFF header, "WAVE" format, fmt sub-chunk (audioFormat=1 for PCM, numChannels=1, sampleRate, bitsPerSample=16), data sub-chunk.

Then modify `stopAssistantCapture()` (L876) — AFTER `stopAssistantRealtimeSession()` and BEFORE `syncAssistantDraftFromTranscript()`:

1. If `assistantLocalAudioChunks.length > 0`:
   - Show status: "Processing captured audio..."
   - Call `assembleWavBlob(assistantLocalAudioChunks, ASSISTANT_AUDIO_SAMPLE_RATE)`
   - POST the blob to `/encounters/${assistantEncounterId}/audio` with `Content-Type: application/octet-stream`
   - On success: update `assistantDraftText.value` with response `draft_text`, update `assistantDraftVersion`, set `assistantDraftDirty = false`, show "Draft generated from captured audio (N speakers detected)"
   - Clear `assistantLocalAudioChunks = []`
   - Skip the existing `syncAssistantDraftFromTranscript()` call (the server transcript replaces it)
2. If no chunks captured: fall through to existing `syncAssistantDraftFromTranscript()` behavior

### Step 7: Update UI copy

In `frontend/app.js` and `frontend/index.html`:
- During capture, label the live transcript area as "Provisional transcript"
- After stop, show a brief status: "Draft generated from captured audio (N speakers detected)" or "Draft from websocket transcript" as fallback
- Process Clinically button: keep existing behavior, optionally update tooltip

### Step 8: Update README

In `README.md`, add a section documenting:
- The two-stage ambient flow: Stop Recording → generates draft from audio; Process Clinically → runs entity extraction, relations, summaries, FHIR
- How it differs from direct file upload (same transcription quality, different UX)

## Verification Checklist

After implementation, verify each:

- [ ] `get_errors` returns no errors for `function_app.py`, `frontend/app.js`, `frontend/index.html`
- [ ] Start local environment: `npx azurite --silent &`, `func start` (in project dir), `npx http-server frontend -p 8080`
- [ ] Direct upload path still works: upload `samples/sample-clinical.mp3` → verify entities, relations, multi-speaker output
- [ ] Ambient path: start session → play `samples/sample-clinical.mp3` through speakers → stop → verify draft is regenerated from audio transcription (not just websocket fragments)
- [ ] Ambient path: after stop, verify encounter stores `diarized_phrases` and `speaker_count > 1`
- [ ] Ambient path: click Process Clinically → verify entities, relations, summaries, FHIR output in results
- [ ] Compare ambient vs upload: entity totals and speaker counts should be materially similar

## Critical Constraints

- Do NOT modify `transcribe_audio_rest()` — it already works perfectly
- Do NOT modify `generate_medical_analysis()` — it already accepts optional diarization params
- Do NOT modify `audio-capture-worklet.js` — existing PCM capture is sufficient
- Do NOT break the upload path (`/api/upload` + `/api/process/{job_id}`)
- Do NOT auto-trigger clinical processing on stop — keep Process Clinically as the explicit approval step
- Do NOT treat the websocket live transcript as the final draft when audio is available
- Keep all existing encounter status transitions intact
- The encounter workflow (`EncounterSession`) remains the primary model — do NOT replace it with `TranscriptionJob`
