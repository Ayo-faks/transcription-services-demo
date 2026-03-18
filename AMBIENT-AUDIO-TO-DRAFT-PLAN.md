# Ambient Audio-to-Draft Plan

## TL;DR

Use ambient capture to collect raw browser audio, then on **Stop Recording** run the same trusted audio-transcription path used by file upload to generate the encounter draft and diarization metadata. Keep **Process Clinically** as the explicit approval boundary so entities, relations, summaries, and FHIR continue to run only after the clinician approves the generated draft.

---

## Problem

The ambient workflow currently collects only Voice Live websocket transcript text. It produces 1-speaker output with no entities, no relations, and no clinical processing — unlike direct MP3 upload which uses Azure Speech Fast Transcription with diarization and produces full clinical output.

## Approach

Reuse the upload pipeline _internally_ on the backend (not by making the frontend call `/api/upload`). Capture browser audio locally during ambient sessions, submit the audio on stop, let the backend run `transcribe_audio_rest()` with diarization, and write the result into the encounter as the reviewed draft.

---

## Phases

### Phase 1 — Extract Shared Backend Audio-Processing Logic

1. **Refactor `function_app.py`** so the blob-upload + audio-transcription flow used by `upload_audio()` (L1702) and `process_transcription()` (L1748) can be reused internally.
2. **Create a shared helper function** — e.g. `transcribe_and_store_audio(audio_bytes, encounter_id, config)` — that:
   - Uploads `audio_bytes` to Blob Storage under a deterministic path (e.g. `encounters/{encounter_id}/captured-audio.wav`)
   - Calls `transcribe_audio_rest(audio_bytes, config, enable_diarization=True)` (L636)
   - Returns `{ blob_url, transcript_text, diarized_phrases, speaker_count }`

### Phase 2 — Add Encounter-Scoped Audio Ingestion

3. **Extend `EncounterSession` dataclass** (L159) with new fields:
   - `audio_blob_url: Optional[str] = None`
   - `diarized_phrases: Optional[list] = None`
   - `speaker_count: int = 0`
   - `draft_source: Optional[str] = None` (values: `"websocket"`, `"audio_transcription"`)
4. **Add new endpoint** `POST /encounters/{encounter_id}/audio` in `function_app.py`:
   - Accept raw audio bytes from request body (WAV format, `application/octet-stream`)
   - Call the shared helper from step 2
   - Write `transcript_text` → `encounter.draft_text`, increment `draft_version`
   - Store `diarized_phrases`, `speaker_count`, `audio_blob_url`, `draft_source = "audio_transcription"` on the encounter
   - Set `encounter.status = EncounterStatus.REVIEW`
   - Return `{ encounter_id, draft_text, speaker_count, draft_version }`
   - **Depends on:** steps 2, 3

### Phase 3 — Capture Browser Audio Locally

5. **Buffer raw PCM locally** in `frontend/app.js` during ambient capture:
   - Add a module-level `let assistantLocalAudioChunks = []`
   - In `startAssistantAudioCapture()` (L393), inside `assistantAudioNode.port.onmessage`, push a copy of each incoming `Int16Array` chunk to `assistantLocalAudioChunks` in addition to the existing websocket streaming
   - In `stopAssistantAudioCapture()` (L442), do NOT clear the local buffer (clear it later after upload)
6. **Assemble WAV on stop** in `stopAssistantCapture()` (L876):
   - After `stopAssistantRealtimeSession()`, concatenate `assistantLocalAudioChunks` into one `Int16Array`
   - Wrap in a valid WAV header (16-bit mono PCM, sample rate from `ASSISTANT_AUDIO_SAMPLE_RATE`)
   - POST the WAV blob to `/encounters/{encounter_id}/audio`
   - **Depends on:** steps 4, 5
7. **Refresh draft from server result:**
   - On successful response from the audio endpoint, replace `assistantDraftText.value` with the server-returned `draft_text`
   - Update `assistantDraftVersion` from the response
   - Set `assistantDraftDirty = false`
   - Clear `assistantLocalAudioChunks`
   - Show a brief status message: "Draft generated from captured audio (N speakers detected)"
   - **Depends on:** step 6

### Phase 4 — Pass Diarization Into Clinical Processing

8. **Update `process_encounter()`** (L1573) in `function_app.py`:
   - After loading the encounter, read `encounter.diarized_phrases` and `encounter.speaker_count`
   - Pass them to `generate_medical_analysis(transcript_text, config, diarized_phrases, speaker_count)` (L1088) instead of current text-only call: `generate_medical_analysis(transcript_text, config)`
   - **Depends on:** step 3
9. **Keep existing approval boundary intact:**
   - `finalize_encounter_draft()` and `processAssistantDraft()` continue to work unchanged — the clinician still reviews the draft and clicks Process Clinically

### Phase 5 — UI Clarification & Documentation

10. **Update UI copy** in `frontend/index.html` and `frontend/app.js`:
    - During capture: label live transcript as "Provisional transcript (processing on stop…)"
    - After stop: show "Draft generated from captured audio" status
    - Process Clinically button tooltip: "Run entity extraction, summaries, and FHIR on the approved draft"
11. **Update `README.md`** to document the revised ambient workflow and its distinction from direct file upload.

---

## Relevant Files

| File | What to modify |
|------|---------------|
| `function_app.py` | Extract shared helper, extend `EncounterSession` (L159), add `/encounters/{id}/audio` endpoint, update `process_encounter()` (L1573) to pass diarization |
| `frontend/app.js` | Buffer PCM locally in `startAssistantAudioCapture()` (L393), assemble WAV + submit in `stopAssistantCapture()` (L876), refresh draft from response |
| `frontend/audio-capture-worklet.js` | No changes needed — existing PCM capture is reused |
| `frontend/index.html` | Update UI labels and status messages |
| `README.md` | Document new ambient audio-to-draft flow |

---

## Verification

1. Start ambient session → play `samples/sample-clinical.mp3` through speakers → stop recording → verify draft is regenerated from captured audio (not websocket fragments)
2. Confirm encounter now stores and returns `diarized_phrases` + `speaker_count` after stop-time transcription
3. Click Process Clinically → verify entities, relations, summaries, and FHIR output using the approved draft plus stored diarization metadata
4. Compare `sample-clinical.mp3` through both direct upload and ambient capture — transcript quality, speaker_count, entity totals, and relation totals should be materially aligned
5. Run file-level validation on all modified frontend and backend files

---

## Decisions

- **Reuse upload internals**, not the upload HTTP endpoints — the ambient frontend does NOT call `/api/upload` or `/api/process/{job_id}`
- **Included:** captured-audio transcription into encounter draft, diarization reuse, approved-text clinical processing, UI clarification
- **Excluded:** automatic full clinical processing on recording stop
- **Excluded:** treating live Voice Live transcript as the final reviewed draft
- **Excluded:** replacing the encounter model with the upload job model

## Further Considerations

1. **Linked TranscriptionJob for encounter outputs?** — Defer unless shared reporting across upload and ambient workflows becomes necessary.
2. **Incremental upload during capture vs upload-on-stop?** — Start with upload-on-stop (simpler, easier to verify). Revisit if audio files become too large.
3. **Provisional live transcript visibility during capture?** — Keep for operator feedback, clearly mark as provisional.
