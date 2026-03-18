import unittest

from function_app import (
    EncounterSession,
    EncounterStatus,
    build_encounter_context_payload,
    normalize_context_item,
    normalize_operational_context,
)


class EncounterContextContractTests(unittest.TestCase):
    def build_encounter(self) -> EncounterSession:
        return EncounterSession(
            id="123e4567-e89b-12d3-a456-426614174000",
            status=EncounterStatus.DRAFT,
            created_at="2026-03-17T00:00:00Z",
            updated_at="2026-03-17T00:00:10Z",
        )

    def test_context_payload_empty_shape_is_stable(self):
        payload = build_encounter_context_payload(
            self.build_encounter(),
            None,
            items=[],
            total_items=0,
            limit=25,
        )

        self.assertEqual(payload["contract_version"], "v1")
        self.assertEqual(payload["linked_job_id"], None)
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["summary"]["categories"], [])
        self.assertEqual(payload["summary"]["assertions"], [])
        self.assertEqual(payload["summary"]["applied_filters"]["q"], None)
        self.assertEqual(payload["summary"]["applied_filters"]["category"], None)
        self.assertEqual(payload["summary"]["applied_filters"]["assertion"], None)
        self.assertEqual(payload["summary"]["applied_filters"]["limit"], 25)
        self.assertTrue(payload["context_version"])

    def test_context_item_normalization_enforces_required_collections(self):
        item = normalize_context_item(
            {
                "id": "context-1",
                "category": "Summary",
                "kind": "clinical_summary",
                "title": "Clinical Summary",
                "text": "The patient reports headaches.",
                "source": "encounter",
                "assertion": "Positive",
                "confidence_score": "0.92391",
                "provenance": [
                    {"source_type": "job_summary", "source_id": "job-1", "excerpt": "headaches"},
                    {"source_type": "", "source_id": ""},
                    "ignore-me",
                ],
                "metadata": None,
            }
        )

        self.assertEqual(item["category"], "summary")
        self.assertEqual(item["assertion"], "positive")
        self.assertEqual(item["confidence_score"], 0.9239)
        self.assertEqual(item["metadata"], {})
        self.assertEqual(len(item["provenance"]), 2)
        self.assertEqual(item["provenance"][1]["source_type"], "unknown")
        self.assertEqual(item["provenance"][1]["source_id"], "unknown")

    def test_operational_context_normalization_keeps_array_fields_non_null(self):
        payload = normalize_operational_context(
            {
                "generated_at": "2026-03-17T00:00:11Z",
                "eligibility": {
                    "provider": "mock-eligibility-provider",
                    "status": "eligible",
                    "member_reference": "ELIG-123",
                    "summary": "Eligible.",
                },
                "scheme_qualification": {},
                "treatment_lookup": {"provider": "mock-treatment-provider", "results": None},
                "prior_auth_summaries": {"provider": "mock-prior-auth-provider"},
                "communication_options": {"provider": "mock-communications-provider", "results": None},
                "audit_metadata": None,
            },
            self.build_encounter(),
            None,
        )

        self.assertEqual(payload["contract_version"], "v1")
        self.assertEqual(payload["linked_job_id"], None)
        self.assertEqual(payload["treatment_lookup"]["results"], [])
        self.assertEqual(payload["prior_auth_summaries"]["results"], [])
        self.assertEqual(payload["communication_options"]["results"], [])
        self.assertEqual(payload["audit_metadata"]["mode"], "mock")
        self.assertIn("freshness", payload["eligibility"])


if __name__ == "__main__":
    unittest.main()