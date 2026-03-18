# Ambient Session UX Optimization Plan

## Objective

Improve the Ambient Scribe recording experience in the React frontend so it feels like a focused recording surface rather than a general page. The target outcome is:

1. faster perceived startup
2. clearer recording-state feedback
3. controls that match the focused Voice Live demo pattern
4. a clean handoff from active recording to draft review
5. no regression to the existing encounter and draft workflow

The backend remains the system of record. This plan is focused on the React frontend and on tightening the frontend sequencing around the existing Voice Live websocket flow.

## Current Problem Summary

The current React ambient flow works, but it still has visible gaps:

1. the controls are inline page actions, not a focused active-session control surface
2. the recording state is not explicit enough for clinicians
3. the UI does not clearly separate requesting microphone access, connecting to the gateway, actively recording, muting, stopping, and stopped states
4. startup feels slower than necessary because the current implementation does too much before the session is visibly ready
5. the active session screen has too much page framing and not enough dedicated session affordance

The Voice Live sample in:

- `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant`

already demonstrates a better active-session control pattern and a clearer session lifecycle. We should reuse its patterns, but adapt them to HealthTranscribe’s ambient note workflow instead of copying its assistant UI literally.

## Core Direction

### Product Direction

Ambient Scribe should behave like a dedicated live-recording screen.

That means:

1. one dominant orb or status center
2. one persistent control bar
3. unambiguous recording status
4. a calm screen with optional live transcript visibility
5. a short and clear transition to draft review when recording ends

### Technical Direction

Refactor session startup so websocket setup and session handshake happen before microphone capture begins. This makes the connection lifecycle more explicit and reduces the amount of hidden work inside a vague `Connecting...` state.

### Workflow Direction

Keep the current encounter semantics intact:

1. create encounter
2. start capture
3. record live
4. stop capture
5. review draft
6. approve draft
7. generate outputs

Do not collapse recording and clinical processing into one step.

## What We Should Reuse From The Voice Live Sample

Reference frontend sample path:

- `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend`

Most relevant files:

1. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useVoiceSession.ts`
2. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useAudioCapture.ts`
3. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/ActiveSession.tsx`
4. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/SessionControls.tsx`
5. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/VoiceOrb.tsx`
6. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/TranscriptOverlay.tsx`
7. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/types.ts`

Reusable patterns:

1. fixed bottom control bar with explicit toggle states
2. focused active-session layout built around a central orb
3. clearer session state model
4. optional transcript overlay that does not dominate the session screen
5. sequencing `start_session` before microphone capture starts

Patterns to adapt rather than copy directly:

1. assistant-specific states like `thinking` and `speaking`
2. assistant transcript bubble roles
3. the sample’s exact color system and purple visual identity
4. voice-agent settings panels that are not needed in HealthTranscribe

## Gaps To Solve

### UX Gaps

1. recording is not visually obvious enough once a session becomes live
2. mute state is not prominent enough
3. the user does not get a strong stopped-state confirmation before routing away
4. the active transcript area is still page-like instead of session-like
5. the current screen does not feel close enough to the attached demo reference

### Performance And Perception Gaps

1. `Connecting...` currently hides multiple underlying phases
2. microphone permission and audio worklet setup happen before the session is visibly established
3. websocket handshake has no explicit timeout behavior at the UX level
4. encounter syncing can make startup feel slower than needed

### Robustness Gaps

1. microphone denial should produce a direct state and message
2. worklet load failure should be explicit
3. gateway timeout should be explicit
4. websocket disconnect after connect should be explicit

## Target Session State Model

Introduce or normalize a more explicit session model for the ambient experience:

1. `idle`
2. `requesting-microphone`
3. `connecting`
4. `recording`
5. `muted`
6. `stopping`
7. `stopped`
8. `error`

Notes:

1. `recording` means microphone capture is active and the session is ready for audio.
2. `muted` should be rendered as a visual variation of the active session rather than a hidden internal boolean only.
3. `stopped` should be visible briefly before routing to draft review.

## Implementation Phases

### Phase 1: Normalize Session State And Startup Sequencing

Update:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/browserAudioCapture.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`

Required work:

1. split microphone permission from gateway connection at the status level
2. open websocket and send `start_session` before microphone capture starts
3. start microphone capture after `session_started` arrives
4. add an explicit handshake timeout
5. emit distinct errors for microphone denial, worklet load failure, and gateway connection failure
6. reduce redundant encounter sync work during start where possible without changing backend semantics

### Phase 2: Rebuild The Active Ambient Screen

Update:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

Required work:

1. convert the active recording state into a dedicated session screen
2. add a fixed bottom control bar modeled on the sample pattern
3. add a central orb or state indicator with stronger live-state feedback
4. show recording timer, mute state, and stop state clearly
5. keep the screen visually calm while recording is active

### Phase 3: Improve Live Transcript Visibility Without Crowding The Session

Update:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

Required work:

1. make live transcript visibility optional through a dedicated toggle in the control bar
2. adapt the sample transcript overlay pattern rather than showing a busy page layout by default
3. keep the draft review page authoritative for post-recording evidence review

### Phase 4: Align Draft Review With The Refined Recording Flow

Update:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`

Required work:

1. ensure the review page still reflects the post-recording state correctly
2. keep approval separate from output generation
3. keep the diarized transcript visible and trustworthy after the active recording flow changes

## File Map

Primary implementation files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/browserAudioCapture.ts`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`

Reference files from the sample repo:

1. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useVoiceSession.ts`
2. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/hooks/useAudioCapture.ts`
3. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/ActiveSession.tsx`
4. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/SessionControls.tsx`
5. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/VoiceOrb.tsx`
6. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/TranscriptOverlay.tsx`
7. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/types.ts`

## Verification

### Build Validation

After each major phase, run:

1. `npm run build` in `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react`

### Functional Verification

Verify all of the following:

1. the user sees a clear sequence from start click to microphone permission to connecting to active recording
2. `Connecting...` no longer hides microphone permission and worklet setup in one vague state
3. the bottom control bar remains visible on desktop and mobile during active recording
4. the user can tell immediately when recording is live
5. the user can tell immediately when recording is muted
6. the user gets a clear stopped-state confirmation before being routed to review
7. live transcript visibility remains optional and does not clutter the main session view
8. diarized transcript review still works after the active-session redesign
9. encounter creation, capture start, capture stop, review, approval, and output generation still follow the existing backend contract

### Failure Verification

Test at least these cases:

1. microphone denied
2. gateway unreachable
3. websocket disconnect after session start
4. audio worklet load failure

Each must produce a distinct, understandable user-facing state or message.

## Constraints

1. do not replace the backend capture protocol
2. do not rewrite the audio worklet unless a specific defect requires it
3. do not break the current encounter lifecycle or draft review workflow
4. do not collapse review and output generation into one step
5. do not copy the sample’s purple visual identity or its full assistant UI wholesale
6. do not introduce new backend requirements unless clearly necessary

## Deliverable

The deliverable is a refined ambient recording flow in the React frontend that:

1. feels closer to the attached demo reference
2. starts faster from the user’s point of view
3. makes recording state explicit
4. preserves the clinical draft review workflow
5. remains aligned with the existing HealthTranscribe backend contracts