# Root Cause And Fix: Transcription Pipeline Failure

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to root-cause why a transcription job can complete the user flow without yielding usable transcript-derived outputs, and then fix it properly.

## Current User-Visible Problem

In the React results route, a job may show:

- transcript content like `Transcription failed: 401`
- zero entities
- zero relations
- empty or misleading FHIR output
- AI summary content derived from the failed transcript string rather than from real clinical text

The user expectation is:

1. transcription should succeed
2. entities should be extracted
3. FHIR should be generated from real clinical entities
4. conditions and other clinical findings should appear where appropriate
5. AI summary should be grounded in the real transcript

If transcription fails, the system must fail clearly and stop downstream analysis instead of producing misleading completed results.

## Known Context

There is already a partial fix in the repo that normalizes some poisoned jobs to `failed` on read, but the user reports the overall experience is still failing.

This means you must not assume the problem is solved. You must verify the entire path from upload or encounter processing through final results rendering.

## Required Goal

Find the true root cause of the transcription failure and fix the full pipeline so that successful jobs produce:

1. real transcript text
2. non-empty medical entities when expected
3. meaningful FHIR output
4. meaningful AI summary
5. correct failure handling when Azure Speech or downstream services fail

## Required First Steps

Before editing anything, inspect the real implementation and answer these questions for yourself:

1. Why is Azure Speech returning `401` for the failing jobs?
2. Is the failure caused by bad local configuration, wrong auth mode, wrong endpoint construction, wrong region, wrong key, or wrong request shape?
3. Are upload jobs and encounter jobs both using the same failing speech path?
4. Are downstream stages still running after transcription failure anywhere in the pipeline?
5. Does the React results page correctly reflect backend failure state?
6. Are there legacy poisoned records in Cosmos that need migration or normalization?
7. Does the healthy path still produce entities, conditions, FHIR, and summary when transcription actually succeeds?

## Files To Inspect

Backend:

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
2. `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.json`
3. `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json`
4. `/home/ayoola/streaming_agents/transcription-services-demo/requirements.txt`

Frontend:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/jobsApi.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`

Tests:

1. `/home/ayoola/streaming_agents/transcription-services-demo/tests/retrieval-hardening.spec.cjs`

Supporting docs and plans:

1. `/home/ayoola/streaming_agents/transcription-services-demo/GAP-ANALYSIS.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-PRODUCTION-RETRIEVAL-HARDENING.md`

## What To Verify Technically

### Speech Authentication

Check all of the following in the real environment and code:

1. whether the code is using Speech key auth, endpoint auth, or a mixed mode incorrectly
2. whether `speech_region` matches the actual Speech resource region
3. whether the endpoint format is valid for the Speech REST API being called
4. whether the request headers are correct for the chosen auth mode
5. whether local settings are missing, stale, or inconsistent with the actual Azure resource

### Pipeline Control Flow

Confirm whether the code does any of the following incorrectly:

1. treats failed transcription text as a valid transcript
2. allows entity extraction to run on failed transcription output
3. allows AI summary generation to run on failed transcription output
4. generates FHIR when there are no meaningful extracted findings
5. marks failed work as `completed`

### Data Integrity

Confirm whether there are existing bad jobs in Cosmos and decide what to do:

1. normalize on read only
2. migrate records in place
3. block rendering of poisoned records

### Frontend Rendering

Confirm the React results page behavior for all cases:

1. successful job with real transcript and extracted entities
2. failed job with error message
3. legacy poisoned job
4. loading job

## Required Fix Standard

The fix must satisfy all of the following:

1. solve the root cause of the `401` transcription failure if it is in repo configuration or code
2. stop downstream analysis when transcription fails
3. prevent misleading AI summary and FHIR generation from failed transcripts
4. display clean failure UX in the React results page
5. preserve the healthy path where successful transcription yields entities, conditions, FHIR, and AI summary

Do not apply a surface patch that only hides the problem in the UI.

## Required Verification

You must run and verify the following after the fix:

1. a local upload flow using a known sample audio file
2. the results route for a successful job
3. the results route for a failed or intentionally broken job
4. the retrieval regression suite if the changes affect encounter-local retrieval or results rendering

Specifically verify that a successful job now shows:

1. transcript text that is not an auth error
2. non-zero entities when clinically expected
3. relevant conditions or findings where expected
4. FHIR generated from real extracted content
5. AI summary grounded in the actual transcript

## Output Requirements

When finished, provide:

1. the exact root cause
2. the files changed
3. why the previous behavior produced empty or misleading entities/FHIR/summary
4. what was done to fix the healthy path
5. what was done to fix failed-job handling
6. what verification was run and the result

## Execution Instruction

Do not stop at explaining the bug. Root-cause it against the real code and environment, implement the fix, and verify the working path end to end.