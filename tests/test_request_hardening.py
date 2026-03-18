import json
import unittest
from unittest.mock import patch

from function_app import (
    ClinicalRequestContext,
    EncounterSession,
    EncounterStatus,
    conflict_response,
    error_response,
    health_check,
    is_empty_transcription_text,
    JobStatus,
    normalize_job_failure_state,
    require_encounter_status,
    set_current_request_context,
    TranscriptionJob,
    transcription_result_error,
    validate_segments_payload,
    validate_payload_size,
    validate_request_body_size,
    validate_uuid_value,
)


class DummyRequest:
    def __init__(self, body: bytes = b""):
        self._body = body

    def get_body(self):
        return self._body


class RequestHardeningTests(unittest.TestCase):
    def tearDown(self):
        set_current_request_context(None)

    def test_validate_uuid_value_accepts_canonical_uuid(self):
        self.assertTrue(validate_uuid_value("123e4567-e89b-12d3-a456-426614174000"))
        self.assertFalse(validate_uuid_value("not-a-uuid"))

    def test_validate_request_body_size_rejects_large_payloads(self):
        response = validate_request_body_size(DummyRequest(b"x" * 6), max_bytes=5)

        self.assertIsNotNone(response)
        payload = json.loads(response.get_body().decode("utf-8"))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(payload["code"], "REQUEST_BODY_TOO_LARGE")
        self.assertEqual(payload["details"]["maxBytes"], 5)
        self.assertEqual(payload["details"]["receivedBytes"], 6)

    def test_validate_payload_size_rejects_large_binary_payloads(self):
        response = validate_payload_size(
            b"x" * 8,
            max_bytes=4,
            code="AUDIO_FILE_TOO_LARGE",
            message="Uploaded audio file is too large",
        )

        self.assertIsNotNone(response)
        payload = json.loads(response.get_body().decode("utf-8"))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(payload["code"], "AUDIO_FILE_TOO_LARGE")
        self.assertEqual(payload["details"]["maxBytes"], 4)
        self.assertEqual(payload["details"]["receivedBytes"], 8)

    def test_error_response_uses_request_correlation_id(self):
        set_current_request_context(
            ClinicalRequestContext(
                user_id="user-1",
                tenant_id="tenant-1",
                role="editor",
                correlation_id="corr-123",
                email="user@example.com",
                name="User One",
                identity_provider="local-dev",
                memberships=[],
            )
        )

        response = error_response(400, "Bad request", "BAD_REQUEST")
        payload = json.loads(response.get_body().decode("utf-8"))

        self.assertEqual(response.headers.get("X-Correlation-Id"), "corr-123")
        self.assertEqual(payload["correlationId"], "corr-123")
        self.assertEqual(payload["code"], "BAD_REQUEST")

    def test_require_encounter_status_rejects_invalid_transition(self):
        encounter = EncounterSession(
            id="enc-1",
            status=EncounterStatus.PROCESSING,
            created_at="2026-03-17T00:00:00Z",
            updated_at="2026-03-17T00:00:00Z",
        )

        response = require_encounter_status(
            encounter,
            (EncounterStatus.DRAFT, EncounterStatus.REVIEW),
            action="start capture",
            code="ENCOUNTER_CAPTURE_START_NOT_ALLOWED",
        )

        self.assertIsNotNone(response)
        payload = json.loads(response.get_body().decode("utf-8"))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(payload["code"], "INVALID_TRANSITION")
        self.assertEqual(payload["details"]["transitionCode"], "ENCOUNTER_CAPTURE_START_NOT_ALLOWED")
        self.assertEqual(payload["details"]["currentStatus"], EncounterStatus.PROCESSING)

    def test_conflict_response_uses_stable_conflict_code(self):
        response = conflict_response(
            "Draft version conflict",
            details={"reason": "DRAFT_VERSION_CONFLICT", "currentDraftVersion": 3},
        )

        payload = json.loads(response.get_body().decode("utf-8"))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(payload["code"], "CONFLICT")
        self.assertEqual(payload["details"]["reason"], "DRAFT_VERSION_CONFLICT")
        self.assertEqual(payload["details"]["currentDraftVersion"], 3)

    def test_validate_segments_payload_rejects_missing_text(self):
        response = validate_segments_payload([
            {"text": "valid"},
            {"role": "speaker"},
            "invalid",
        ])

        self.assertIsNotNone(response)
        payload = json.loads(response.get_body().decode("utf-8"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(payload["code"], "INVALID_SEGMENTS_PAYLOAD")
        self.assertEqual(payload["details"]["invalidIndexes"], [1, 2])

    def test_empty_transcription_text_is_treated_as_failure(self):
        self.assertTrue(is_empty_transcription_text("No transcription result"))
        self.assertTrue(is_empty_transcription_text(""))
        self.assertFalse(is_empty_transcription_text("Patient reports headaches for two weeks"))

    def test_transcription_result_error_rejects_empty_transcription(self):
        failure_message = transcription_result_error({
            "text": "No transcription result",
            "phrases": [],
            "speaker_count": 0,
        })

        self.assertEqual(failure_message, "Speech transcription returned no spoken content")

    def test_normalize_job_failure_state_marks_empty_completed_job_failed(self):
        job = TranscriptionJob(
            id="job-1",
            filename="ambient.wav",
            status=JobStatus.COMPLETED,
            created_at="2026-03-17T00:00:00Z",
            updated_at="2026-03-17T00:00:05Z",
            transcription_text="No transcription result",
            medical_entities={"summary": {"total_entities": 0}},
            llm_summary={"summary_text": "Clinical summary pending."},
        )

        mutated = normalize_job_failure_state(job)

        self.assertTrue(mutated)
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertEqual(job.processing_stage, "failed")
        self.assertEqual(job.error_message, "No transcription result")
        self.assertIsNone(job.transcription_text)
        self.assertIsNone(job.medical_entities)
        self.assertIsNone(job.llm_summary)

    @patch("function_app.build_health_status")
    def test_health_check_returns_expected_contract(self, mock_build_health_status):
        mock_build_health_status.return_value = {
            "status": "healthy",
            "service": "transcription-api",
            "timestamp": "2026-03-17T00:00:00Z",
            "dependencies": {
                "cosmos": {"status": "healthy"},
                "storage": {"status": "healthy"},
                "search": {"status": "healthy"},
                "speech": {"status": "healthy"},
            },
        }

        response = health_check(DummyRequest())
        payload = json.loads(response.get_body().decode("utf-8"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "healthy")
        self.assertEqual(payload["service"], "transcription-api")
        self.assertIn("timestamp", payload)
        self.assertIn("dependencies", payload)
        self.assertTrue(response.headers.get("X-Correlation-Id"))

    @patch("function_app.build_health_status")
    def test_health_check_returns_503_for_degraded_dependencies(self, mock_build_health_status):
        mock_build_health_status.return_value = {
            "status": "degraded",
            "service": "transcription-api",
            "timestamp": "2026-03-17T00:00:00Z",
            "dependencies": {
                "cosmos": {"status": "healthy"},
                "storage": {"status": "unhealthy"},
                "search": {"status": "healthy"},
                "speech": {"status": "healthy"},
            },
        }

        response = health_check(DummyRequest())
        payload = json.loads(response.get_body().decode("utf-8"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(payload["status"], "degraded")
        self.assertEqual(payload["dependencies"]["storage"]["status"], "unhealthy")


if __name__ == "__main__":
    unittest.main()