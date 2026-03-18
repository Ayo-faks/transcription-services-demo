# Execute Ambient Session UX Optimization Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the ambient recording UX and latency optimization plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`

You must treat that saved markdown plan as the implementation source of truth, but you must verify every step against the real codebase before changing files. Repo reality wins over assumptions.

## Objective

Improve the Ambient Scribe experience so it behaves like a focused recording session surface with:

1. clearer session controls
2. clearer recording-state feedback
3. better perceived startup speed
4. better stopped-state confirmation
5. no regression to the encounter, draft review, approval, and output workflow

## Required Plan Reference

Read this file first and keep it aligned with your work:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`

## Required Source References

Primary implementation targets:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/browserAudioCapture.ts`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`

Reference sample repo to learn from, not copy blindly:

1. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useVoiceSession.ts`
2. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useAudioCapture.ts`
3. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/ActiveSession.tsx`
4. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/SessionControls.tsx`
5. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/VoiceOrb.tsx`
6. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/TranscriptOverlay.tsx`
7. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/types.ts`

## Mandatory Review Before Editing

Before editing any file, verify these points from the actual code:

1. Where the current ambient UI state is rendered.
2. How the current websocket session is started.
3. Whether microphone capture starts before or after `session_started`.
4. How stop currently routes into draft review.
5. Which review-screen behavior must stay intact after the ambient session redesign.

If the saved plan needs narrowing to fit one implementation slice, narrow it without violating the saved plan’s direction.

## Required Implementation Sequence

### Phase 1

Stabilize the session state model and startup sequencing.

Required work:

1. add or normalize explicit recording lifecycle states
2. separate microphone permission from gateway connection in the user-visible flow
3. change the startup sequence so websocket `start_session` happens before microphone capture starts
4. add explicit handshake timeout handling
5. surface distinct failure states for microphone denial, worklet load failure, gateway timeout, and websocket disconnect

### Phase 2

Rebuild the active ambient session screen.

Required work:

1. convert the current ambient page into a focused recording-session surface
2. add a fixed bottom control bar inspired by the Voice Live sample
3. make recording, mute, stopping, and stopped states visually obvious
4. add a stronger central status treatment such as an orb or equivalent session indicator

### Phase 3

Improve transcript visibility without crowding the recording screen.

Required work:

1. make live transcript visibility optional
2. keep the session view calm by default
3. keep the diarized transcript review artifact on the draft review page authoritative

### Phase 4

Keep the review-stage experience aligned.

Required work:

1. confirm the review page still reflects the post-recording state correctly
2. keep approval separate from output generation
3. preserve the diarized transcript visibility already added in draft review

## Non-Negotiable Constraints

1. Do not break the encounter lifecycle.
2. Do not remove or bypass draft review.
3. Do not collapse approval and output generation into one action.
4. Do not replace the current backend capture protocol.
5. Do not rewrite the current audio worklet unless a concrete defect makes it necessary.
6. Do not copy the sample UI wholesale; adapt its patterns to HealthTranscribe’s product and visual language.
7. Treat the saved plan as authoritative unless the actual codebase forces a narrower or more precise implementation.

## Verification Requirements

You must verify all of the following before claiming completion:

1. the React app builds successfully with `npm run build`
2. the user-visible state sequence from start to live recording is clearer than before
3. the user can clearly tell when recording is active
4. the user can clearly tell when recording is muted
5. the user can clearly tell when recording has stopped
6. stop still routes correctly into draft review
7. the review page still shows the diarized transcript when present
8. no existing draft approval or output-generation flow is broken

## Final Output Expectations

When the implementation slice is complete, provide:

1. what was implemented
2. which parts of the saved plan were completed
3. what patterns were adapted from the Voice Live sample repo
4. what verification was run
5. what remains for later phases
6. any risks or blockers still present

## Execution Instruction

Execute directly against the saved plan in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`

Do not stop at analysis unless a genuine blocker prevents implementation.