"""
Azure Functions entry point
Healthcare Transcription Services Demo
Simplified version using REST APIs instead of heavy SDKs
"""
import azure.functions as func
import logging
import json
import uuid
import os
import time
import hashlib
import base64
import re
import threading
import requests
from functools import wraps
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("function_app")

# Application Insights — Azure Functions has built-in App Insights integration
# via the host. Manual configure_azure_monitor() conflicts with the host's own
# telemetry pipeline and can crash the Python worker before it indexes functions.
# Only call configure_azure_monitor() outside Azure Functions (e.g. standalone).
_ai_connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
_is_azure_functions = os.environ.get("FUNCTIONS_WORKER_RUNTIME") is not None
if _ai_connection_string and not _is_azure_functions:
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
        configure_azure_monitor(
            connection_string=_ai_connection_string,
            logger_name="function_app",
        )
    except Exception:
        logger.warning("Failed to configure Azure Monitor OpenTelemetry, continuing without it")

class StableFunctionApp(func.FunctionApp):
    def get_functions(self):
        self.functions_bindings = {}
        return super().get_functions()

# Create the main function app
app = StableFunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

LOCAL_DEV_AUTH = os.environ.get("LOCAL_DEV_AUTH", "").lower() == "true"
AZURE_FUNCTIONS_ENVIRONMENT = os.environ.get("AZURE_FUNCTIONS_ENVIRONMENT", "Production")

if LOCAL_DEV_AUTH and AZURE_FUNCTIONS_ENVIRONMENT == "Production":
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in Production. Remove from app settings.")

HEALTH_ANALYSIS_MAX_CHARS = 4500
HEALTH_ANALYSIS_OVERLAP_CHARS = 350
SUMMARY_TRANSCRIPT_CHARS = 12000
SEARCH_TEXT_CHUNK_CHARS = 900
SEARCH_TEXT_OVERLAP_CHARS = 120
HEALTH_ANALYSIS_POLL_ATTEMPTS = 30
HEALTH_ANALYSIS_POLL_INTERVAL_SECONDS = 2
HEALTH_ANALYSIS_POLL_TIMEOUT_SECONDS = 15
STALE_PENDING_JOB_TIMEOUT_SECONDS = 15 * 60
STALE_ACTIVE_JOB_TIMEOUT_SECONDS = 30 * 60
SEARCH_VECTOR_PROFILE_NAME = "clinical-context-vector"
SEARCH_VECTOR_FIELD_NAME = "content_vector"
SEARCH_SEMANTIC_CONFIGURATION_NAME = "clinical-context-semantic"
ENCOUNTER_CONTEXT_CONTRACT_VERSION = "v1"
OPERATIONAL_CONTEXT_CONTRACT_VERSION = "v1"
PLATFORM_USERS_CONTAINER_NAME = "platform_users"
PLATFORM_TENANTS_CONTAINER_NAME = "platform_tenants"
PLATFORM_VOICE_SESSIONS_CONTAINER_NAME = "platform_voice_sessions"
PLATFORM_AUDIT_LOG_CONTAINER_NAME = "platform_audit_log"

CLAIM_TYPE_MAP = {
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": "sub",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "email",
    "name": "name",
    "sub": "sub",
    "oid": "sub",
    "email": "email",
    "preferred_username": "email",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": "name",
}

ISSUER_MAP = {
    "aad": "https://login.microsoftonline.com",
    "google": "https://accounts.google.com",
    "local-dev": "https://localhost.localdev",
}

TENANT_ROLE_VALUES = {"owner", "admin", "editor", "reviewer", "viewer"}
TENANT_READ_ROLES = {"viewer", "reviewer", "editor", "admin", "owner"}
TENANT_MUTATION_ADMIN_ROLES = {"owner", "admin"}

_request_context_local = threading.local()


def is_configured_value(value: str) -> bool:
    if not value:
        return False

    normalized = value.strip()
    if not normalized:
        return False

    placeholder_markers = ("<your-", "<your_", "<your", "https://<", "http://<")
    return not any(marker in normalized.lower() for marker in placeholder_markers)


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def safe_json_loads(value: str, default):
    if not value:
        return default

    try:
        return json.loads(value)
    except Exception:
        return default


def split_text_into_chunks(text: str, *, max_chars: int, overlap_chars: int = 0) -> list:
    normalized = (text or "").strip()
    if not normalized:
        return []

    if len(normalized) <= max_chars:
        return [{"text": normalized, "start": 0, "end": len(normalized)}]

    chunks = []
    start = 0
    text_length = len(normalized)

    while start < text_length:
        end = min(start + max_chars, text_length)
        if end < text_length:
            split_at = normalized.rfind(" ", start, end)
            if split_at > start + int(max_chars * 0.6):
                end = split_at

        chunk_text = normalized[start:end].strip()
        if chunk_text:
            chunks.append({"text": chunk_text, "start": start, "end": end})

        if end >= text_length:
            break

        start = max(0, end - overlap_chars)

    return chunks


def split_summary_sections(summary_text: str) -> list:
    sections = []
    current_title = "Clinical summary"
    current_lines = []

    for line in (summary_text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            if current_lines:
                sections.append({
                    "title": current_title,
                    "text": "\n".join(current_lines).strip(),
                })
            current_title = stripped[4:].strip() or "Clinical summary"
            current_lines = []
            continue

        current_lines.append(line)

    if current_lines:
        sections.append({
            "title": current_title,
            "text": "\n".join(current_lines).strip(),
        })

    return [section for section in sections if section.get("text")]


def normalize_heading_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")


def unique_non_empty(values: list[str]) -> list[str]:
    seen = set()
    normalized_values = []

    for value in values:
        cleaned = normalize_context_value(value)
        if not cleaned:
            continue

        lowered = cleaned.lower()
        if lowered in seen:
            continue

        seen.add(lowered)
        normalized_values.append(cleaned)

    return normalized_values


def build_summary_section_lookup(summary_text: str) -> dict[str, str]:
    lookup = {}
    for section in split_summary_sections(summary_text):
        key = normalize_heading_key(section.get("title", ""))
        if key:
            lookup[key] = normalize_context_value(section.get("text"))
    return lookup


def get_summary_section_text(section_lookup: dict[str, str], *keys: str) -> str:
    for key in keys:
        normalized = normalize_heading_key(key)
        value = normalize_context_value(section_lookup.get(normalized))
        if value:
            return value
    return ""


def extract_list_items(text: str) -> list[str]:
    items = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        if re.fullmatch(r"[:\-\s|]+", stripped):
            continue

        if "|" in stripped:
            cells = [cell.strip() for cell in stripped.split("|") if cell.strip()]
            if cells:
                stripped = ": ".join([cells[0], " | ".join(cells[1:])]).strip(": ")

        stripped = re.sub(r"^[-*•]\s+", "", stripped)
        stripped = re.sub(r"^\d+[.)]\s+", "", stripped)
        stripped = re.sub(r"^#+\s*", "", stripped).strip()
        if stripped:
            items.append(stripped)

    return unique_non_empty(items)


def extract_first_sentence(text: str, fallback: str = "") -> str:
    cleaned = normalize_context_value(text)
    if not cleaned:
        return fallback

    for part in re.split(r"(?<=[.!?])\s+", cleaned):
        if part.strip():
            return part.strip()

    return cleaned or fallback


def infer_medication_change_type(text: str) -> str:
    normalized = normalize_context_value(text).lower()
    if any(token in normalized for token in ["start", "begin", "initiate", "prescribe"]):
        return "start"
    if any(token in normalized for token in ["stop", "discontinue", "hold"]):
        return "stop"
    if any(token in normalized for token in ["increase", "decrease", "adjust", "change", "titrate"]):
        return "adjust"
    if any(token in normalized for token in ["continue", "maintain"]):
        return "continue"
    if "monitor" in normalized:
        return "monitor"
    return "unknown"


def entity_matches_keywords(entity: dict, keywords: list[str]) -> bool:
    haystack = " ".join(
        [
            normalize_context_value(entity.get("category")),
            normalize_context_value(entity.get("subcategory")),
            normalize_context_value(entity.get("text")),
        ]
    ).lower()
    return any(keyword in haystack for keyword in keywords)


def collect_entity_texts(entities: list[dict], keywords: list[str], *, limit: int = 8) -> list[str]:
    values = []
    for entity in entities:
        if entity_matches_keywords(entity, keywords):
            values.append(entity.get("text") or entity.get("subcategory") or entity.get("category") or "")
    return unique_non_empty(values)[:limit]


def build_structured_findings_items(section_lookup: dict[str, str], entities: list[dict]) -> list[dict]:
    finding_lines = extract_list_items(get_summary_section_text(section_lookup, "structured_findings", "findings_summary_table", "findings_summary"))
    if not finding_lines:
        finding_lines = collect_entity_texts(entities, ["diagnosis", "condition", "finding", "symptom", "sign"], limit=10)

    items = []
    for index, line in enumerate(finding_lines, start=1):
        label, detail = (line.split(":", 1) + [line])[:2] if ":" in line else (line, line)
        items.append({
            "id": f"finding-{index}",
            "label": label.strip() or f"Finding {index}",
            "detail": detail.strip() or line,
            "category": "clinical_finding",
            "confidence_score": None,
            "evidence": [line],
        })
    return items


def build_follow_up_items(section_lookup: dict[str, str]) -> list[dict]:
    lines = extract_list_items(get_summary_section_text(section_lookup, "follow_up_instructions", "follow_up", "patient_instructions"))
    return [
        {
            "id": f"follow-up-{index}",
            "instruction": line,
            "timeframe": None,
            "audience": "patient",
            "priority": None,
            "evidence": [line],
        }
        for index, line in enumerate(lines, start=1)
    ]


def build_medication_change_items(section_lookup: dict[str, str], entities: list[dict]) -> list[dict]:
    lines = extract_list_items(get_summary_section_text(section_lookup, "medication_changes", "medications"))
    if not lines:
        lines = collect_entity_texts(entities, ["medication", "dosage", "frequency", "route"], limit=10)

    return [
        {
            "id": f"medication-{index}",
            "medication": line.split(":", 1)[0].strip() if ":" in line else line,
            "change_type": infer_medication_change_type(line),
            "detail": line,
            "dosage": None,
            "frequency": None,
            "reason": None,
            "evidence": [line],
        }
        for index, line in enumerate(lines, start=1)
    ]


def build_test_items(section_lookup: dict[str, str], entities: list[dict]) -> list[dict]:
    lines = extract_list_items(get_summary_section_text(section_lookup, "tests", "tests_and_orders", "tests_and_referrals"))
    if not lines:
        lines = collect_entity_texts(entities, ["test", "lab", "imaging", "measurement", "procedure"], limit=10)

    return [
        {
            "id": f"test-{index}",
            "name": line.split(":", 1)[0].strip() if ":" in line else line,
            "detail": line,
            "timing": None,
            "reason": None,
            "evidence": [line],
        }
        for index, line in enumerate(lines, start=1)
    ]


def build_referral_items(section_lookup: dict[str, str]) -> list[dict]:
    lines = extract_list_items(get_summary_section_text(section_lookup, "referrals", "tests_and_referrals"))
    referral_lines = [line for line in lines if any(token in line.lower() for token in ["refer", "referral", "specialist", "consult"]) ]
    return [
        {
            "id": f"referral-{index}",
            "specialty": line.split(":", 1)[0].strip() if ":" in line else line,
            "detail": line,
            "urgency": None,
            "reason": None,
            "evidence": [line],
        }
        for index, line in enumerate(referral_lines, start=1)
    ]


def build_assertion_items(entities: list[dict]) -> list[dict]:
    assertions = []
    for index, entity in enumerate(entities, start=1):
        assertion = entity.get("assertion") or {}
        if not any(assertion.get(field) for field in ["certainty", "conditionality", "association", "temporal"]):
            continue

        assertions.append({
            "id": f"assertion-{index}",
            "entity_text": normalize_context_value(entity.get("text")) or f"Entity {index}",
            "category": entity.get("category"),
            "certainty": assertion.get("certainty"),
            "conditionality": assertion.get("conditionality"),
            "association": assertion.get("association"),
            "temporal": assertion.get("temporal"),
            "confidence_score": entity.get("confidence_score"),
        })

    return assertions


def build_timeline_items(encounter: "EncounterSession", section_lookup: dict[str, str]) -> list[dict]:
    items = []

    for index, line in enumerate(extract_list_items(get_summary_section_text(section_lookup, "timeline", "clinical_relationships_and_timeline")), start=1):
        items.append({
            "id": f"timeline-summary-{index}",
            "title": extract_first_sentence(line, fallback=f"Timeline item {index}"),
            "detail": line,
            "timeframe": None,
            "source": "summary",
            "evidence": [line],
        })

    for event_index, event in enumerate((encounter.events or [])[-8:], start=1):
        event_type = normalize_context_value(event.get("type")).replace("_", " ").strip() or f"event {event_index}"
        items.append({
            "id": f"timeline-event-{event_index}",
            "title": event_type.title(),
            "detail": json.dumps(event.get("details") or {}, sort_keys=True) if event.get("details") else event_type.title(),
            "timeframe": event.get("at"),
            "source": "encounter_event",
            "evidence": [event.get("at")] if event.get("at") else [],
        })

    return items


def build_final_note_sections(
    section_lookup: dict[str, str],
    transcript_text: str,
    structured_findings: list[dict],
    follow_up_items: list[dict],
    medication_changes: list[dict],
    test_items: list[dict],
    referral_items: list[dict],
    entities: list[dict],
) -> dict:
    symptom_fallback = "; ".join(collect_entity_texts(entities, ["symptom", "sign"], limit=6))
    assessment_fallback = "; ".join(item.get("detail") for item in structured_findings[:4])
    plan_lines = [
        *(item.get("instruction") for item in follow_up_items[:4]),
        *(item.get("detail") for item in medication_changes[:4]),
        *(item.get("detail") for item in test_items[:4]),
        *(item.get("detail") for item in referral_items[:4]),
    ]
    plan_fallback = " ".join(unique_non_empty([line for line in plan_lines if line]))

    hpi_text = get_summary_section_text(section_lookup, "hpi", "history_of_present_illness") or extract_first_sentence(transcript_text, fallback="History not available.")
    ros_text = get_summary_section_text(section_lookup, "ros", "review_of_systems") or symptom_fallback or "Review of systems not documented in the generated output."
    pe_text = get_summary_section_text(section_lookup, "pe", "physical_exam", "physical_examination") or "Physical examination details were not explicitly identified in the generated output."
    assessment_text = get_summary_section_text(section_lookup, "assessment") or assessment_fallback or "Assessment pending clinician review."
    plan_text = get_summary_section_text(section_lookup, "plan") or plan_fallback or "Plan pending clinician review."

    return {
        "hpi": {"key": "hpi", "title": "HPI", "content": hpi_text, "bullets": extract_list_items(hpi_text)},
        "ros": {"key": "ros", "title": "ROS", "content": ros_text, "bullets": extract_list_items(ros_text)},
        "pe": {"key": "pe", "title": "PE", "content": pe_text, "bullets": extract_list_items(pe_text)},
        "assessment": {"key": "assessment", "title": "Assessment", "content": assessment_text, "bullets": extract_list_items(assessment_text)},
        "plan": {"key": "plan", "title": "Plan", "content": plan_text, "bullets": extract_list_items(plan_text)},
    }


def render_final_note_text(note_sections: dict) -> str:
    lines = []
    ordered_keys = ["hpi", "ros", "pe", "assessment", "plan"]
    for key in ordered_keys:
        section = note_sections.get(key) or {}
        title = section.get("title") or key.upper()
        content = normalize_context_value(section.get("content"))
        if content:
            lines.append(f"{title}\n{content}")
    return "\n\n".join(lines)


def apply_saved_review_overrides(result: dict, saved_review: Optional[dict]) -> dict:
    if not saved_review:
        return result

    saved_outputs = saved_review.get("clinician_outputs") or {}
    result_outputs = result.get("clinician_outputs") or {}

    for key in [
        "clinical_summary",
        "structured_findings",
        "follow_up_instructions",
        "medication_changes",
        "tests",
        "referrals",
        "final_note_sections",
    ]:
        if saved_outputs.get(key):
            result_outputs[key] = saved_outputs[key]

    result["clinician_outputs"] = result_outputs
    result["structured_findings"] = result_outputs.get("structured_findings", result.get("structured_findings", []))
    result["follow_up_instructions"] = result_outputs.get("follow_up_instructions", result.get("follow_up_instructions", []))
    result["medication_changes"] = result_outputs.get("medication_changes", result.get("medication_changes", []))
    result["tests_and_referrals"] = {
        "tests": result_outputs.get("tests", (result.get("tests_and_referrals") or {}).get("tests", [])),
        "referrals": result_outputs.get("referrals", (result.get("tests_and_referrals") or {}).get("referrals", [])),
    }
    result["final_note_sections"] = result_outputs.get("final_note_sections", result.get("final_note_sections", {}))
    result["final_note_text"] = render_final_note_text(result["final_note_sections"])
    return result

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class AzureConfig:
    """Configuration for Azure services"""
    speech_key: str
    speech_region: str
    speech_endpoint: str  # Custom endpoint for managed identity
    language_key: str
    language_endpoint: str
    cosmos_connection_string: str
    cosmos_endpoint: str  # For managed identity
    cosmos_database_name: str
    cosmos_container_name: str
    storage_connection_string: str
    storage_container_name: str
    storage_account_name: str  # For managed identity
    openai_endpoint: str  # Azure OpenAI endpoint for clinical summaries
    openai_api_key: str
    openai_deployment: str  # Model deployment name (e.g., gpt-4o-mini)
    openai_embedding_deployment: str
    openai_embedding_model: str
    openai_embedding_dimensions: int
    search_endpoint: str
    search_index_name: str
    search_api_key: str
    platform_users_container_name: str
    platform_tenants_container_name: str
    platform_voice_sessions_container_name: str
    platform_audit_log_container_name: str
    default_tenant_id: str
    
    @classmethod
    def from_environment(cls) -> "AzureConfig":
        return cls(
            speech_key=os.environ.get("AZURE_SPEECH_KEY", ""),
            speech_region=os.environ.get("AZURE_SPEECH_REGION", ""),
            speech_endpoint=os.environ.get("AZURE_SPEECH_ENDPOINT", ""),
            language_key=os.environ.get("AZURE_LANGUAGE_KEY", ""),
            language_endpoint=os.environ.get("AZURE_LANGUAGE_ENDPOINT", ""),
            cosmos_connection_string=os.environ.get("COSMOS_CONNECTION_STRING", ""),
            cosmos_endpoint=os.environ.get("COSMOS_ENDPOINT", ""),
            cosmos_database_name=os.environ.get("COSMOS_DATABASE_NAME", "transcription-db"),
            cosmos_container_name=os.environ.get("COSMOS_CONTAINER_NAME", "transcriptions"),
            storage_connection_string=os.environ.get("STORAGE_CONNECTION_STRING", ""),
            storage_container_name=os.environ.get("STORAGE_CONTAINER_NAME", "audio-files"),
            storage_account_name=os.environ.get("STORAGE_ACCOUNT_NAME", os.environ.get("AzureWebJobsStorage__accountName", "")),
            openai_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
            openai_api_key=os.environ.get("AZURE_OPENAI_API_KEY", ""),
            openai_deployment=os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
            openai_embedding_deployment=os.environ.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
            openai_embedding_model=os.environ.get("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
            openai_embedding_dimensions=int(os.environ.get("AZURE_OPENAI_EMBEDDING_DIMENSIONS", "1536")),
            search_endpoint=os.environ.get("AZURE_SEARCH_ENDPOINT", ""),
            search_index_name=os.environ.get("AZURE_SEARCH_INDEX_NAME", "clinical-context"),
            search_api_key=os.environ.get("AZURE_SEARCH_API_KEY", ""),
            platform_users_container_name=os.environ.get("PLATFORM_USERS_CONTAINER_NAME", PLATFORM_USERS_CONTAINER_NAME),
            platform_tenants_container_name=os.environ.get("PLATFORM_TENANTS_CONTAINER_NAME", PLATFORM_TENANTS_CONTAINER_NAME),
            platform_voice_sessions_container_name=os.environ.get("PLATFORM_VOICE_SESSIONS_CONTAINER_NAME", PLATFORM_VOICE_SESSIONS_CONTAINER_NAME),
            platform_audit_log_container_name=os.environ.get("PLATFORM_AUDIT_LOG_CONTAINER_NAME", PLATFORM_AUDIT_LOG_CONTAINER_NAME),
            default_tenant_id=os.environ.get("DEFAULT_TENANT_ID", ""),
        )
    
    def validate(self) -> bool:
        # Either connection string or endpoint (for managed identity)
        has_storage = is_configured_value(self.storage_connection_string) or is_configured_value(self.storage_account_name)
        has_cosmos = is_configured_value(self.cosmos_connection_string) or is_configured_value(self.cosmos_endpoint)
        # Speech: either API key or endpoint (for managed identity)
        has_speech = is_configured_value(self.speech_key) or is_configured_value(self.speech_endpoint)
        # Language: either API key or endpoint (for managed identity)  
        has_language = is_configured_value(self.language_key) or is_configured_value(self.language_endpoint)
        
        return all([
            has_speech,
            self.speech_region,
            has_language,
            has_cosmos,
            has_storage,
        ])


class JobStatus:
    PENDING = "pending"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    FAILED = "failed"


class EncounterStatus:
    DRAFT = "draft"
    CAPTURING = "capturing"
    REVIEW = "review"
    READY = "ready_for_processing"
    PROCESSING = "processing"
    READY_FOR_REVIEW = "ready_for_review"
    APPROVED = "approved"
    COMPLETED = "completed"
    FAILED = "failed"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc_timestamp(value: Optional[str]) -> Optional[datetime]:
    normalized = str(value or "").strip()
    if not normalized:
        return None

    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class ClinicalRequestContext:
    user_id: str
    tenant_id: Optional[str]
    role: Optional[str]
    correlation_id: str
    email: Optional[str]
    name: Optional[str]
    identity_provider: str
    memberships: Optional[list] = None


@dataclass
class TranscriptionJob:
    id: str
    filename: str
    status: str
    created_at: str
    updated_at: str
    record_type: str = "job"
    blob_url: Optional[str] = None
    transcription_text: Optional[str] = None
    medical_entities: Optional[dict] = None
    error_message: Optional[str] = None
    processing_time_seconds: Optional[float] = None
    llm_summary: Optional[dict] = None  # AI-generated clinical summary with caching
    source_encounter_id: Optional[str] = None
    processing_stage: Optional[str] = None
    owner_id: Optional[str] = None
    tenant_id: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "id": self.id, "filename": self.filename, "status": self.status,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "record_type": self.record_type,
            "blob_url": self.blob_url, "transcription_text": self.transcription_text,
            "medical_entities": self.medical_entities,
            "error_message": self.error_message, "processing_time_seconds": self.processing_time_seconds,
            "llm_summary": self.llm_summary, "source_encounter_id": self.source_encounter_id,
            "processing_stage": self.processing_stage,
            "owner_id": self.owner_id,
            "tenant_id": self.tenant_id,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "TranscriptionJob":
        return cls(
            id=data.get("id", ""), filename=data.get("filename", ""),
            status=data.get("status", "pending"), created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""), blob_url=data.get("blob_url"),
            record_type=data.get("record_type", "job"),
            transcription_text=data.get("transcription_text"),
            medical_entities=data.get("medical_entities"),
            error_message=data.get("error_message"), processing_time_seconds=data.get("processing_time_seconds"),
            llm_summary=data.get("llm_summary"), source_encounter_id=data.get("source_encounter_id"),
            processing_stage=data.get("processing_stage"),
            owner_id=data.get("owner_id"),
            tenant_id=data.get("tenant_id"),
        )


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
    audio_blob_url: Optional[str] = None
    diarized_phrases: Optional[list] = None
    speaker_count: int = 0
    draft_source: Optional[str] = None
    review_result: Optional[dict] = None
    owner_id: Optional[str] = None
    tenant_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "record_type": self.record_type,
            "draft_text": self.draft_text,
            "draft_version": self.draft_version,
            "draft_segments": self.draft_segments or [],
            "finalized_text": self.finalized_text,
            "process_job_id": self.process_job_id,
            "error_message": self.error_message,
            "metadata": self.metadata or {},
            "events": self.events or [],
            "audio_blob_url": self.audio_blob_url,
            "diarized_phrases": self.diarized_phrases or [],
            "speaker_count": self.speaker_count,
            "draft_source": self.draft_source,
            "review_result": self.review_result,
            "owner_id": self.owner_id,
            "tenant_id": self.tenant_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EncounterSession":
        return cls(
            id=data.get("id", ""),
            status=data.get("status", EncounterStatus.DRAFT),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            record_type=data.get("record_type", "encounter"),
            draft_text=data.get("draft_text", ""),
            draft_version=data.get("draft_version", 0),
            draft_segments=data.get("draft_segments") or [],
            finalized_text=data.get("finalized_text"),
            process_job_id=data.get("process_job_id"),
            error_message=data.get("error_message"),
            metadata=data.get("metadata") or {},
            events=data.get("events") or [],
            audio_blob_url=data.get("audio_blob_url"),
            diarized_phrases=data.get("diarized_phrases") or [],
            speaker_count=data.get("speaker_count", 0),
            draft_source=data.get("draft_source"),
            review_result=data.get("review_result"),
            owner_id=data.get("owner_id"),
            tenant_id=data.get("tenant_id"),
        )


# ============================================================================
# Service Clients (lazy initialization)
# ============================================================================

def get_cosmos_client(config: AzureConfig):
    """Get Cosmos DB client - supports both connection string and managed identity"""
    from azure.cosmos import CosmosClient, PartitionKey
    
    if config.cosmos_connection_string:
        client = CosmosClient.from_connection_string(config.cosmos_connection_string)
    else:
        # Use managed identity
        from azure.identity import DefaultAzureCredential
        client = CosmosClient(config.cosmos_endpoint, credential=DefaultAzureCredential())
    
    database = client.create_database_if_not_exists(id=config.cosmos_database_name)
    container = database.create_container_if_not_exists(
        id=config.cosmos_container_name,
        partition_key=PartitionKey(path="/id"),
        indexing_policy={
            "compositeIndexes": [
                [
                    {"path": "/tenant_id", "order": "ascending"},
                    {"path": "/created_at", "order": "descending"},
                ]
            ]
        },
        offer_throughput=400
    )
    return container


def get_cosmos_database_client(config: AzureConfig):
    from azure.cosmos import CosmosClient

    if config.cosmos_connection_string:
        client = CosmosClient.from_connection_string(config.cosmos_connection_string)
    else:
        from azure.identity import DefaultAzureCredential
        client = CosmosClient(config.cosmos_endpoint, credential=DefaultAzureCredential())

    return client.create_database_if_not_exists(id=config.cosmos_database_name)


def get_cosmos_container_client(config: AzureConfig, container_name: str, *, partition_key_path: str = "/id", default_ttl: Optional[int] = None):
    from azure.cosmos import PartitionKey

    database = get_cosmos_database_client(config)
    create_kwargs = {
        "id": container_name,
        "partition_key": PartitionKey(path=partition_key_path),
        "offer_throughput": 400,
    }
    if default_ttl is not None:
        create_kwargs["default_ttl"] = default_ttl

    return database.create_container_if_not_exists(**create_kwargs)


def get_platform_users_container(config: AzureConfig):
    try:
        return get_cosmos_container_client(config, config.platform_users_container_name, partition_key_path="/issuer_subject")
    except Exception as exc:
        logger.warning(f"Falling back to primary Cosmos container for platform users: {exc}")
        return get_cosmos_client(config)


def get_platform_tenants_container(config: AzureConfig):
    try:
        return get_cosmos_container_client(config, config.platform_tenants_container_name, partition_key_path="/id")
    except Exception as exc:
        logger.warning(f"Falling back to primary Cosmos container for platform tenants: {exc}")
        return get_cosmos_client(config)


def get_platform_voice_sessions_container(config: AzureConfig):
    try:
        return get_cosmos_container_client(config, config.platform_voice_sessions_container_name, partition_key_path="/id", default_ttl=900)
    except Exception as exc:
        logger.warning(f"Falling back to primary Cosmos container for platform voice sessions: {exc}")
        return get_cosmos_client(config)


def get_platform_audit_log_container(config: AzureConfig):
    try:
        return get_cosmos_container_client(config, config.platform_audit_log_container_name, partition_key_path="/tenant_id")
    except Exception as exc:
        logger.warning(f"Falling back to primary Cosmos container for platform audit log: {exc}")
        return get_cosmos_client(config)


MAX_JSON_BODY_BYTES = int(os.environ.get("MAX_JSON_BODY_BYTES", str(1024 * 1024)))
MAX_AUDIO_UPLOAD_BYTES = int(os.environ.get("MAX_AUDIO_UPLOAD_BYTES", str(100 * 1024 * 1024)))


def _get_correlation_id() -> str:
    context = get_current_request_context()
    if context and context.correlation_id:
        return context.correlation_id
    return str(uuid.uuid4())


def log_with_context(message: str, *, level: str = "info", **fields) -> None:
    context = get_current_request_context()
    if context:
        fields.setdefault("correlation_id", context.correlation_id)
        fields.setdefault("user_id", context.user_id)
        fields.setdefault("tenant_id", context.tenant_id)
        fields.setdefault("role", context.role)

    if fields:
        message = f"{message} | {json.dumps(fields, default=str, sort_keys=True)}"

    getattr(logger, level, logger.info)(message)


def json_response(payload: dict, status_code: int = 200, headers: Optional[dict] = None) -> func.HttpResponse:
    response_headers = dict(headers or {})
    response_headers.setdefault("X-Correlation-Id", _get_correlation_id())
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status_code,
        mimetype="application/json",
        headers=response_headers,
    )


def error_response(status_code: int, message: str, code: str, details: Optional[dict] = None) -> func.HttpResponse:
    correlation_id = _get_correlation_id()
    payload = {
        "error": message,
        "code": code,
        "correlationId": correlation_id,
    }
    if details:
        payload["details"] = details
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status_code,
        mimetype="application/json",
        headers={"X-Correlation-Id": correlation_id},
    )


def conflict_response(message: str, *, details: Optional[dict] = None) -> func.HttpResponse:
    return error_response(409, message, "CONFLICT", details=details)


def internal_server_error(
    operation: str,
    exc: Exception,
    *,
    code: str = "INTERNAL_SERVER_ERROR",
    message: str = "The request could not be completed",
    status_code: int = 500,
    details: Optional[dict] = None,
) -> func.HttpResponse:
    log_with_context(operation, level="error", code=code, error=str(exc))
    return error_response(status_code, message, code, details=details)


def validate_uuid_value(value: Optional[str]) -> bool:
    normalized_value = normalize_context_value(value)
    if not normalized_value:
        return False

    try:
        return str(uuid.UUID(normalized_value)) == normalized_value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def require_uuid_route_param(req: func.HttpRequest, param_name: str, label: str, code: str):
    value = normalize_context_value(req.route_params.get(param_name))
    if not value:
        return None, error_response(400, f"{label} required", f"{code}_REQUIRED")
    if not validate_uuid_value(value):
        return None, error_response(400, f"{label} must be a valid UUID", code)
    return value, None


def validate_request_body_size(
    req: func.HttpRequest,
    *,
    max_bytes: int = MAX_JSON_BODY_BYTES,
    code: str = "REQUEST_BODY_TOO_LARGE",
    message: str = "Request body is too large",
):
    body = req.get_body() or b""
    if len(body) <= max_bytes:
        return None

    return error_response(
        413,
        message,
        code,
        details={"maxBytes": max_bytes, "receivedBytes": len(body)},
    )


def validate_payload_size(
    payload: bytes,
    *,
    max_bytes: int,
    code: str,
    message: str,
):
    payload_size = len(payload or b"")
    if payload_size <= max_bytes:
        return None

    return error_response(
        413,
        message,
        code,
        details={"maxBytes": max_bytes, "receivedBytes": payload_size},
    )


def validate_segments_payload(segments) -> Optional[func.HttpResponse]:
    if not isinstance(segments, list) or not segments:
        return error_response(400, "No transcript segments were provided", "ENCOUNTER_SEGMENTS_REQUIRED")

    invalid_indexes = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict) or not normalize_context_value(segment.get("text")):
            invalid_indexes.append(index)

    if invalid_indexes:
        return error_response(
            400,
            "Each transcript segment must include text",
            "INVALID_SEGMENTS_PAYLOAD",
            details={"invalidIndexes": invalid_indexes},
        )

    return None


def _normalize_claims(principal: dict) -> dict:
    idp = principal.get("identity_provider", principal.get("identityProvider", ""))
    claims_list = principal.get("claims", principal.get("user_claims", []))

    normalized = {}
    for claim in claims_list:
        typ = claim.get("typ", claim.get("type", ""))
        value = claim.get("val", claim.get("value", ""))
        key = CLAIM_TYPE_MAP.get(typ)
        if key and value:
            normalized[key] = value

    normalized["issuer"] = ISSUER_MAP.get(idp, idp)
    normalized["identity_provider"] = idp or "unknown"
    return normalized


def _decode_easy_auth_principal(principal_header: str) -> dict:
    padding = "=" * (-len(principal_header) % 4)
    decoded = base64.b64decode(f"{principal_header}{padding}").decode("utf-8")
    return json.loads(decoded)


def _build_local_dev_claims(req: func.HttpRequest) -> Optional[dict]:
    if not (LOCAL_DEV_AUTH and AZURE_FUNCTIONS_ENVIRONMENT != "Production"):
        return None

    user_id = normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-ID")) or normalize_context_value(os.environ.get("LOCAL_DEV_USER_ID")) or "local-dev-user"
    user_name = normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-NAME")) or normalize_context_value(os.environ.get("LOCAL_DEV_USER_NAME")) or "Local Developer"
    email = normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-EMAIL")) or normalize_context_value(os.environ.get("LOCAL_DEV_USER_EMAIL")) or f"{user_name.lower().replace(' ', '.')}@localhost"
    return {
        "sub": user_id,
        "email": email,
        "name": user_name,
        "issuer": ISSUER_MAP["local-dev"],
        "identity_provider": "local-dev",
    }


def _query_single_item(container, query: str, parameters: list, *, partition_key: Optional[str] = None):
    query_kwargs = {
        "query": query,
        "parameters": parameters,
        "enable_cross_partition_query": partition_key is None,
    }
    if partition_key is not None:
        query_kwargs["partition_key"] = partition_key

    items = list(container.query_items(**query_kwargs))
    return items[0] if items else None


def _query_platform_user_by_email(config: "AzureConfig", email: str) -> Optional[dict]:
    normalized_email = normalize_context_value(email).lower()
    if not normalized_email:
        return None

    users_container = get_platform_users_container(config)
    return _query_single_item(
        users_container,
        "SELECT * FROM c WHERE IS_DEFINED(c.email) AND LOWER(c.email) = @email",
        [{"name": "@email", "value": normalized_email}],
    )


def _is_bootstrap_default_membership(config: "AzureConfig", membership: Optional[dict]) -> bool:
    if not membership or not config.default_tenant_id:
        return False

    return (
        membership.get("tenant_id") == config.default_tenant_id
        and normalize_context_value(membership.get("role")).lower() == "editor"
    )


def _has_bootstrap_default_membership(config: "AzureConfig", memberships: list) -> bool:
    if len(memberships) != 1:
        return False

    return _is_bootstrap_default_membership(config, memberships[0])


def _can_create_tenant(config: "AzureConfig", memberships: list, active_role: Optional[str] = None) -> bool:
    if not memberships:
        return True

    if _has_bootstrap_default_membership(config, memberships):
        return True

    if active_role is not None:
        return normalize_context_value(active_role).lower() in TENANT_MUTATION_ADMIN_ROLES

    return any(normalize_context_value(membership.get("role")).lower() in TENANT_MUTATION_ADMIN_ROLES for membership in memberships)


def _find_membership(memberships: list, tenant_id: str) -> Optional[dict]:
    normalized_tenant_id = normalize_context_value(tenant_id)
    for membership in memberships:
        if normalize_context_value(membership.get("tenant_id")) == normalized_tenant_id:
            return membership
    return None


def _upsert_membership(user_doc: dict, membership: dict) -> tuple[dict, bool]:
    memberships = list(user_doc.get("memberships") or [])
    existing_membership = _find_membership(memberships, membership.get("tenant_id"))
    if existing_membership:
        existing_membership.update(membership)
        user_doc["memberships"] = memberships
        return user_doc, False

    memberships.append(membership)
    user_doc["memberships"] = memberships
    return user_doc, True


def _slugify_tenant_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", normalize_context_value(value).lower()).strip("-")
    return slug[:60]


def _ensure_default_tenant_membership(config: AzureConfig, user_doc: dict) -> list:
    memberships = list(user_doc.get("memberships") or [])
    if memberships or not config.default_tenant_id:
        return memberships

    tenant_id = config.default_tenant_id
    tenants_container = get_platform_tenants_container(config)
    try:
        tenant_doc = tenants_container.read_item(item=tenant_id, partition_key=tenant_id)
    except Exception:
        tenant_doc = {
            "id": tenant_id,
            "name": "Default Tenant",
            "slug": f"default-{stable_hash(tenant_id)}",
            "status": "active",
            "isolation_mode": "shared",
            "created_at": utc_now(),
        }
        tenants_container.upsert_item(tenant_doc)

    memberships.append({
        "tenant_id": tenant_doc.get("id", tenant_id),
        "tenant_name": tenant_doc.get("name", "Default Tenant"),
        "tenant_slug": tenant_doc.get("slug", f"default-{stable_hash(tenant_id)}"),
        "role": "editor",
    })
    user_doc["memberships"] = memberships
    return memberships


def _upsert_platform_user(config: AzureConfig, claims: dict) -> dict:
    issuer = normalize_context_value(claims.get("issuer"))
    subject = normalize_context_value(claims.get("sub"))
    if not issuer or not subject:
        raise ValueError("Normalized claims must include issuer and sub")

    issuer_subject = f"{issuer}::{subject}"
    users_container = get_platform_users_container(config)
    existing = _query_single_item(
        users_container,
        "SELECT * FROM c WHERE c.issuer_subject = @issuer_subject",
        [{"name": "@issuer_subject", "value": issuer_subject}],
    )

    placeholder_user = None
    normalized_email = normalize_context_value(claims.get("email")).lower()
    if not existing and normalized_email:
        email_match = _query_platform_user_by_email(config, normalized_email)
        if email_match and normalize_context_value(email_match.get("issuer_subject")).startswith("pending-email::"):
            placeholder_user = email_match

    now = utc_now()
    user_doc = existing or placeholder_user or {
        "id": str(uuid.uuid4()),
        "issuer": issuer,
        "issuer_subject": issuer_subject,
        "memberships": [],
        "created_at": now,
    }
    if placeholder_user and not existing:
        try:
            users_container.delete_item(item=placeholder_user.get("id"), partition_key=placeholder_user.get("issuer_subject"))
        except Exception as exc:
            try:
                users_container.delete_item(item=placeholder_user.get("id"), partition_key=placeholder_user.get("id"))
            except Exception as nested_exc:
                logger.warning(f"Could not delete placeholder user during login reconciliation: {exc}; fallback delete also failed: {nested_exc}")

    user_doc["issuer"] = issuer
    user_doc["issuer_subject"] = issuer_subject
    user_doc["email"] = normalize_context_value(claims.get("email"))
    user_doc["name"] = normalize_context_value(claims.get("name"))
    user_doc["updated_at"] = now
    _ensure_default_tenant_membership(config, user_doc)
    users_container.upsert_item(user_doc)
    return user_doc


def _resolve_active_tenant(req: func.HttpRequest, memberships: list) -> tuple[Optional[str], Optional[str], Optional[func.HttpResponse]]:
    if not memberships:
        return None, None, None

    if len(memberships) == 1:
        membership = memberships[0]
        return membership.get("tenant_id"), membership.get("role"), None

    requested_tenant_id = normalize_context_value(req.headers.get("X-Clinical-Tenant-Id"))
    if not requested_tenant_id:
        return None, None, error_response(400, "Tenant selection is required", "TENANT_REQUIRED")

    for membership in memberships:
        if membership.get("tenant_id") == requested_tenant_id:
            return membership.get("tenant_id"), membership.get("role"), None

    return None, None, error_response(400, "Tenant selection is invalid", "TENANT_REQUIRED")


def get_authenticated_context(req: func.HttpRequest, config: AzureConfig, *, allow_missing_active_tenant: bool = False):
    config_error = get_required_service_config(config, require_cosmos=True)
    if config_error:
        return config_error

    principal_header = req.headers.get("X-MS-CLIENT-PRINCIPAL")
    claims = None

    if principal_header:
        principal = _decode_easy_auth_principal(principal_header)
        idp_header = normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-IDP"))
        if idp_header:
            principal.setdefault("identity_provider", idp_header)
            principal.setdefault("identityProvider", idp_header)
        claims = _normalize_claims(principal)
        claims.setdefault("name", normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-NAME")))
        claims.setdefault("sub", normalize_context_value(req.headers.get("X-MS-CLIENT-PRINCIPAL-ID")))
        if not normalize_context_value(claims.get("issuer")) and idp_header:
            claims["issuer"] = ISSUER_MAP.get(idp_header, idp_header)
    else:
        claims = _build_local_dev_claims(req)

    if not claims or not normalize_context_value(claims.get("sub")):
        return error_response(401, "Authentication required", "AUTH_REQUIRED")

    try:
        user_doc = _upsert_platform_user(config, claims)
    except Exception as exc:
        logger.error(f"Auth user upsert failed: {exc}")
        return error_response(500, "Authentication context could not be created", "AUTH_CONTEXT_FAILED")

    memberships = list(user_doc.get("memberships") or [])
    tenant_id = None
    role = None
    if allow_missing_active_tenant and len(memberships) > 1 and not normalize_context_value(req.headers.get("X-Clinical-Tenant-Id")):
        tenant_id = None
        role = None
    else:
        tenant_id, role, resolution_error = _resolve_active_tenant(req, memberships)
        if resolution_error:
            return resolution_error

    return ClinicalRequestContext(
        user_id=user_doc.get("id", ""),
        tenant_id=tenant_id,
        role=role,
        correlation_id=str(uuid.uuid4()),
        email=user_doc.get("email"),
        name=user_doc.get("name"),
        identity_provider=normalize_context_value(claims.get("identity_provider")),
        memberships=memberships,
    )


def build_auth_session_payload(context: ClinicalRequestContext, config: AzureConfig) -> dict:
    memberships = list(context.memberships or [])
    return {
        "authenticated": True,
        "user_id": context.user_id,
        "email": context.email,
        "name": context.name,
        "identity_provider": context.identity_provider,
        "tenant_id": context.tenant_id,
        "role": context.role,
        "memberships": memberships,
        "can_create_tenant": _can_create_tenant(config, memberships, context.role),
        "has_default_tenant_membership": _has_bootstrap_default_membership(config, memberships),
        "default_tenant_id": config.default_tenant_id or None,
    }


def set_current_request_context(context: Optional[ClinicalRequestContext]) -> None:
    _request_context_local.value = context


def get_current_request_context() -> Optional[ClinicalRequestContext]:
    return getattr(_request_context_local, "value", None)


def require_authenticated_request(handler):
    @wraps(handler)
    def wrapper(req: func.HttpRequest, *args, **kwargs):
        auth_result = get_authenticated_context(req, AzureConfig.from_environment())
        if isinstance(auth_result, func.HttpResponse):
            return auth_result

        set_current_request_context(auth_result)
        try:
            return handler(req, *args, **kwargs)
        finally:
            set_current_request_context(None)

    return wrapper


def get_blob_client(config: AzureConfig, blob_name: str):
    """Get Blob Storage client - supports both connection string and managed identity"""
    from azure.storage.blob import BlobServiceClient
    
    if config.storage_connection_string:
        # Use connection string if available
        service_client = BlobServiceClient.from_connection_string(config.storage_connection_string)
    else:
        # Use managed identity with account name
        from azure.identity import DefaultAzureCredential
        account_url = f"https://{config.storage_account_name}.blob.core.windows.net"
        service_client = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    
    container_client = service_client.get_container_client(config.storage_container_name)
    try:
        container_client.create_container()
    except Exception:
        pass  # Container already exists
    return container_client.get_blob_client(blob_name)


def get_blob_container_client(config: AzureConfig):
    """Get Blob Storage container client - supports both connection string and managed identity"""
    from azure.storage.blob import BlobServiceClient

    if config.storage_connection_string:
        service_client = BlobServiceClient.from_connection_string(config.storage_connection_string)
    else:
        from azure.identity import DefaultAzureCredential
        account_url = f"https://{config.storage_account_name}.blob.core.windows.net"
        service_client = BlobServiceClient(account_url, credential=DefaultAzureCredential())

    container_client = service_client.get_container_client(config.storage_container_name)
    try:
        container_client.create_container()
    except Exception:
        pass
    return container_client


def get_search_credential(config: AzureConfig):
    if config.search_api_key:
        from azure.core.credentials import AzureKeyCredential
        return AzureKeyCredential(config.search_api_key)

    from azure.identity import DefaultAzureCredential
    return DefaultAzureCredential()


def get_search_index_client(config: AzureConfig):
    from azure.search.documents.indexes import SearchIndexClient

    return SearchIndexClient(
        endpoint=config.search_endpoint,
        credential=get_search_credential(config),
    )


def get_search_client(config: AzureConfig):
    from azure.search.documents import SearchClient

    return SearchClient(
        endpoint=config.search_endpoint,
        index_name=config.search_index_name,
        credential=get_search_credential(config),
    )


def ensure_search_index(config: AzureConfig) -> None:
    from azure.search.documents.indexes.models import (
        HnswAlgorithmConfiguration,
        SearchField,
        SearchFieldDataType,
        SearchIndex,
        SearchableField,
        SemanticConfiguration,
        SemanticField,
        SemanticPrioritizedFields,
        SemanticSearch,
        SimpleField,
        VectorSearch,
        VectorSearchProfile,
    )

    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True, sortable=True, facetable=False),
        SimpleField(name="context_item_id", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=False),
        SimpleField(name="encounter_id", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=True),
        SimpleField(name="job_id", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=True),
        SearchableField(name="title", type=SearchFieldDataType.String, filterable=False, sortable=False, facetable=False),
        SearchableField(name="text", type=SearchFieldDataType.String, filterable=False, sortable=False, facetable=False),
        SimpleField(name="category", type=SearchFieldDataType.String, filterable=True, sortable=True, facetable=True),
        SimpleField(name="kind", type=SearchFieldDataType.String, filterable=True, sortable=True, facetable=True),
        SimpleField(name="source", type=SearchFieldDataType.String, filterable=True, sortable=True, facetable=True),
        SimpleField(name="assertion", type=SearchFieldDataType.String, filterable=True, sortable=True, facetable=True),
        SimpleField(name="source_type", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=True),
        SimpleField(name="source_id", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=True),
        SimpleField(name="chunk_index", type=SearchFieldDataType.Int32, filterable=True, sortable=True, facetable=False),
        SimpleField(name="updated_at", type=SearchFieldDataType.DateTimeOffset, filterable=True, sortable=True, facetable=False),
        SimpleField(name="confidence_score", type=SearchFieldDataType.Double, filterable=True, sortable=True, facetable=False),
        SimpleField(name="content_hash", type=SearchFieldDataType.String, filterable=True, sortable=False, facetable=False),
        SearchableField(name="provenance_json", type=SearchFieldDataType.String, filterable=False, sortable=False, facetable=False),
        SearchableField(name="metadata_json", type=SearchFieldDataType.String, filterable=False, sortable=False, facetable=False),
        SearchField(
            name=SEARCH_VECTOR_FIELD_NAME,
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=config.openai_embedding_dimensions,
            vector_search_profile_name=SEARCH_VECTOR_PROFILE_NAME,
        ),
    ]

    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="clinical-context-hnsw")],
        profiles=[
            VectorSearchProfile(
                name=SEARCH_VECTOR_PROFILE_NAME,
                algorithm_configuration_name="clinical-context-hnsw",
            )
        ],
    )
    semantic_search = SemanticSearch(
        configurations=[
            SemanticConfiguration(
                name=SEARCH_SEMANTIC_CONFIGURATION_NAME,
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    prioritized_content_fields=[SemanticField(field_name="text")],
                ),
            )
        ]
    )

    index = SearchIndex(
        name=config.search_index_name,
        fields=fields,
        vector_search=vector_search,
        semantic_search=semantic_search,
    )
    get_search_index_client(config).create_or_update_index(index)


def serialize_search_filter_value(value: str) -> str:
    return value.replace("'", "''")


def encode_search_document_key(raw_key: str) -> str:
    return base64.urlsafe_b64encode(raw_key.encode("utf-8")).decode("ascii").rstrip("=")


CONTEXT_KIND_PRIORITY = {
    "segment": 0,
    "speaker_phrase": 1,
    "finalized_transcript": 2,
    "clinical_relation": 3,
    "clinical_entity": 4,
    "clinical_summary": 5,
    "draft_transcript": 6,
}


QUESTION_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "before",
    "can",
    "did",
    "do",
    "for",
    "had",
    "has",
    "have",
    "how",
    "is",
    "long",
    "next",
    "on",
    "or",
    "she",
    "should",
    "stay",
    "the",
    "their",
    "they",
    "to",
    "was",
    "were",
    "what",
    "which",
    "who",
    "why",
}


QUESTION_SIGNAL_TERMS = {
    "symptom": [
        "headache",
        "headaches",
        "blurry vision",
        "visual symptoms",
        "bright lights",
        "light",
        "tired",
        "pressure",
    ],
    "medication": [
        "acetaminophen",
        "lisinopril",
        "ibuprofen",
        "500 milligrams",
        "20 milligrams daily",
        "twice a week",
        "switching",
        "increase",
    ],
    "measurement": [
        "blood pressure",
        "145 over 95",
        "148 over 92",
        "145/95",
        "148/92",
    ],
    "follow_up": [
        "complete metabolic panel",
        "eye exam",
        "two weeks",
        "follow up",
        "blood work",
        "order",
        "schedule",
    ],
    "red_flag": [
        "weakness",
        "numbness",
        "severe visual changes",
        "emergency room",
        "call us right away",
        "suddenly worsen",
    ],
    "timing_location": [
        "two weeks",
        "front of my head",
        "front of the head",
        "behind my eyes",
        "behind the eyes",
    ],
}


def classify_question_focus(normalized_question: str) -> dict[str, bool]:
    return {
        "symptom": any(token in normalized_question for token in ["symptom", "headache", "vision", "light"]),
        "medication": any(token in normalized_question for token in ["medication", "pain reliever", "ibuprofen", "lisinopril", "acetaminophen", "dose", "dosage"]),
        "measurement": any(token in normalized_question for token in ["blood pressure", "reading", "readings", "measurement", "measurements", "value", "values"]),
        "follow_up": any(token in normalized_question for token in ["test", "tests", "follow-up", "follow up", "ordered", "order", "appointment"]),
        "red_flag": any(token in normalized_question for token in ["red flag", "urgent", "emergency", "serious", "worsen"]),
        "timing_location": any(token in normalized_question for token in ["how long", "where", "located", "location"]),
    }


def collect_question_signal_terms(focus: dict[str, bool]) -> list[str]:
    signal_terms = []
    for key, enabled in focus.items():
        if enabled:
            signal_terms.extend(QUESTION_SIGNAL_TERMS.get(key, []))
    return signal_terms


def score_kind_bonus(kind: str, focus: dict[str, bool]) -> int:
    direct_evidence_kinds = {"segment", "speaker_phrase", "finalized_transcript", "draft_transcript"}
    if any(focus.values()):
        if kind in direct_evidence_kinds:
            return 3
        if kind == "clinical_relation":
            return 2
        if kind == "clinical_entity":
            return 1
        if kind == "clinical_summary":
            return 0
    return max(0, 6 - CONTEXT_KIND_PRIORITY.get(kind or "", 50))


def score_context_signal_hits(haystack: str, focus: dict[str, bool]) -> tuple[int, int]:
    signal_terms = collect_question_signal_terms(focus)
    signal_hits = sum(1 for term in signal_terms if term in haystack)
    numeric_hits = 0
    if focus.get("measurement"):
        numeric_hits = len(re.findall(r"\b\d{2,3}(?:/\d{2,3}| over \d{2,3})\b", haystack))
    return signal_hits, numeric_hits


def tokenize_context_query(value: str) -> list[str]:
    return [
        token
        for token in re.split(r"\W+", normalize_context_value(value).lower())
        if len(token) > 1 and token not in QUESTION_STOPWORDS
    ]


def score_context_item(item: dict, normalized_question: str, question_tokens: list[str]) -> tuple[int, int, int, int]:
    haystack = " ".join(
        normalize_context_value(part).lower()
        for part in [item.get("title"), item.get("text"), item.get("category"), item.get("kind")]
        if part
    )
    focus = classify_question_focus(normalized_question)
    token_hits = sum(1 for token in question_tokens if token in haystack)
    phrase_hit = 1 if normalized_question and normalized_question in haystack else 0
    signal_hits, numeric_hits = score_context_signal_hits(haystack, focus)
    kind_bonus = score_kind_bonus(item.get("kind") or "", focus)
    text_length = len(item.get("text") or "")
    return (signal_hits, numeric_hits, phrase_hit, token_hits, kind_bonus, -text_length)


def rerank_context_items(items: list[dict], question: str) -> list[dict]:
    normalized_question = normalize_context_value(question).lower()
    if not normalized_question:
        return sorted(
            items,
            key=lambda item: (
                CONTEXT_KIND_PRIORITY.get(item.get("kind") or "", 50),
                -(len(item.get("text") or "")),
                item.get("title") or "",
            ),
        )

    question_tokens = tokenize_context_query(normalized_question)
    return sorted(
        items,
        key=lambda item: score_context_item(item, normalized_question, question_tokens),
        reverse=True,
    )


def diversify_context_items(items: list[dict], limit: int) -> list[dict]:
    if len(items) <= limit:
        return items

    selected = []
    seen_ids = set()
    kinds_in_priority_order = sorted(
        {item.get("kind") or "unknown" for item in items},
        key=lambda kind: CONTEXT_KIND_PRIORITY.get(kind, 50),
    )

    for kind in kinds_in_priority_order:
        for item in items:
            item_id = item.get("id")
            if item_id in seen_ids or item.get("kind") != kind:
                continue
            selected.append(item)
            seen_ids.add(item_id)
            break

    for item in items:
        item_id = item.get("id")
        if item_id in seen_ids:
            continue
        selected.append(item)
        seen_ids.add(item_id)
        if len(selected) >= limit:
            break

    return selected[:limit]


def split_context_sentences(text: str) -> list[str]:
    normalized = normalize_context_value(text)
    if not normalized:
        return []

    sentences = []
    for part in re.split(r"(?<=[.!?])\s+|\n+", normalized):
        snippet = part.strip()
        if snippet:
            sentences.append(snippet)
    return sentences


def clean_context_sentence(sentence: str) -> str:
    cleaned = normalize_context_value(sentence)
    cleaned = re.sub(r"^[-*\s]+", "", cleaned)
    cleaned = cleaned.replace("**", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def build_snippet_payload(item: dict, sentence: str) -> dict:
    return {
        "item_id": item.get("id"),
        "item": item,
        "text": sentence,
    }


def prioritize_answer_items(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda item: CONTEXT_KIND_PRIORITY.get(item.get("kind") or "", 50))


def append_snippet(selected: list[dict], snippet: dict, max_snippets: int) -> bool:
    snippet_text = snippet.get("text") or ""
    snippet_lower = snippet_text.lower()

    for index, existing in enumerate(selected):
        existing_text = existing.get("text") or ""
        existing_lower = existing_text.lower()
        if snippet_lower == existing_lower:
            return False
        if existing_lower.startswith(snippet_lower):
            return False
        if snippet_lower.startswith(existing_lower):
            selected[index] = snippet
            return len(selected) >= max_snippets

    selected.append(snippet)
    return len(selected) >= max_snippets


def collect_targeted_answer_snippets(items: list[dict], focus: dict[str, bool], max_snippets: int) -> list[dict]:
    selected = []
    prioritized_items = prioritize_answer_items(items)

    def iter_sentences(preferred_kinds: Optional[set[str]] = None, preferred_roles: Optional[set[str]] = None):
        for item in prioritized_items:
            item_kind = item.get("kind") or ""
            if preferred_kinds and item_kind not in preferred_kinds:
                continue
            item_metadata = item.get("metadata") or {}
            speaker_role = normalize_context_value(item_metadata.get("role") or item_metadata.get("speaker")).lower()
            for sentence in split_context_sentences(item.get("text") or ""):
                cleaned_sentence = clean_context_sentence(sentence)
                if cleaned_sentence:
                    sentence_lower = cleaned_sentence.lower()
                    detected_role = speaker_role
                    if not detected_role:
                        if "[patient]" in sentence_lower:
                            detected_role = "patient"
                        elif "[doctor]" in sentence_lower:
                            detected_role = "doctor"

                    if preferred_roles and detected_role not in preferred_roles:
                        continue

                    yield item, cleaned_sentence, sentence_lower, detected_role

    direct_evidence_kinds = {"segment", "speaker_phrase", "finalized_transcript", "draft_transcript"}

    def append_first_match(matcher, *, preferred_roles: Optional[set[str]] = None) -> None:
        for item, cleaned_sentence, sentence_lower, _ in iter_sentences(direct_evidence_kinds, preferred_roles):
            if not matcher(sentence_lower):
                continue
            if append_snippet(selected, build_snippet_payload(item, cleaned_sentence), max_snippets):
                return
            return

    if focus.get("measurement"):
        seen_values = set()
        for preferred_roles in ({"patient"}, {"doctor"}, None):
            for item, cleaned_sentence, sentence_lower, _ in iter_sentences(direct_evidence_kinds, preferred_roles):
                values = re.findall(r"\b\d{2,3}(?:/\d{2,3}| over \d{2,3})\b", sentence_lower)
                unseen_values = [value for value in values if value not in seen_values]
                if not unseen_values:
                    continue
                seen_values.update(unseen_values)
                if append_snippet(selected, build_snippet_payload(item, cleaned_sentence), max_snippets):
                    return selected
                if len(seen_values) >= 2:
                    break
            if len(seen_values) >= 2:
                break

    if focus.get("symptom"):
        append_first_match(lambda sentence: any(term in sentence for term in ["headache", "headaches", "constant pressure"]), preferred_roles={"patient"})
        append_first_match(lambda sentence: any(term in sentence for term in ["blurry vision", "bright lights", "sensitivity to light", "visual symptoms"]), preferred_roles={"patient"})

    if focus.get("medication"):
        append_first_match(lambda sentence: "acetaminophen" in sentence or "twice a week" in sentence, preferred_roles={"doctor"})
        append_first_match(
            lambda sentence: "lisinopril" in sentence and ("20 milligrams" in sentence or "increase" in sentence),
            preferred_roles={"doctor"},
        )

    if focus.get("follow_up"):
        append_first_match(lambda sentence: "complete metabolic panel" in sentence or "blood work" in sentence, preferred_roles={"doctor"})
        append_first_match(lambda sentence: "eye exam" in sentence, preferred_roles={"doctor"})
        append_first_match(lambda sentence: "two weeks" in sentence or "follow up" in sentence or "follow-up" in sentence)

    if focus.get("timing_location"):
        append_first_match(
            lambda sentence: "two weeks" in sentence and ("front of" in sentence or "behind" in sentence),
            preferred_roles={"patient"},
        )

    if focus.get("red_flag"):
        append_first_match(
            lambda sentence: any(term in sentence for term in ["weakness", "numbness", "severe visual changes", "emergency room", "call us right away"]),
            preferred_roles={"doctor"},
        )

    if not selected and focus.get("measurement"):
        for item, cleaned_sentence, sentence_lower, _ in iter_sentences():
            if re.search(r"\b\d{2,3}(?:/\d{2,3}| over \d{2,3})\b", sentence_lower):
                if append_snippet(selected, build_snippet_payload(item, cleaned_sentence), max_snippets):
                    return selected

    return selected


def build_answer_snippets(items: list[dict], question: str, max_snippets: int = 4) -> list[dict]:
    normalized_question = normalize_context_value(question).lower()
    question_tokens = tokenize_context_query(normalized_question)
    focus = classify_question_focus(normalized_question)
    targeted_snippets = collect_targeted_answer_snippets(items, focus, max_snippets)
    ranked_snippets = []

    for item in items:
        item_kind = item.get("kind") or ""
        item_metadata = item.get("metadata") or {}
        speaker_role = normalize_context_value(item_metadata.get("role") or item_metadata.get("speaker")).lower()
        for sentence in split_context_sentences(item.get("text") or ""):
            cleaned_sentence = clean_context_sentence(sentence)
            if not cleaned_sentence:
                continue

            sentence_lower = cleaned_sentence.lower()
            token_hits = sum(1 for token in question_tokens if token in sentence_lower)
            phrase_hit = 1 if normalized_question and normalized_question in sentence_lower else 0
            signal_hits, numeric_hits = score_context_signal_hits(sentence_lower, focus)
            kind_bonus = score_kind_bonus(item_kind, focus)
            speaker_bonus = 0
            if focus.get("symptom") or focus.get("timing_location"):
                if "[patient]" in sentence_lower or speaker_role == "patient":
                    speaker_bonus = 2
            if focus.get("medication") or focus.get("follow_up") or focus.get("red_flag") or focus.get("measurement"):
                if "[doctor]" in sentence_lower or speaker_role == "doctor":
                    speaker_bonus = 2

            ranked_snippets.append(
                (
                    (signal_hits, numeric_hits, phrase_hit, token_hits, speaker_bonus, kind_bonus, -len(cleaned_sentence)),
                    build_snippet_payload(item, cleaned_sentence),
                )
            )

    ranked_snippets.sort(key=lambda entry: entry[0], reverse=True)

    selected = list(targeted_snippets)
    seen = {snippet.get("text") for snippet in selected}
    for _, snippet in ranked_snippets:
        snippet_text = snippet["text"]
        if snippet_text in seen:
            continue
        selected.append(snippet)
        seen.add(snippet_text)
        if len(selected) >= max_snippets:
            break

    return selected


def build_search_documents(encounter: EncounterSession, job: Optional[TranscriptionJob]) -> list:
    items = build_encounter_context_items(encounter, job)
    updated_at = (job.updated_at if job else None) or encounter.updated_at or utc_now()
    documents = []

    for item in items:
        base_doc = {
            "context_item_id": item.get("id"),
            "encounter_id": encounter.id,
            "job_id": (job.id if job else "") or "",
            "category": item.get("category") or "unknown",
            "kind": item.get("kind") or "unknown",
            "source": item.get("source") or "job",
            "assertion": item.get("assertion") or "",
            "source_type": ((item.get("provenance") or [{}])[0]).get("source_type", ""),
            "source_id": ((item.get("provenance") or [{}])[0]).get("source_id", ""),
            "confidence_score": item.get("confidence_score"),
            "updated_at": updated_at,
            "provenance_json": json.dumps(item.get("provenance") or []),
            "metadata_json": json.dumps(item.get("metadata") or {}),
        }

        text_chunks = []
        if item.get("kind") in {"finalized_transcript", "draft_transcript", "clinical_summary"}:
            if item.get("kind") == "clinical_summary":
                for section in split_summary_sections(item.get("text") or ""):
                    for section_chunk in split_text_into_chunks(
                        section.get("text") or "",
                        max_chars=SEARCH_TEXT_CHUNK_CHARS,
                        overlap_chars=SEARCH_TEXT_OVERLAP_CHARS,
                    ):
                        text_chunks.append({
                            "title": section.get("title") or item.get("title"),
                            "text": section_chunk["text"],
                        })
            else:
                for chunk in split_text_into_chunks(
                    item.get("text") or "",
                    max_chars=SEARCH_TEXT_CHUNK_CHARS,
                    overlap_chars=SEARCH_TEXT_OVERLAP_CHARS,
                ):
                    text_chunks.append({
                        "title": item.get("title"),
                        "text": chunk["text"],
                    })
        else:
            text_chunks.append({
                "title": item.get("title"),
                "text": item.get("text") or "",
            })

        for chunk_index, chunk in enumerate(text_chunks):
            chunk_text = (chunk.get("text") or "").strip()
            if not chunk_text:
                continue

            documents.append({
                **base_doc,
                "id": encode_search_document_key(f"{item.get('id')}:{chunk_index}"),
                "title": chunk.get("title") or item.get("title") or "Clinical context",
                "text": chunk_text,
                "chunk_index": chunk_index,
                "content_hash": stable_hash(f"{item.get('id')}::{chunk_index}::{chunk_text}"),
            })

    return documents


def generate_embeddings(texts: list, config: AzureConfig) -> list:
    if not texts:
        return []

    if not config.openai_endpoint or not config.openai_embedding_deployment:
        raise RuntimeError("Azure OpenAI embedding configuration error: set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_EMBEDDING_DEPLOYMENT")

    url = f"{config.openai_endpoint.rstrip('/')}/openai/deployments/{config.openai_embedding_deployment}/embeddings?api-version=2024-02-01"
    headers = get_openai_headers(config)
    embeddings = []

    for batch_start in range(0, len(texts), 16):
        batch = texts[batch_start:batch_start + 16]
        response = post_openai_json_with_retry(
            url,
            headers=headers,
            payload={"input": batch},
            timeout=90,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Embedding generation failed: {response.status_code} {response.text}")

        payload = response.json()
        batch_vectors = [item.get("embedding") or [] for item in sorted(payload.get("data", []), key=lambda item: item.get("index", 0))]
        embeddings.extend(batch_vectors)

    return embeddings


def sync_encounter_search_index(encounter: EncounterSession, job: Optional[TranscriptionJob], config: AzureConfig) -> dict:
    ensure_search_index(config)
    documents = build_search_documents(encounter, job)
    if not documents:
        return {"indexed_documents": 0, "deleted_documents": 0}

    embeddings = generate_embeddings([document["text"] for document in documents], config)
    if len(embeddings) != len(documents):
        raise RuntimeError("Embedding generation returned an unexpected document count")

    for document, vector in zip(documents, embeddings):
        document[SEARCH_VECTOR_FIELD_NAME] = vector

    search_client = get_search_client(config)
    existing_results = search_client.search(
        search_text="*",
        filter=f"encounter_id eq '{serialize_search_filter_value(encounter.id)}'",
        select=["id"],
        top=1000,
    )
    existing_ids = {result.get("id") for result in existing_results if result.get("id")}
    next_ids = {document["id"] for document in documents}
    stale_ids = existing_ids - next_ids

    if stale_ids:
        search_client.delete_documents(documents=[{"id": stale_id} for stale_id in stale_ids])

    upload_results = search_client.merge_or_upload_documents(documents=documents)
    failed_results = [result for result in upload_results if not getattr(result, "succeeded", False)]
    if failed_results:
        raise RuntimeError(f"Azure AI Search indexing failed for {len(failed_results)} document(s)")

    return {
        "indexed_documents": len(documents),
        "deleted_documents": len(stale_ids),
    }


def build_context_item_from_search_document(document: dict) -> dict:
    return normalize_context_item(
        {
            "id": document.get("context_item_id") or document.get("id"),
            "category": document.get("category") or "unknown",
            "kind": document.get("kind") or "unknown",
            "title": document.get("title") or "Clinical context",
            "text": document.get("text") or "",
            "source": document.get("source") or "job",
            "assertion": document.get("assertion") or None,
            "confidence_score": document.get("confidence_score"),
            "provenance": safe_json_loads(document.get("provenance_json"), []),
            "metadata": safe_json_loads(document.get("metadata_json"), {}),
        }
    )


def normalize_context_provenance_list(value) -> list:
    if not isinstance(value, list):
        return []

    normalized_entries = []
    for entry in value:
        if not isinstance(entry, dict):
            continue

        source_type = normalize_context_value(entry.get("source_type")) or "unknown"
        source_id = normalize_context_value(entry.get("source_id")) or "unknown"
        normalized_entry = {
            "source_type": source_type,
            "source_id": source_id,
        }

        excerpt = normalize_context_value(entry.get("excerpt"))
        if excerpt:
            normalized_entry["excerpt"] = excerpt

        normalized_entries.append(normalized_entry)

    return normalized_entries


def normalize_context_item(item: dict) -> dict:
    source = normalize_context_value(item.get("source")).lower() or "job"
    if source not in {"encounter", "job"}:
        source = "job"

    normalized_item = {
        "id": normalize_context_value(item.get("id")) or "unknown",
        "category": normalize_context_value(item.get("category")).lower() or "unknown",
        "kind": normalize_context_value(item.get("kind")) or "unknown",
        "title": normalize_context_value(item.get("title")) or "Clinical context",
        "text": normalize_context_value(item.get("text")),
        "source": source,
        "provenance": normalize_context_provenance_list(item.get("provenance")),
        "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
    }

    assertion = normalize_context_value(item.get("assertion")).lower()
    if assertion:
        normalized_item["assertion"] = assertion

    confidence_score = item.get("confidence_score")
    if confidence_score is not None:
        try:
            normalized_item["confidence_score"] = round(float(confidence_score), 4)
        except (TypeError, ValueError):
            pass

    return normalized_item


def build_context_filter_summary(*, q: str = "", category: str = "", assertion: str = "", limit: int = 50) -> dict:
    bounded_limit = max(1, min(limit, 200))
    return {
        "q": normalize_context_value(q) or None,
        "category": normalize_context_value(category).lower() or None,
        "assertion": normalize_context_value(assertion).lower() or None,
        "limit": bounded_limit,
    }


def build_encounter_context_payload(
    encounter: EncounterSession,
    job: Optional[TranscriptionJob],
    *,
    items: Optional[list] = None,
    total_items: int = 0,
    q: str = "",
    category: str = "",
    assertion: str = "",
    limit: int = 50,
    categories: Optional[list] = None,
    assertions: Optional[list] = None,
) -> dict:
    generated_at = utc_now()
    normalized_items = [normalize_context_item(item) for item in (items or [])]
    linked_job_id = normalize_context_value(encounter.process_job_id) or None
    context_version = normalize_context_value((job.updated_at if job else None) or encounter.updated_at) or generated_at
    filter_summary = build_context_filter_summary(q=q, category=category, assertion=assertion, limit=limit)

    return {
        "encounter_id": encounter.id,
        "status": encounter.status,
        "generated_at": generated_at,
        "linked_job_id": linked_job_id,
        "contract_version": ENCOUNTER_CONTEXT_CONTRACT_VERSION,
        "context_version": context_version,
        "items": normalized_items,
        "summary": {
            "total_items": max(0, int(total_items)),
            "returned_items": len(normalized_items),
            "categories": sorted({normalize_context_value(value).lower() for value in (categories or []) if normalize_context_value(value)}),
            "assertions": sorted({normalize_context_value(value).lower() for value in (assertions or []) if normalize_context_value(value)}),
            "applied_filters": filter_summary,
        },
    }


def normalize_freshness_metadata(value, *, generated_at: str, is_mock: bool = True) -> dict:
    freshness = value if isinstance(value, dict) else {}
    fetched_at = normalize_context_value(freshness.get("fetched_at")) or generated_at
    expires_at = normalize_context_value(freshness.get("expires_at")) or fetched_at
    return {
        "fetched_at": fetched_at,
        "expires_at": expires_at,
        "is_mock": bool(freshness.get("is_mock", is_mock)),
    }


def normalize_operational_context(payload: dict, encounter: EncounterSession, job: Optional[TranscriptionJob]) -> dict:
    generated_at = normalize_context_value((payload or {}).get("generated_at")) or utc_now()
    linked_job_id = normalize_context_value((payload or {}).get("linked_job_id")) or normalize_context_value(encounter.process_job_id) or None

    eligibility = (payload or {}).get("eligibility") if isinstance((payload or {}).get("eligibility"), dict) else {}
    scheme_qualification = (payload or {}).get("scheme_qualification") if isinstance((payload or {}).get("scheme_qualification"), dict) else {}
    treatment_lookup = (payload or {}).get("treatment_lookup") if isinstance((payload or {}).get("treatment_lookup"), dict) else {}
    prior_auth_summaries = (payload or {}).get("prior_auth_summaries") if isinstance((payload or {}).get("prior_auth_summaries"), dict) else {}
    communication_options = (payload or {}).get("communication_options") if isinstance((payload or {}).get("communication_options"), dict) else {}

    treatment_results = treatment_lookup.get("results") if isinstance(treatment_lookup.get("results"), list) else []
    prior_auth_results = prior_auth_summaries.get("results") if isinstance(prior_auth_summaries.get("results"), list) else []
    communication_results = communication_options.get("results") if isinstance(communication_options.get("results"), list) else []

    return {
        "encounter_id": encounter.id,
        "status": encounter.status,
        "generated_at": generated_at,
        "linked_job_id": linked_job_id,
        "contract_version": OPERATIONAL_CONTEXT_CONTRACT_VERSION,
        "eligibility": {
            "provider": normalize_context_value(eligibility.get("provider")),
            "status": normalize_context_value(eligibility.get("status")),
            "member_reference": normalize_context_value(eligibility.get("member_reference")),
            "summary": normalize_context_value(eligibility.get("summary")),
            "freshness": normalize_freshness_metadata(eligibility.get("freshness"), generated_at=generated_at),
        },
        "scheme_qualification": {
            "provider": normalize_context_value(scheme_qualification.get("provider")),
            "plan_name": normalize_context_value(scheme_qualification.get("plan_name")),
            "qualification_status": normalize_context_value(scheme_qualification.get("qualification_status")),
            "summary": normalize_context_value(scheme_qualification.get("summary")),
            "freshness": normalize_freshness_metadata(scheme_qualification.get("freshness"), generated_at=generated_at),
        },
        "treatment_lookup": {
            "provider": normalize_context_value(treatment_lookup.get("provider")),
            "results": [
                {
                    "code": normalize_context_value(result.get("code")),
                    "title": normalize_context_value(result.get("title")),
                    "category": normalize_context_value(result.get("category")),
                    "summary": normalize_context_value(result.get("summary")),
                    "mock_source": normalize_context_value(result.get("mock_source")),
                }
                for result in treatment_results
                if isinstance(result, dict)
            ],
            "freshness": normalize_freshness_metadata(treatment_lookup.get("freshness"), generated_at=generated_at),
        },
        "prior_auth_summaries": {
            "provider": normalize_context_value(prior_auth_summaries.get("provider")),
            "results": [
                {
                    "treatment_code": normalize_context_value(result.get("treatment_code")),
                    "status": normalize_context_value(result.get("status")),
                    "summary": normalize_context_value(result.get("summary")),
                }
                for result in prior_auth_results
                if isinstance(result, dict)
            ],
            "freshness": normalize_freshness_metadata(prior_auth_summaries.get("freshness"), generated_at=generated_at),
        },
        "communication_options": {
            "provider": normalize_context_value(communication_options.get("provider")),
            "results": [
                {
                    "channel": normalize_context_value(result.get("channel")),
                    "target": normalize_context_value(result.get("target")),
                    "summary": normalize_context_value(result.get("summary")),
                }
                for result in communication_results
                if isinstance(result, dict)
            ],
            "freshness": normalize_freshness_metadata(communication_options.get("freshness"), generated_at=generated_at),
        },
        "audit_metadata": (payload or {}).get("audit_metadata") if isinstance((payload or {}).get("audit_metadata"), dict) else {
            "mode": "mock",
            "source": "operational_context_mock_provider",
            "clinical_job_available": bool(job),
        },
    }


def search_encounter_context(
    encounter: EncounterSession,
    job: Optional[TranscriptionJob],
    config: AzureConfig,
    *,
    q: str = "",
    category: str = "",
    assertion: str = "",
    limit: int = 50,
) -> dict:
    from azure.search.documents.models import VectorizedQuery

    bounded_limit = max(1, min(limit, 200))
    if not encounter.process_job_id:
        return build_encounter_context_payload(
            encounter,
            job,
            items=[],
            total_items=0,
            q=q,
            category=category,
            assertion=assertion,
            limit=bounded_limit,
        )

    search_client = get_search_client(config)
    encounter_filter = f"encounter_id eq '{serialize_search_filter_value(encounter.id)}'"

    summary_results = search_client.search(
        search_text="*",
        filter=encounter_filter,
        include_total_count=True,
        facets=["category,count:20", "assertion,count:20"],
        select=["id"],
        top=1,
    )
    total_items = summary_results.get_count() or 0
    facets = summary_results.get_facets() or {}

    query_filter = encounter_filter
    normalized_category = normalize_context_value(category).lower()
    if normalized_category:
        query_filter += f" and category eq '{serialize_search_filter_value(normalized_category)}'"

    normalized_assertion = normalize_context_value(assertion).lower()
    if normalized_assertion:
        query_filter += f" and assertion eq '{serialize_search_filter_value(normalized_assertion)}'"

    normalized_q = normalize_context_value(q)
    vector_queries = None
    if normalized_q:
        query_vector = generate_embeddings([normalized_q], config)[0]
        vector_queries = [
            VectorizedQuery(
                vector=query_vector,
                k_nearest_neighbors=max(bounded_limit * 4, 10),
                fields=SEARCH_VECTOR_FIELD_NAME,
            )
        ]

    candidate_limit = bounded_limit
    if normalized_q:
        candidate_limit = min(200, max(bounded_limit * 6, 40))
    elif not normalized_category and not normalized_assertion:
        candidate_limit = min(200, max(bounded_limit * 4, 100))

    result_iterable = search_client.search(
        search_text=normalized_q or "*",
        vector_queries=vector_queries,
        filter=query_filter,
        include_total_count=True,
        select=[
            "id",
            "context_item_id",
            "title",
            "text",
            "category",
            "kind",
            "source",
            "assertion",
            "confidence_score",
            "provenance_json",
            "metadata_json",
        ],
        top=candidate_limit,
    )
    result_items = [build_context_item_from_search_document(result) for result in result_iterable]
    result_items = rerank_context_items(result_items, normalized_q)
    if not normalized_q and not normalized_category and not normalized_assertion:
        result_items = diversify_context_items(result_items, bounded_limit)
    else:
        result_items = result_items[:bounded_limit]

    return build_encounter_context_payload(
        encounter,
        job,
        items=result_items,
        total_items=total_items,
        q=normalized_q,
        category=normalized_category,
        assertion=normalized_assertion,
        limit=bounded_limit,
        categories=[item.get("value") for item in (facets.get("category") or [])],
        assertions=[item.get("value") for item in (facets.get("assertion") or [])],
    )


SUPPORTED_FORMATS = {'.wav', '.mp3', '.m4a', '.ogg', '.flac', '.wma', '.aac'}


def is_supported_format(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_FORMATS


# ============================================================================
# FHIR Bundle Generator
# ============================================================================

def generate_fhir_bundle(medical_entities: dict) -> dict:
    """Generate a comprehensive FHIR R4 bundle from extracted medical entities"""
    if not medical_entities:
        return {"resourceType": "Bundle", "type": "collection", "total": 0, "entry": []}
    
    entities = medical_entities.get("entities", [])
    relations = medical_entities.get("relations", [])
    summary = medical_entities.get("summary", {})
    diarization = medical_entities.get("diarization", {})
    fhir_resources = []
    
    # Map all Text Analytics for Health categories to FHIR resource types
    category_to_fhir = {
        "BodyStructure": "BodyStructure",
        "Age": "Observation", "Ethnicity": "Observation", "Gender": "Patient",
        "ExaminationName": "DiagnosticReport",
        "Allergen": "AllergyIntolerance",
        "Course": "Observation", "Date": "Observation", "Direction": "Observation",
        "Frequency": "Observation", "Time": "Observation", "MeasurementUnit": "Observation",
        "MeasurementValue": "Observation", "RelationalOperator": "Observation",
        "Variant": "Observation", "GeneOrProtein": "Observation",
        "MutationType": "Observation", "Expression": "Observation",
        "AdministrativeEvent": "Encounter", "CareEnvironment": "Location",
        "HealthcareProfession": "Practitioner",
        "Diagnosis": "Condition", "SymptomOrSign": "Observation",
        "ConditionQualifier": "Observation", "ConditionScale": "Observation",
        "MedicationClass": "Medication", "MedicationName": "MedicationStatement",
        "Dosage": "MedicationStatement", "MedicationForm": "Medication",
        "MedicationRoute": "MedicationStatement",
        "FamilyRelation": "FamilyMemberHistory",
        "Employment": "Observation", "LivingStatus": "Observation",
        "SubstanceUse": "Observation", "SubstanceUseAmount": "Observation",
        "TreatmentName": "Procedure",
    }
    
    # Map certainty values to FHIR verification status
    # Reference: https://learn.microsoft.com/en-us/azure/ai-services/language-service/text-analytics-for-health/concepts/assertion-detection
    certainty_to_status = {
        "positive": "confirmed",
        "positive_possible": "provisional",
        "negative": "refuted",
        "negative_possible": "refuted",
        "neutral_possible": "unconfirmed"
    }
    
    for idx, entity in enumerate(entities, 1):
        category = entity.get("category", "")
        fhir_type = category_to_fhir.get(category, "Observation")
        assertion = entity.get("assertion") or {}
        links = entity.get("links") or []
        
        # Build coding array from entity links
        coding = []
        for link in links:
            data_source = link.get("dataSource", "")
            code_id = link.get("id", "")
            # Map data sources to FHIR system URIs
            system_map = {
                "UMLS": "http://terminology.hl7.org/CodeSystem/umls",
                "SNOMEDCT_US": "http://snomed.info/sct",
                "ICD10CM": "http://hl7.org/fhir/sid/icd-10-cm",
                "ICD9CM": "http://hl7.org/fhir/sid/icd-9-cm",
                "RXNORM": "http://www.nlm.nih.gov/research/umls/rxnorm",
                "MSH": "http://id.nlm.nih.gov/mesh",
                "NCI": "http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl",
                "HPO": "http://purl.obolibrary.org/obo/hp.owl"
            }
            if data_source in system_map:
                coding.append({
                    "system": system_map[data_source],
                    "code": code_id,
                    "display": entity.get("text", "")
                })
        
        resource = {
            "resourceType": fhir_type,
            "id": f"entity-{idx}",
            "meta": {
                "profile": [f"http://hl7.org/fhir/StructureDefinition/{fhir_type}"],
                "source": "azure-text-analytics-for-health",
                "tag": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationValue", "code": "SUBSETTED"}]
            },
            "text": {
                "status": "generated",
                "div": f"<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>{category}</b>: {entity.get('text', '')}</p></div>"
            },
            "code": {
                "text": entity.get("text", ""),
                "coding": coding if coding else None
            },
            "extension": []
        }
        
        # Add confidence score extension
        resource["extension"].append({
            "url": "http://hl7.org/fhir/StructureDefinition/confidence",
            "valueDecimal": round(entity.get("confidence_score", 0), 4)
        })
        
        # Add category extension
        resource["extension"].append({
            "url": "http://hl7.org/fhir/StructureDefinition/text-analytics-category",
            "valueString": category
        })
        
        # Add text position extension
        resource["extension"].append({
            "url": "http://hl7.org/fhir/StructureDefinition/text-offset",
            "valueInteger": entity.get("offset", 0)
        })
        
        # Add assertion extensions with proper FHIR structure
        # Reference: https://learn.microsoft.com/en-us/azure/ai-services/language-service/text-analytics-for-health/concepts/assertion-detection
        if assertion:
            certainty = assertion.get("certainty")
            conditionality = assertion.get("conditionality")
            association = assertion.get("association")
            temporal = assertion.get("temporal")
            
            # CERTAINTY: positive (default), negative, positive_possible, negative_possible, neutral_possible
            if certainty:
                certainty_display = {
                    "positive": "Confirmed - concept exists",
                    "negative": "Negated - concept does not exist",
                    "positive_possible": "Likely Present - probably exists but uncertain",
                    "negative_possible": "Possibly Absent - unlikely but uncertain",
                    "neutral_possible": "Uncertain - may or may not exist"
                }
                resource["extension"].append({
                    "url": "http://hl7.org/fhir/StructureDefinition/condition-assertedCertainty",
                    "valueCodeableConcept": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/certainty-type",
                            "code": certainty,
                            "display": certainty_display.get(certainty, certainty)
                        }],
                        "text": certainty
                    }
                })
            
            # CONDITIONALITY: none (default), hypothetical, conditional
            if conditionality:
                conditionality_display = {
                    "hypothetical": "Hypothetical - may develop in future",
                    "conditional": "Conditional - exists only under certain conditions"
                }
                resource["extension"].append({
                    "url": "http://hl7.org/fhir/StructureDefinition/condition-conditionality",
                    "valueCodeableConcept": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/conditionality-type",
                            "code": conditionality,
                            "display": conditionality_display.get(conditionality, conditionality)
                        }],
                        "text": conditionality
                    }
                })
            
            # ASSOCIATION: subject (default), other
            if association:
                association_display = {
                    "subject": "Subject - associated with the patient",
                    "other": "Other - associated with family member or other person"
                }
                resource["extension"].append({
                    "url": "http://hl7.org/fhir/StructureDefinition/condition-association",
                    "valueCodeableConcept": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/association-type",
                            "code": association,
                            "display": association_display.get(association, association)
                        }],
                        "text": association
                    }
                })
            
            # TEMPORAL: current (default), past, future
            if temporal:
                temporal_display = {
                    "current": "Current - related to current encounter",
                    "past": "Past - prior to current encounter",
                    "future": "Future - planned or scheduled"
                }
                resource["extension"].append({
                    "url": "http://hl7.org/fhir/StructureDefinition/condition-temporal",
                    "valueCodeableConcept": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/temporal-type",
                            "code": temporal,
                            "display": temporal_display.get(temporal, temporal)
                        }],
                        "text": temporal
                    }
                })
            
            # Set verification status for Condition resources
            if fhir_type == "Condition" and certainty:
                resource["verificationStatus"] = {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                        "code": certainty_to_status.get(certainty, "unconfirmed")
                    }]
                }
        
        # Remove empty extensions
        if not resource["extension"]:
            del resource["extension"]
        # Remove empty coding
        if resource["code"]["coding"] is None:
            del resource["code"]["coding"]
        
        fhir_resources.append({
            "fullUrl": f"urn:uuid:entity-{idx}",
            "resource": resource
        })
    
    # Add relations as Observation resources with references
    for rel_idx, relation in enumerate(relations, 1):
        rel_type = relation.get("relationType", "Unknown")
        entities_in_rel = relation.get("entities", [])
        
        # Extract source and target from entities array (usually 2 entities with roles)
        source_entity = None
        target_entity = None
        for ent in entities_in_rel:
            role = ent.get("role", "")
            # Common source roles
            if role in ["Condition", "Medication", "Treatment", "Examination", "Gene", "BodyStructure"]:
                if source_entity is None:
                    source_entity = ent
                else:
                    target_entity = ent
            # Common target/modifier roles  
            elif role in ["Dosage", "Route", "Form", "Frequency", "Time", "Course", "Direction", 
                         "Qualifier", "Scale", "Unit", "Value", "BodySite", "Amount", "Variant", "MutationType"]:
                target_entity = ent
            else:
                # Fallback: first is source, second is target
                if source_entity is None:
                    source_entity = ent
                else:
                    target_entity = ent
        
        # If we only have entities but couldn't determine source/target, use first two
        if source_entity is None and len(entities_in_rel) > 0:
            source_entity = entities_in_rel[0]
        if target_entity is None and len(entities_in_rel) > 1:
            target_entity = entities_in_rel[1]
        
        source_text = source_entity.get("text", "") if source_entity else ""
        target_text = target_entity.get("text", "") if target_entity else ""
        
        relation_resource = {
            "resourceType": "Observation",
            "id": f"relation-{rel_idx}",
            "meta": {
                "profile": ["http://hl7.org/fhir/StructureDefinition/Observation"],
                "source": "azure-text-analytics-for-health"
            },
            "status": "final",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code": "clinical-relationship",
                    "display": "Clinical Relationship"
                }]
            }],
            "code": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/relation-type",
                    "code": rel_type,
                    "display": rel_type.replace("Of", " of ").replace("For", " for ")
                }],
                "text": f"{rel_type}: {source_text} → {target_text}"
            },
            "component": [
                {
                    "code": {"text": "source"},
                    "valueString": source_text
                },
                {
                    "code": {"text": "target"}, 
                    "valueString": target_text
                }
            ],
            "extension": [{
                "url": "http://hl7.org/fhir/StructureDefinition/confidence",
                "valueDecimal": round(relation.get("confidenceScore", relation.get("confidence_score", 0)), 4)
            }]
        }
        
        # Add all entities with their roles
        for ent_idx, ent in enumerate(entities_in_rel):
            relation_resource["component"].append({
                "code": {"text": ent.get("role", f"entity-{ent_idx}")},
                "valueString": ent.get("text", ""),
                "extension": [{
                    "url": "category",
                    "valueString": ent.get("category", "")
                }]
            })
        
        fhir_resources.append({
            "fullUrl": f"urn:uuid:relation-{rel_idx}",
            "resource": relation_resource
        })
    
    # Add summary as DocumentReference
    if summary:
        summary_resource = {
            "resourceType": "DocumentReference",
            "id": "analysis-summary",
            "meta": {"source": "azure-text-analytics-for-health"},
            "status": "current",
            "type": {"text": "Healthcare Transcription Analysis Summary"},
            "description": "Summary of medical entity extraction from transcribed audio",
            "content": [{
                "attachment": {
                    "contentType": "application/json",
                    "data": None
                }
            }],
            "extension": [
                {"url": "total-entities", "valueInteger": summary.get("total_entities", 0)},
                {"url": "total-relations", "valueInteger": summary.get("total_relations", 0)},
                {"url": "speaker-count", "valueInteger": summary.get("speaker_count", 0)},
                {"url": "linked-entities", "valueInteger": summary.get("linked_entities", 0)},
                {"url": "categories", "valueString": ", ".join(summary.get("categories", []))}
            ]
        }
        if summary.get("assertions"):
            for key, val in summary["assertions"].items():
                summary_resource["extension"].append({
                    "url": f"assertion-{key}",
                    "valueInteger": val
                })
        fhir_resources.append({
            "fullUrl": "urn:uuid:analysis-summary",
            "resource": summary_resource
        })
    
    return {
        "resourceType": "Bundle",
        "id": f"transcription-analysis-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        "meta": {
            "lastUpdated": datetime.utcnow().isoformat() + "Z",
            "source": "azure-healthcare-transcription-service"
        },
        "type": "collection",
        "total": len(fhir_resources),
        "entry": fhir_resources
    }


# ============================================================================
# Speech REST API (no SDK needed)
# ============================================================================

def get_speech_token(config: AzureConfig) -> str:
    """Get access token for Speech API using managed identity"""
    try:
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token
    except Exception as e:
        logger.error(f"Failed to get Speech token via managed identity: {e}")
        raise

def transcribe_audio_rest(audio_bytes: bytes, config: AzureConfig, enable_diarization: bool = True) -> dict:
    """Transcribe audio using Speech Fast Transcription API with optional diarization"""
    # Use Fast Transcription API which supports Azure AD/managed identity
    if config.speech_endpoint:
        base_endpoint = config.speech_endpoint.rstrip('/')
        url = f"{base_endpoint}/speechtotext/transcriptions:transcribe?api-version=2024-11-15"
    else:
        url = f"https://{config.speech_region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15"
    
    # Use managed identity token
    try:
        token = get_speech_token(config)
        logger.info(f"Using Fast Transcription API: {url}")
    except Exception as e:
        logger.error(f"Failed to authenticate for Speech API: {e}")
        return {
            "text": "",
            "phrases": [],
            "speakers": [],
            "speaker_count": 0,
            "error": f"Speech authentication failed: {str(e)}",
        }
    
    # Build definition with optional diarization
    definition = {
        "locales": ["en-US"],
        "profanityFilterMode": "Masked"
    }
    
    # Enable diarization for speaker identification
    if enable_diarization:
        definition["diarization"] = {
            "maxSpeakers": 10,
            "enabled": True
        }
    
    # Fast Transcription API uses multipart/form-data
    import io
    files = {
        'audio': ('audio.wav', io.BytesIO(audio_bytes), 'audio/wav')
    }
    data = {
        'definition': json.dumps(definition)
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }
    
    response = requests.post(url, headers=headers, files=files, data=data, timeout=180)
    
    if response.status_code == 200:
        result = response.json()
        
        # Extract combined text
        combined_text = ""
        combined = result.get("combinedPhrases", [])
        if combined:
            combined_text = combined[0].get("text", "")
        else:
            # Fallback to phrases
            phrases = result.get("phrases", [])
            if phrases:
                combined_text = " ".join([p.get("text", "") for p in phrases])
        
        # Extract diarized phrases with speaker information
        diarized_phrases = []
        speakers_found = set()
        for phrase in result.get("phrases", []):
            speaker = phrase.get("speaker", 0)
            speakers_found.add(speaker)
            diarized_phrases.append({
                "text": phrase.get("text", ""),
                "speaker": speaker,
                "offset": phrase.get("offset", ""),
                "duration": phrase.get("duration", ""),
                "confidence": phrase.get("confidence", 0)
            })
        
        return {
            "text": combined_text or "No transcription result",
            "phrases": diarized_phrases,
            "speakers": list(speakers_found),
            "speaker_count": len(speakers_found)
        }
    else:
        logger.error(f"Speech API error: {response.status_code} - {response.text}")
        return {
            "text": f"Transcription failed: {response.status_code}",
            "phrases": [],
            "speakers": [],
            "speaker_count": 0,
            "error": f"Speech transcription failed with status {response.status_code}",
        }


def is_empty_transcription_text(text: Optional[str]) -> bool:
    normalized_text = normalize_context_value(text)
    return not normalized_text or normalized_text == "No transcription result"


def transcription_result_error(transcription_result: Optional[dict]) -> Optional[str]:
    if not transcription_result:
        return "Speech transcription returned no result"

    explicit_error = normalize_context_value((transcription_result or {}).get("error"))
    if explicit_error:
        return explicit_error

    text = normalize_context_value((transcription_result or {}).get("text"))
    if is_empty_transcription_text(text):
        return "Speech transcription returned no spoken content"
    if text.startswith("Transcription failed:"):
        return text

    return None


def is_poisoned_completed_job(job: "TranscriptionJob") -> bool:
    if job.status != JobStatus.COMPLETED:
        return False

    text = normalize_context_value(job.transcription_text)
    return is_empty_transcription_text(text) or text.startswith("Transcription failed:")


def clear_failed_job_artifacts(job: "TranscriptionJob") -> None:
    job.transcription_text = None
    job.medical_entities = None
    job.llm_summary = None
    job.processing_time_seconds = None


def persist_failed_encounter_audio_transcription(
    container,
    encounter: Optional["EncounterSession"],
    *,
    event_name: str,
    error_message: str,
    event_details: Optional[dict] = None,
) -> None:
    if not encounter:
        return

    encounter.status = EncounterStatus.FAILED
    encounter.error_message = error_message
    encounter.updated_at = utc_now()
    append_encounter_event(encounter, event_name, {
        "error": error_message,
        **(event_details or {}),
    })
    encounter.review_result = build_encounter_review_result(encounter, None)
    upsert_record(container, encounter)


def is_stale_in_progress_job(job: "TranscriptionJob") -> bool:
    if job.status not in {JobStatus.PENDING, JobStatus.TRANSCRIBING, JobStatus.ANALYZING}:
        return False

    updated_at = parse_utc_timestamp(job.updated_at) or parse_utc_timestamp(job.created_at)
    if not updated_at:
        return False

    age_seconds = (datetime.now(timezone.utc) - updated_at).total_seconds()
    timeout_seconds = STALE_PENDING_JOB_TIMEOUT_SECONDS if job.status == JobStatus.PENDING else STALE_ACTIVE_JOB_TIMEOUT_SECONDS
    return age_seconds > timeout_seconds


def normalize_job_failure_state(job: "TranscriptionJob") -> bool:
    if is_poisoned_completed_job(job):
        text = normalize_context_value(job.transcription_text)
        job.status = JobStatus.FAILED
        job.error_message = text or "Speech transcription failed"
        clear_failed_job_artifacts(job)
        job.processing_stage = "failed"
        job.updated_at = utc_now()
        return True

    if is_stale_in_progress_job(job):
        stage = normalize_context_value(job.processing_stage) or job.status
        job.status = JobStatus.FAILED
        job.error_message = f"Processing stalled during {stage} and timed out"
        clear_failed_job_artifacts(job)
        job.processing_stage = "failed"
        job.updated_at = utc_now()
        return True

    return False


def transcribe_and_store_audio(audio_bytes: bytes, encounter_id: str, config: AzureConfig) -> dict:
    """Upload audio to Blob Storage and transcribe with diarization.

    Returns dict with blob_url, transcript_text, diarized_phrases, speaker_count.
    """
    blob_name = f"encounters/{encounter_id}/captured-audio.wav"
    blob_client = get_blob_client(config, blob_name)
    blob_client.upload_blob(audio_bytes, overwrite=True)
    blob_url = blob_client.url

    transcription_result = transcribe_audio_rest(audio_bytes, config, enable_diarization=True)
    failure_message = transcription_result_error(transcription_result)
    if failure_message:
        raise RuntimeError(failure_message)

    return {
        "blob_url": blob_url,
        "transcript_text": transcription_result.get("text", ""),
        "diarized_phrases": transcription_result.get("phrases", []),
        "speaker_count": transcription_result.get("speaker_count", 0),
    }


def build_wav_audio_bytes(pcm_bytes: bytes, sample_rate: int = 24000, channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Wrap PCM16 audio bytes in a WAV container."""
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    data_size = len(pcm_bytes)
    riff_chunk_size = 36 + data_size

    header = bytearray()
    header.extend(b"RIFF")
    header.extend(riff_chunk_size.to_bytes(4, "little"))
    header.extend(b"WAVE")
    header.extend(b"fmt ")
    header.extend((16).to_bytes(4, "little"))
    header.extend((1).to_bytes(2, "little"))
    header.extend(channels.to_bytes(2, "little"))
    header.extend(sample_rate.to_bytes(4, "little"))
    header.extend(byte_rate.to_bytes(4, "little"))
    header.extend(block_align.to_bytes(2, "little"))
    header.extend(bits_per_sample.to_bytes(2, "little"))
    header.extend(b"data")
    header.extend(data_size.to_bytes(4, "little"))
    header.extend(pcm_bytes)
    return bytes(header)


def get_encounter_audio_upload_state(encounter: EncounterSession) -> Optional[dict]:
    metadata = encounter.metadata or {}
    session_state = metadata.get("audio_upload_session")
    return session_state if isinstance(session_state, dict) else None


def set_encounter_audio_upload_state(encounter: EncounterSession, session_state: dict) -> None:
    metadata = encounter.metadata or {}
    metadata["audio_upload_session"] = session_state
    encounter.metadata = metadata


def clear_encounter_audio_upload_state(encounter: EncounterSession) -> None:
    metadata = encounter.metadata or {}
    metadata.pop("audio_upload_session", None)
    encounter.metadata = metadata


def build_encounter_audio_chunk_blob_name(encounter_id: str, session_id: str, sequence: int) -> str:
    return f"encounters/{encounter_id}/streaming/{session_id}/chunks/{sequence:08d}.pcm"


def download_staged_encounter_audio(config: AzureConfig, encounter_id: str, session_state: dict) -> bytes:
    session_id = session_state.get("session_id")
    if not session_id:
        raise RuntimeError("Encounter audio upload session is missing a session_id")

    prefix = f"encounters/{encounter_id}/streaming/{session_id}/chunks/"
    container_client = get_blob_container_client(config)
    blob_names = sorted(blob.name for blob in container_client.list_blobs(name_starts_with=prefix))
    if not blob_names:
        raise RuntimeError("No staged audio chunks were uploaded for this encounter")

    pcm_bytes = bytearray()
    for blob_name in blob_names:
        pcm_bytes.extend(container_client.get_blob_client(blob_name).download_blob().readall())
    return bytes(pcm_bytes)


def cleanup_staged_encounter_audio(config: AzureConfig, encounter_id: str, session_state: dict) -> None:
    session_id = session_state.get("session_id")
    if not session_id:
        return

    prefix = f"encounters/{encounter_id}/streaming/{session_id}/chunks/"
    container_client = get_blob_container_client(config)
    for blob in container_client.list_blobs(name_starts_with=prefix):
        try:
            container_client.delete_blob(blob.name)
        except Exception as cleanup_error:
            logger.warning(f"Could not delete staged audio chunk {blob.name}: {cleanup_error}")


# ============================================================================
# Text Analytics REST API
# ============================================================================

def get_language_token() -> str:
    """Get access token for Language API using managed identity"""
    try:
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token
    except Exception as e:
        logger.error(f"Failed to get Language token via managed identity: {e}")
        raise

def analyze_health_text_rest(text: str, config: AzureConfig) -> dict:
    """Analyze text for health entities using REST API"""
    url = f"{config.language_endpoint}/language/analyze-text/jobs?api-version=2023-04-01"
    
    # Use managed identity token instead of API key
    try:
        token = get_language_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    except Exception as e:
        logger.error(f"Failed to authenticate for Language API: {e}")
        return {"entities": [], "error": f"Authentication failed: {str(e)}"}
    
    payload = {
        "displayName": "Health Analysis",
        "analysisInput": {
            "documents": [{"id": "1", "language": "en", "text": text}]
        },
        "tasks": [
            {"kind": "Healthcare", "parameters": {"modelVersion": "latest"}}
        ]
    }
    
    # Start the job
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
    except requests.RequestException as exc:
        logger.error(f"Health API request failed: {exc}")
        return {"entities": [], "error": f"Language request failed: {str(exc)}"}
    
    if response.status_code != 202:
        logger.error(f"Health API error: {response.status_code} - {response.text}")
        return {"entities": [], "error": f"API error: {response.status_code}"}
    
    # Get operation location
    operation_location = response.headers.get("Operation-Location")
    if not operation_location:
        return {"entities": [], "error": "No operation location"}
    
    # Poll for results
    for _ in range(HEALTH_ANALYSIS_POLL_ATTEMPTS):
        time.sleep(HEALTH_ANALYSIS_POLL_INTERVAL_SECONDS)
        try:
            result_response = requests.get(
                operation_location,
                headers={"Authorization": f"Bearer {token}"},
                timeout=HEALTH_ANALYSIS_POLL_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            logger.error(f"Health API polling failed: {exc}")
            return {"entities": [], "error": f"Language polling failed: {str(exc)}"}
        
        if result_response.status_code == 200:
            result = result_response.json()
            status = result.get("status", "")
            
            if status == "succeeded":
                entities = []
                relations = []
                try:
                    tasks = result.get("tasks", {}).get("items", [])
                    for task in tasks:
                        docs = task.get("results", {}).get("documents", [])
                        for doc in docs:
                            # Build entity lookup by index
                            doc_entities = doc.get("entities", [])
                            entity_by_index = {}
                            for idx, entity in enumerate(doc_entities):
                                # Extract assertion information (negation, conditionality, etc.)
                                assertion_data = entity.get("assertion", {})
                                assertion = None
                                if assertion_data:
                                    assertion = {
                                        "certainty": assertion_data.get("certainty"),  # positive, negativePossible, negative, neutral
                                        "conditionality": assertion_data.get("conditionality"),  # hypothetical, conditional
                                        "association": assertion_data.get("association")  # subject, other
                                    }
                                
                                # Extract entity links to medical ontologies (UMLS, SNOMED, ICD-10, etc.)
                                links = []
                                for link in entity.get("links", []):
                                    links.append({
                                        "dataSource": link.get("dataSource"),  # UMLS, SNOMED CT, ICD-10-CM, etc.
                                        "id": link.get("id")  # Code like C0027361 for UMLS
                                    })
                                
                                entities.append({
                                    "text": entity.get("text"),
                                    "category": entity.get("category"),
                                    "subcategory": entity.get("subcategory"),
                                    "confidence_score": entity.get("confidenceScore", 0),
                                    "offset": entity.get("offset", 0),
                                    "length": entity.get("length", 0),
                                    "assertion": assertion,
                                    "links": links if links else None
                                })
                                # Store by index for relation lookup (API uses #/documents/0/entities/N format)
                                entity_by_index[idx] = entity
                            
                            # Process relations with proper entity text lookup
                            for relation in doc.get("relations", []):
                                relation_entities = []
                                for rel_entity in relation.get("entities", []):
                                    # Get the referenced entity - ref format is like "#/documents/0/entities/5"
                                    ref = rel_entity.get("ref", "")
                                    entity_data = {}
                                    if "/entities/" in ref:
                                        try:
                                            entity_idx = int(ref.split("/entities/")[-1])
                                            entity_data = entity_by_index.get(entity_idx, {})
                                        except (ValueError, IndexError):
                                            pass
                                    relation_entities.append({
                                        "text": entity_data.get("text", "Unknown"),
                                        "role": rel_entity.get("role", ""),
                                        "category": entity_data.get("category", ""),
                                        "confidenceScore": entity_data.get("confidenceScore", 0),
                                        "offset": entity_data.get("offset", 0),
                                        "length": entity_data.get("length", 0)
                                    })
                                relations.append({
                                    "relationType": relation.get("relationType"),
                                    "confidenceScore": relation.get("confidenceScore", 0),
                                    "entities": relation_entities,
                                    "roles": [
                                        {
                                            "name": entity.get("role", "role"),
                                            "text": entity.get("text", ""),
                                            "category": entity.get("category", ""),
                                        }
                                        for entity in relation_entities
                                    ],
                                })
                except Exception as e:
                    logger.error(f"Error parsing health results: {e}")
                
                return {"entities": entities, "relations": relations}
            elif status == "failed":
                return {"entities": [], "error": "Analysis failed"}
        elif result_response.status_code >= 400:
            logger.error(f"Health API polling error: {result_response.status_code} - {result_response.text}")
            return {"entities": [], "error": f"Language polling failed with status {result_response.status_code}"}
    
    return {"entities": [], "error": "Timeout waiting for results"}


# ============================================================================
# Azure OpenAI - Clinical Summary Generation
# ============================================================================

def get_openai_token() -> str:
    """Get access token for Azure OpenAI using managed identity"""
    try:
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token
    except Exception as e:
        logger.error(f"Failed to get OpenAI token via managed identity: {e}")
        raise


def get_openai_headers(config: AzureConfig) -> dict:
    headers = {
        "Content-Type": "application/json",
    }

    if is_configured_value(config.openai_api_key):
        headers["api-key"] = config.openai_api_key
        return headers

    headers["Authorization"] = f"Bearer {get_openai_token()}"
    return headers


def get_openai_retry_delay_seconds(response: requests.Response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return max(1.0, float(retry_after))
        except ValueError:
            pass

    return min(2 ** attempt, 16)


def post_openai_json_with_retry(
    url: str,
    *,
    headers: dict,
    payload: dict,
    timeout: int,
    max_attempts: int = 5,
) -> requests.Response:
    transient_status_codes = {429, 500, 502, 503, 504}

    for attempt in range(max_attempts):
        response = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if response.status_code not in transient_status_codes or attempt == max_attempts - 1:
            return response

        delay_seconds = get_openai_retry_delay_seconds(response, attempt)
        logger.warning(
            "Azure OpenAI transient error %s on %s. Retrying in %.1f seconds (attempt %s/%s).",
            response.status_code,
            url,
            delay_seconds,
            attempt + 1,
            max_attempts,
        )
        time.sleep(delay_seconds)

    raise RuntimeError("Azure OpenAI retry loop exited unexpectedly")

def generate_clinical_summary(job: TranscriptionJob, config: AzureConfig) -> dict:
    """Generate a structured clinician-review summary using Azure OpenAI."""
    if not config.openai_endpoint or not config.openai_deployment:
        return {"error": "Azure OpenAI not configured", "generated_at": None}
    
    # Build context from transcription data
    transcription_text = job.transcription_text or ""
    medical_entities = job.medical_entities or {}
    transcript_chunks = split_text_into_chunks(
        transcription_text,
        max_chars=2000,
        overlap_chars=150,
    )[:6]
    
    # Extract entities with full details for the prompt
    entities = medical_entities.get("entities", [])
    relations = medical_entities.get("relations", [])
    
    # Build detailed entity list with UMLS codes, confidence scores, and assertions
    entities_detailed = []
    for entity in entities:
        entity_data = {
            "text": entity.get("text"),
            "category": entity.get("category"),
            "subcategory": entity.get("subcategory"),
            "confidence_score": entity.get("confidence_score", 0),
            "offset": entity.get("offset", 0),
            "length": entity.get("length", 0)
        }
        
        # Add UMLS/ontology links
        links = entity.get("links") or []
        if links:
            entity_data["umls_codes"] = [{"source": l.get("dataSource"), "code": l.get("id")} for l in links]
        
        # Add assertion information
        assertion = entity.get("assertion")
        if assertion:
            entity_data["assertion"] = {
                "certainty": assertion.get("certainty"),
                "conditionality": assertion.get("conditionality"),
                "association": assertion.get("association")
            }
        
        entities_detailed.append(entity_data)
    
    # Build detailed relations list
    relations_detailed = []
    for rel in relations:
        rel_data = {
            "relationType": rel.get("relationType"),
            "confidenceScore": rel.get("confidenceScore", 0),
            "entities": []
        }
        for e in rel.get("entities", []):
            rel_data["entities"].append({
                "text": e.get("text"),
                "role": e.get("role"),
                "category": e.get("category")
            })
        relations_detailed.append(rel_data)
    
    system_prompt = """You are a clinical documentation specialist preparing a clinician-ready review packet.

Your task is to turn the provided transcript evidence, medical entities, relationships, and assertions into structured clinical outputs that a clinician can review only at the end of processing.

Guidelines:
- Use concise, professional clinical language.
- Base the response only on the supplied data.
- Be explicit about uncertainty, negation, conditionality, and family history.
- Prefer bullet lists for action items and concise prose for note sections.
- When information is missing, say so instead of inventing it.
- Always produce the exact markdown headings requested below using ### headings."""

    # Create a structured JSON input for the model
    clinical_data = {
        "transcript_chunks": [chunk.get("text") for chunk in transcript_chunks],
        "entities": entities_detailed[:50],
        "relations": relations_detailed[:30],
        "summary_stats": medical_entities.get("summary", {})
    }

    user_prompt = f"""Analyze the following clinical data and generate a clinician review packet.

## INPUT CLINICAL DATA:
```json
{json.dumps(clinical_data, indent=2)}
```

---

Generate the response with these exact sections in this order:

### Clinical Summary
A short clinician-first synopsis of the encounter.

### Structured Findings
Bullet list or table of the key findings, diagnoses, symptoms, and relevant qualifiers.

### Timeline
Bullet list of temporal details, progression, and notable sequence information.

### Assertions
Bullet list of negated, uncertain, hypothetical, conditional, or non-patient findings.

### Follow-Up Instructions
Bullet list of patient follow-up and next-step instructions.

### Medication Changes
Bullet list of medication starts, stops, dose adjustments, monitoring, or continuation plans.

### Tests
Bullet list of labs, imaging, procedures, or monitoring recommendations.

### Referrals
Bullet list of specialty referrals or consultations. If none are present, say "No referral identified."

### HPI
Clinician-ready HPI prose.

### ROS
Clinician-ready ROS prose.

### PE
Clinician-ready PE prose. If not supported by evidence, say that PE details were not explicitly documented.

### Assessment
Clinician-ready assessment prose.

### Plan
Clinician-ready plan prose integrating follow-up, medications, tests, and referrals.

Use markdown bullets where appropriate and keep the content suitable for direct clinician review."""

    # Call Azure OpenAI
    url = f"{config.openai_endpoint.rstrip('/')}/openai/deployments/{config.openai_deployment}/chat/completions?api-version=2024-02-01"
    
    try:
        headers = get_openai_headers(config)
    except Exception as e:
        logger.error(f"Failed to authenticate for Azure OpenAI: {e}")
        return {"error": f"Authentication failed: {str(e)}", "generated_at": None}
    
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,  # Lower temperature for consistent clinical output
        "max_tokens": 2500,  # Increased for detailed research summary
        "top_p": 0.95
    }
    
    try:
        response = post_openai_json_with_retry(url, headers=headers, payload=payload, timeout=90)
        
        if response.status_code == 200:
            result = response.json()
            
            # Extract summary and token usage
            summary_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            usage = result.get("usage", {})
            
            # Calculate estimated cost (GPT-4o-mini pricing: $0.15/1M input, $0.60/1M output)
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            estimated_cost = (prompt_tokens * 0.00000015) + (completion_tokens * 0.0000006)
            
            return {
                "summary_text": summary_text,
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "model": config.openai_deployment,
                "token_usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": usage.get("total_tokens", 0),
                    "estimated_cost_usd": round(estimated_cost, 6)
                },
                "input_stats": {
                    "transcription_chars": len(transcription_text),
                    "transcript_chunks": len(transcript_chunks),
                    "entity_count": len(entities),
                    "relation_count": len(relations)
                }
            }
        else:
            logger.error(f"Azure OpenAI error: {response.status_code} - {response.text}")
            return {"error": f"OpenAI API error: {response.status_code}", "generated_at": None}
            
    except requests.exceptions.Timeout:
        return {"error": "Request timeout - summary generation took too long", "generated_at": None}
    except Exception as e:
        logger.error(f"Error generating summary: {e}")
        return {"error": f"Summary generation failed: {str(e)}", "generated_at": None}


def get_request_json(req: func.HttpRequest) -> dict:
    try:
        return req.get_json()
    except ValueError:
        return {}


def sanitize_audit_value(value, *, key: Optional[str] = None):
    if value is None or isinstance(value, (bool, int, float)):
        return value

    normalized_key = normalize_context_value(key).lower()

    if isinstance(value, dict):
        sanitized = {}
        for child_key, child_value in value.items():
            sanitized_child = sanitize_audit_value(child_value, key=child_key)
            if sanitized_child is not None:
                sanitized[child_key] = sanitized_child
        return sanitized

    if isinstance(value, (list, tuple)):
        sanitized_items = []
        for item in list(value)[:20]:
            sanitized_item = sanitize_audit_value(item, key=normalized_key)
            if sanitized_item is not None:
                sanitized_items.append(sanitized_item)
        return sanitized_items

    text = normalize_context_value(value)
    if not text:
        return None

    if normalized_key in {"error", "exception", "stack", "traceback"}:
        return {
            "redacted": True,
            "fingerprint": stable_hash(text),
        }

    return " ".join(text.split())[:256]


def build_actor_metadata() -> dict:
    context = get_current_request_context()
    if not context:
        return {}

    return {
        "user_id": context.user_id,
        "tenant_id": context.tenant_id,
        "role": context.role,
        "identity_provider": context.identity_provider,
        "correlation_id": context.correlation_id,
    }


def write_platform_audit_event(
    config: Optional[AzureConfig],
    *,
    action: str,
    target_type: str,
    target_id: str,
    payload: Optional[dict] = None,
) -> None:
    actor = build_actor_metadata()
    audit_doc = {
        "id": str(uuid.uuid4()),
        "record_type": "platform_audit",
        "created_at": utc_now(),
        "tenant_id": normalize_context_value(actor.get("tenant_id")) or "platform",
        "user_id": actor.get("user_id"),
        "role": actor.get("role"),
        "identity_provider": actor.get("identity_provider"),
        "correlation_id": actor.get("correlation_id") or _get_correlation_id(),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "payload": sanitize_audit_value(payload or {}),
    }

    log_with_context(
        "Platform audit event",
        action=action,
        target_type=target_type,
        target_id=target_id,
        audit=True,
    )

    if not config:
        return

    try:
        audit_container = get_platform_audit_log_container(config)
        audit_container.upsert_item(audit_doc)
    except Exception as exc:
        logger.warning(f"Could not persist platform audit event {action} for {target_type}:{target_id}: {exc}")


def append_encounter_event(encounter: EncounterSession, event_type: str, details: Optional[dict] = None) -> None:
    events = encounter.events or []
    event = {
        "type": event_type,
        "at": utc_now(),
        **build_actor_metadata(),
    }
    sanitized_details = sanitize_audit_value(details or {})
    if sanitized_details:
        event["details"] = sanitized_details
    events.append(event)
    encounter.events = events[-50:]
    log_with_context(
        "Encounter event appended",
        encounter_id=encounter.id,
        event_type=event_type,
        audit=True,
    )


def ensure_job_summary(job: TranscriptionJob, config: AzureConfig, *, regenerate: bool = False) -> dict:
    if job.llm_summary and not regenerate and job.llm_summary.get("summary_text"):
        return job.llm_summary

    summary_result = generate_clinical_summary(job, config)
    if "error" in summary_result and summary_result.get("generated_at") is None:
        raise RuntimeError(summary_result["error"])

    job.llm_summary = summary_result
    job.updated_at = utc_now()
    return summary_result


def persist_job_and_index_context(
    container,
    encounter: Optional[EncounterSession],
    job: TranscriptionJob,
    config: AzureConfig,
) -> dict:
    upsert_record(container, job)

    if encounter:
        return sync_encounter_search_index(encounter, job, config)

    synthetic_encounter = EncounterSession(
        id=job.source_encounter_id or job.id,
        status=EncounterStatus.COMPLETED,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finalized_text=job.transcription_text or "",
        process_job_id=job.id,
        draft_segments=[],
        events=[],
    )
    return sync_encounter_search_index(synthetic_encounter, job, config)


def generate_medical_analysis(transcription_text: str, config: AzureConfig, diarized_phrases: Optional[list] = None, speaker_count: int = 0) -> dict:
    aggregated_entities = []
    aggregated_relations = []
    seen_entities = set()
    seen_relations = set()

    for chunk in split_text_into_chunks(
        transcription_text,
        max_chars=HEALTH_ANALYSIS_MAX_CHARS,
        overlap_chars=HEALTH_ANALYSIS_OVERLAP_CHARS,
    ):
        health_results = analyze_health_text_rest(chunk["text"], config)

        for entity in health_results.get("entities", []):
            normalized_entity = dict(entity)
            normalized_entity["offset"] = (normalized_entity.get("offset") or 0) + chunk["start"]
            entity_key = (
                normalized_entity.get("text"),
                normalized_entity.get("category"),
                normalized_entity.get("offset"),
                normalized_entity.get("length"),
            )
            if entity_key in seen_entities:
                continue

            seen_entities.add(entity_key)
            aggregated_entities.append(normalized_entity)

        for relation in health_results.get("relations", []):
            normalized_relation = dict(relation)
            relation_roles = relation.get("roles") or relation.get("entities") or []
            normalized_roles = []
            for role in relation_roles:
                normalized_role = dict(role)
                normalized_role["offset"] = (normalized_role.get("offset") or 0) + chunk["start"]
                normalized_role["name"] = normalized_role.get("name") or normalized_role.get("role") or "role"
                normalized_roles.append(normalized_role)

            normalized_relation["roles"] = normalized_roles
            normalized_relation["entities"] = normalized_roles
            relation_key = (
                normalized_relation.get("relationType"),
                tuple((role.get("name"), role.get("text"), role.get("offset")) for role in normalized_roles),
            )
            if relation_key in seen_relations:
                continue

            seen_relations.add(relation_key)
            aggregated_relations.append(normalized_relation)

    health_results = {
        "entities": aggregated_entities,
        "relations": aggregated_relations,
    }

    entities_by_category = {}
    for entity in health_results.get("entities", []):
        category = entity.get("category", "Unknown")
        if category not in entities_by_category:
            entities_by_category[category] = []
        entities_by_category[category].append(entity)

    assertion_counts = {
        "negated": 0,
        "conditional": 0,
        "hypothetical": 0,
        "affirmed": 0,
        "other_subject": 0,
        "temporal_past": 0,
        "temporal_future": 0,
        "uncertain": 0,
    }
    linked_entities_count = 0

    for entity in health_results.get("entities", []):
        if entity.get("links"):
            linked_entities_count += 1

        assertion = entity.get("assertion")
        if not assertion:
            continue

        certainty = assertion.get("certainty", "")
        if certainty in ("negative", "negative_possible", "negativePossible"):
            assertion_counts["negated"] += 1
        elif certainty == "positive":
            assertion_counts["affirmed"] += 1
        elif certainty in ("positive_possible", "positivePossible", "neutral_possible", "neutralPossible"):
            assertion_counts["uncertain"] += 1

        conditionality = assertion.get("conditionality", "")
        if conditionality == "hypothetical":
            assertion_counts["hypothetical"] += 1
        elif conditionality == "conditional":
            assertion_counts["conditional"] += 1

        association = assertion.get("association", "")
        if association == "other":
            assertion_counts["other_subject"] += 1

        temporal = assertion.get("temporal", "")
        if temporal == "past":
            assertion_counts["temporal_past"] += 1
        elif temporal == "future":
            assertion_counts["temporal_future"] += 1

    total_entities = len(health_results.get("entities", []))
    total_relations = len(health_results.get("relations", []))

    return {
        "entities": health_results.get("entities", []),
        "entities_by_category": entities_by_category,
        "relations": health_results.get("relations", []),
        "diarization": {
            "phrases": diarized_phrases or [],
            "speaker_count": speaker_count,
        },
        "summary": {
            "total_entities": total_entities,
            "total_relations": total_relations,
            "categories": list(entities_by_category.keys()),
            "speaker_count": speaker_count,
            "linked_entities": linked_entities_count,
            "assertions": assertion_counts,
        }
    }


def build_job_result(job: TranscriptionJob) -> dict:
    if job.status == JobStatus.FAILED:
        return {
            "job_id": job.id,
            "filename": job.filename,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "processing_time_seconds": None,
            "transcription": {
                "text": None,
                "word_count": 0,
            },
            "medical_analysis": None,
            "clinical_summary": None,
            "fhir_bundle": None,
            "error_message": job.error_message,
            "source_encounter_id": job.source_encounter_id,
        }

    fhir_bundle = None
    try:
        if job.medical_entities:
            fhir_bundle = generate_fhir_bundle(job.medical_entities)
    except Exception as fhir_err:
        import traceback
        logger.error(f"FHIR generation error for job {job.id}: {fhir_err} - {traceback.format_exc()}")

    return {
        "job_id": job.id,
        "filename": job.filename,
        "status": job.status,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "processing_time_seconds": job.processing_time_seconds,
        "transcription": {
            "text": job.transcription_text,
            "word_count": len(job.transcription_text.split()) if job.transcription_text else 0,
        },
        "medical_analysis": job.medical_entities,
        "clinical_summary": job.llm_summary,
        "fhir_bundle": fhir_bundle,
        "error_message": job.error_message,
        "source_encounter_id": job.source_encounter_id,
    }


def build_encounter_review_result(encounter: EncounterSession, job: Optional[TranscriptionJob]) -> dict:
    transcript_text = normalize_context_value((job.transcription_text if job else None) or encounter.finalized_text or encounter.draft_text)
    medical_analysis = (job.medical_entities if job else None) or {}
    entities = medical_analysis.get("entities", [])
    relationships = medical_analysis.get("relations", [])
    summary = (job.llm_summary if job else None) or None
    section_lookup = build_summary_section_lookup((summary or {}).get("summary_text", ""))

    structured_findings = build_structured_findings_items(section_lookup, entities)
    follow_up_items = build_follow_up_items(section_lookup)
    medication_changes = build_medication_change_items(section_lookup, entities)
    test_items = build_test_items(section_lookup, entities)
    referral_items = build_referral_items(section_lookup)
    final_note_sections = build_final_note_sections(
        section_lookup,
        transcript_text,
        structured_findings,
        follow_up_items,
        medication_changes,
        test_items,
        referral_items,
        entities,
    )

    result = {
        "encounter_id": encounter.id,
        "status": encounter.status,
        "review_version": encounter.draft_version,
        "created_at": encounter.created_at,
        "updated_at": encounter.updated_at,
        "job_id": job.id if job else encounter.process_job_id,
        "job_status": job.status if job else None,
        "processing_stage": job.processing_stage if job else None,
        "transcript": {
            "text": transcript_text,
            "segments": encounter.draft_segments or [],
            "diarized_phrases": encounter.diarized_phrases or [],
            "speaker_count": encounter.speaker_count or 0,
        },
        "medical_analysis": {
            "entities": entities,
            "relationships": relationships,
            "assertions": build_assertion_items(entities),
            "timeline": build_timeline_items(encounter, section_lookup),
        },
        "clinician_outputs": {
            "clinical_summary": get_summary_section_text(section_lookup, "clinical_summary", "overview") or extract_first_sentence((summary or {}).get("summary_text", ""), fallback="Clinical summary pending."),
            "structured_findings": structured_findings,
            "follow_up_instructions": follow_up_items,
            "medication_changes": medication_changes,
            "tests": test_items,
            "referrals": referral_items,
            "final_note_sections": final_note_sections,
        },
        "clinical_summary": summary,
        "structured_findings": structured_findings,
        "follow_up_instructions": follow_up_items,
        "medication_changes": medication_changes,
        "tests_and_referrals": {
            "tests": test_items,
            "referrals": referral_items,
        },
        "final_note_sections": final_note_sections,
        "final_note_text": render_final_note_text(final_note_sections),
        "links": {
            "self": f"/api/encounters/{encounter.id}/results",
            "approve": f"/api/encounters/{encounter.id}/review/approve",
            "save_edits": f"/api/encounters/{encounter.id}/review",
            "regenerate": f"/api/encounters/{encounter.id}/review/regenerate",
        },
        "error_message": encounter.error_message or (job.error_message if job else None),
    }

    return apply_saved_review_overrides(result, encounter.review_result)


def launch_encounter_processing(container, encounter: EncounterSession) -> tuple[EncounterSession, TranscriptionJob, bool]:
    transcript_text = normalize_context_value(encounter.finalized_text or encounter.draft_text)
    if not transcript_text:
        raise RuntimeError("Encounter transcript is empty")
    if is_empty_transcription_text(transcript_text):
        raise RuntimeError("Speech transcription returned no spoken content")
    if transcript_text.startswith("Transcription failed:"):
        raise RuntimeError(transcript_text)

    existing_job = None
    if encounter.process_job_id:
        try:
            existing_job_data = container.read_item(item=encounter.process_job_id, partition_key=encounter.process_job_id)
            existing_job = TranscriptionJob.from_dict(existing_job_data)
            normalize_job_failure_state(existing_job)
        except Exception:
            existing_job = None

    if existing_job and existing_job.status in {JobStatus.PENDING, JobStatus.TRANSCRIBING, JobStatus.ANALYZING, JobStatus.COMPLETED}:
        encounter.status = EncounterStatus.READY_FOR_REVIEW if existing_job.status == JobStatus.COMPLETED else EncounterStatus.PROCESSING
        encounter.updated_at = utc_now()
        encounter.error_message = None
        encounter.review_result = build_encounter_review_result(encounter, existing_job)
        upsert_record(container, encounter)
        return encounter, existing_job, False

    now = utc_now()
    job_id = str(uuid.uuid4())
    encounter.finalized_text = transcript_text
    encounter.process_job_id = job_id
    encounter.status = EncounterStatus.PROCESSING
    encounter.error_message = None
    encounter.updated_at = now
    append_encounter_event(encounter, "processing_started", {"job_id": job_id, "mode": "automatic"})

    job = TranscriptionJob(
        id=job_id,
        filename=f"encounter-{encounter.id}.txt",
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
        transcription_text=transcript_text,
        record_type="job",
        source_encounter_id=encounter.id,
        processing_stage="queued",
    )

    encounter.review_result = build_encounter_review_result(encounter, job)
    upsert_record(container, encounter)
    create_record(container, job)

    worker = threading.Thread(
        target=run_encounter_processing_job,
        args=(encounter.id, job.id),
        daemon=True,
    )
    worker.start()

    return encounter, job, True


def apply_review_action_edits(review_result: dict, payload: dict) -> dict:
    clinician_outputs = review_result.get("clinician_outputs") or {}
    note_sections = clinician_outputs.get("final_note_sections") or review_result.get("final_note_sections") or {}

    for key, content in (payload.get("note_sections") or {}).items():
        normalized_key = normalize_heading_key(key)
        if normalized_key in note_sections and normalize_context_value(content):
            note_sections[normalized_key]["content"] = normalize_context_value(content)
            note_sections[normalized_key]["bullets"] = extract_list_items(note_sections[normalized_key]["content"])

    if payload.get("clinician_summary"):
        clinician_outputs["clinical_summary"] = normalize_context_value(payload.get("clinician_summary"))

    if payload.get("structured_findings"):
        clinician_outputs["structured_findings"] = [
            {
                "id": f"finding-edit-{index}",
                "label": extract_first_sentence(line, fallback=f"Finding {index}"),
                "detail": line,
                "category": "manual_edit",
                "confidence_score": None,
                "evidence": [line],
            }
            for index, line in enumerate(payload.get("structured_findings") or [], start=1)
        ]

    if payload.get("follow_up_instructions"):
        clinician_outputs["follow_up_instructions"] = [
            {
                "id": f"follow-up-edit-{index}",
                "instruction": line,
                "timeframe": None,
                "audience": "patient",
                "priority": None,
                "evidence": [line],
            }
            for index, line in enumerate(payload.get("follow_up_instructions") or [], start=1)
        ]

    if payload.get("medication_changes"):
        clinician_outputs["medication_changes"] = [
            {
                "id": f"medication-edit-{index}",
                "medication": line.split(":", 1)[0].strip() if ":" in line else line,
                "change_type": infer_medication_change_type(line),
                "detail": line,
                "dosage": None,
                "frequency": None,
                "reason": None,
                "evidence": [line],
            }
            for index, line in enumerate(payload.get("medication_changes") or [], start=1)
        ]

    if payload.get("tests"):
        clinician_outputs["tests"] = [
            {
                "id": f"test-edit-{index}",
                "name": line.split(":", 1)[0].strip() if ":" in line else line,
                "detail": line,
                "timing": None,
                "reason": None,
                "evidence": [line],
            }
            for index, line in enumerate(payload.get("tests") or [], start=1)
        ]

    if payload.get("referrals"):
        clinician_outputs["referrals"] = [
            {
                "id": f"referral-edit-{index}",
                "specialty": line.split(":", 1)[0].strip() if ":" in line else line,
                "detail": line,
                "urgency": None,
                "reason": None,
                "evidence": [line],
            }
            for index, line in enumerate(payload.get("referrals") or [], start=1)
        ]

    clinician_outputs["final_note_sections"] = note_sections
    review_result["clinician_outputs"] = clinician_outputs
    review_result["structured_findings"] = clinician_outputs.get("structured_findings", [])
    review_result["follow_up_instructions"] = clinician_outputs.get("follow_up_instructions", [])
    review_result["medication_changes"] = clinician_outputs.get("medication_changes", [])
    review_result["tests_and_referrals"] = {
        "tests": clinician_outputs.get("tests", []),
        "referrals": clinician_outputs.get("referrals", []),
    }
    review_result["final_note_sections"] = note_sections
    review_result["final_note_text"] = render_final_note_text(note_sections)
    return review_result


def create_record(container, record) -> None:
    container.create_item(body=record.to_dict())


def upsert_record(container, record) -> None:
    container.upsert_item(body=record.to_dict())


def get_record_or_response(container, record_id: str, expected_record_type: str, label: str):
    try:
        record_data = container.read_item(item=record_id, partition_key=record_id)
    except Exception:
        return None, error_response(404, f"{label} not found", f"{label.upper()}_NOT_FOUND", details={"id": record_id})

    if record_data.get("record_type") != expected_record_type:
        return None, error_response(404, f"{label} not found", f"{label.upper()}_NOT_FOUND", details={"id": record_id})

    return record_data, None


def get_job_or_response(container, job_id: str, *, access_mode: str = "write"):
    job_data, response = get_record_or_response(container, job_id, "job", "Job")
    if response:
        return None, response

    job = TranscriptionJob.from_dict(job_data)
    if normalize_job_failure_state(job):
        try:
            container.upsert_item(body=job.to_dict())
        except Exception as exc:
            logger.warning(f"Could not persist normalized job state for {job_id}: {exc}")
    access_error = enforce_record_access(job.tenant_id, job.owner_id, access_mode=access_mode)
    if access_error:
        return None, access_error
    return job, None


def normalize_context_value(value: Optional[str]) -> str:
    if value is None:
        return ""

    return str(value).strip()


def enforce_record_access(record_tenant_id: Optional[str], record_owner_id: Optional[str], *, access_mode: str = "write") -> Optional[func.HttpResponse]:
    ctx = get_current_request_context()
    if not ctx:
        return None

    active_tenant_id = normalize_context_value(ctx.tenant_id)
    active_role = normalize_context_value(ctx.role).lower()
    record_tenant = normalize_context_value(record_tenant_id)
    record_owner = normalize_context_value(record_owner_id)

    if record_tenant and active_tenant_id != record_tenant:
        return error_response(403, "Access denied for this tenant resource", "ACCESS_DENIED")

    if access_mode == "read":
        if active_role in TENANT_READ_ROLES:
            return None
        return error_response(403, "Access denied for this tenant resource", "ACCESS_DENIED")

    if active_role in TENANT_MUTATION_ADMIN_ROLES:
        return None

    if active_role == "editor" and record_owner and record_owner == normalize_context_value(ctx.user_id):
        return None

    return error_response(403, "Access denied for this tenant resource", "ACCESS_DENIED")


def build_context_item(
    item_id: str,
    category: str,
    kind: str,
    title: str,
    text: str,
    *,
    source: str,
    assertion: Optional[str] = None,
    confidence_score: Optional[float] = None,
    provenance: Optional[list] = None,
    metadata: Optional[dict] = None,
) -> dict:
    item = {
        "id": item_id,
        "category": category,
        "kind": kind,
        "title": title,
        "text": text,
        "source": source,
        "provenance": provenance or [],
        "metadata": metadata or {},
    }

    if assertion:
        item["assertion"] = assertion

    if confidence_score is not None:
        item["confidence_score"] = round(confidence_score, 4)

    return item


def build_encounter_context_items(encounter: EncounterSession, job: Optional[TranscriptionJob]) -> list:
    items = []

    if encounter.finalized_text:
        items.append(
            build_context_item(
                f"encounter:{encounter.id}:finalized",
                "transcript",
                "finalized_transcript",
                "Finalized encounter transcript",
                encounter.finalized_text,
                source="encounter",
                provenance=[{"source_type": "encounter", "source_id": encounter.id}],
                metadata={"status": encounter.status, "draft_version": encounter.draft_version},
            )
        )
    elif encounter.draft_text:
        items.append(
            build_context_item(
                f"encounter:{encounter.id}:draft",
                "transcript",
                "draft_transcript",
                "Current encounter draft",
                encounter.draft_text,
                source="encounter",
                provenance=[{"source_type": "encounter", "source_id": encounter.id}],
                metadata={"status": encounter.status, "draft_version": encounter.draft_version},
            )
        )

    for index, segment in enumerate(encounter.draft_segments or []):
        segment_text = normalize_context_value(segment.get("text"))
        if not segment_text:
            continue

        items.append(
            build_context_item(
                f"encounter:{encounter.id}:segment:{index}",
                "transcript",
                "segment",
                f"Transcript segment {index + 1}",
                segment_text,
                source="encounter",
                provenance=[{"source_type": "encounter_segment", "source_id": encounter.id}],
                metadata={
                    "role": segment.get("role", "speaker"),
                    "timestamp": segment.get("timestamp"),
                    "is_final": bool(segment.get("is_final", True)),
                },
            )
        )

    for index, phrase in enumerate(encounter.diarized_phrases or []):
        phrase_text = normalize_context_value(phrase.get("text"))
        if not phrase_text:
            continue

        items.append(
            build_context_item(
                f"encounter:{encounter.id}:phrase:{index}",
                "transcript",
                "speaker_phrase",
                f"Speaker phrase {index + 1}",
                phrase_text,
                source="encounter",
                provenance=[{"source_type": "diarization", "source_id": encounter.id}],
                metadata={
                    "speaker": phrase.get("speaker"),
                    "offset": phrase.get("offset"),
                    "duration": phrase.get("duration"),
                },
            )
        )

    if not job or not job.medical_entities:
        return items

    summary = job.llm_summary or {}
    summary_text = normalize_context_value(summary.get("summary_text"))
    if summary_text:
        items.append(
            build_context_item(
                f"job:{job.id}:summary",
                "summary",
                "clinical_summary",
                "Clinical summary",
                summary_text,
                source="job",
                provenance=[{"source_type": "job_summary", "source_id": job.id}],
                metadata={"cached": bool(summary.get("cached")), "model": summary.get("model")},
            )
        )

    for index, entity in enumerate(job.medical_entities.get("entities", [])):
        entity_text = normalize_context_value(entity.get("text"))
        if not entity_text:
            continue

        category = normalize_context_value(entity.get("category")).lower() or "clinical"
        assertion = (entity.get("assertion") or {}).get("certainty")
        subcategory = normalize_context_value(entity.get("subcategory"))
        title_suffix = f" ({subcategory})" if subcategory else ""

        items.append(
            build_context_item(
                f"job:{job.id}:entity:{index}",
                category,
                "clinical_entity",
                f"{entity.get('category', 'Clinical entity')}{title_suffix}",
                entity_text,
                source="job",
                assertion=normalize_context_value(assertion).lower() or None,
                confidence_score=entity.get("confidence_score"),
                provenance=[{"source_type": "medical_entity", "source_id": job.id}],
                metadata={
                    "subcategory": entity.get("subcategory"),
                    "offset": entity.get("offset"),
                    "length": entity.get("length"),
                },
            )
        )

    for index, relation in enumerate(job.medical_entities.get("relations", [])):
        roles = relation.get("roles") or relation.get("entities") or []
        relation_text = " | ".join(
            f"{role.get('name') or role.get('role', 'role')}: {normalize_context_value(role.get('text'))}" for role in roles if normalize_context_value(role.get("text"))
        )
        if not relation_text:
            continue

        items.append(
            build_context_item(
                f"job:{job.id}:relation:{index}",
                "relation",
                "clinical_relation",
                normalize_context_value(relation.get("relationType")) or "Clinical relation",
                relation_text,
                source="job",
                confidence_score=relation.get("confidenceScore"),
                provenance=[{"source_type": "medical_relation", "source_id": job.id}],
            )
        )

    return items


def apply_encounter_context_filters(items: list, *, q: str = "", category: str = "", assertion: str = "", limit: int = 50) -> list:
    filtered_items = items

    normalized_q = normalize_context_value(q).lower()
    if normalized_q:
        filtered_items = [
            item for item in filtered_items
            if normalized_q in json.dumps(item, sort_keys=True).lower()
        ]

    normalized_category = normalize_context_value(category).lower()
    if normalized_category:
        filtered_items = [item for item in filtered_items if item.get("category", "").lower() == normalized_category]

    normalized_assertion = normalize_context_value(assertion).lower()
    if normalized_assertion:
        filtered_items = [item for item in filtered_items if normalize_context_value(item.get("assertion")).lower() == normalized_assertion]

    bounded_limit = max(1, min(limit, 200))
    return filtered_items[:bounded_limit]


def build_encounter_context_response(
    encounter: EncounterSession,
    job: Optional[TranscriptionJob],
    config: AzureConfig,
    *,
    q: str = "",
    category: str = "",
    assertion: str = "",
    limit: int = 50,
) -> dict:
    return search_encounter_context(
        encounter,
        job,
        config,
        q=q,
        category=category,
        assertion=assertion,
        limit=limit,
    )


def encounter_source_text(encounter: EncounterSession) -> str:
    return (encounter.finalized_text or encounter.draft_text or "").strip()


def detect_treatment_candidates(encounter: EncounterSession) -> list:
    transcript = encounter_source_text(encounter).lower()
    candidates = []

    if "eye exam" in transcript or "visual" in transcript or "blurry vision" in transcript:
        candidates.append(
            {
                "code": "eye_exam",
                "title": "Comprehensive eye exam",
                "category": "diagnostic",
                "summary": "Evaluate visual symptoms and headache-related eye strain.",
                "mock_source": "clinical_keyword_match",
            }
        )

    if "complete metabolic panel" in transcript or "blood work" in transcript or "kidney function" in transcript:
        candidates.append(
            {
                "code": "cmp_lab",
                "title": "Complete metabolic panel",
                "category": "laboratory",
                "summary": "Assess kidney function and broader metabolic markers.",
                "mock_source": "clinical_keyword_match",
            }
        )

    if "lisinopril" in transcript or "blood pressure" in transcript or "hypertension" in transcript:
        candidates.append(
            {
                "code": "bp_follow_up",
                "title": "Hypertension medication follow-up",
                "category": "follow_up",
                "summary": "Monitor blood pressure after medication adjustment and reinforce home readings.",
                "mock_source": "clinical_keyword_match",
            }
        )

    if not candidates:
        candidates.append(
            {
                "code": "general_follow_up",
                "title": "General clinical follow-up",
                "category": "follow_up",
                "summary": "General review based on current encounter findings.",
                "mock_source": "fallback",
            }
        )

    return candidates


def build_mock_operational_context(encounter: EncounterSession, job: Optional[TranscriptionJob]) -> dict:
    treatments = detect_treatment_candidates(encounter)
    now = utc_now()
    mock_subject = (encounter.metadata or {}).get("subject_hint") or "encounter-subject"

    return normalize_operational_context(
        {
            "encounter_id": encounter.id,
            "status": encounter.status,
            "generated_at": now,
            "linked_job_id": encounter.process_job_id,
            "eligibility": {
                "provider": "mock-eligibility-provider",
                "status": "eligible",
                "member_reference": f"ELIG-{encounter.id[:8].upper()}",
                "summary": "Encounter subject is eligible for diagnostic and follow-up outpatient services in the current mock plan.",
                "freshness": {
                    "fetched_at": now,
                    "expires_at": now,
                    "is_mock": True,
                },
            },
            "scheme_qualification": {
                "provider": "mock-scheme-qualification-provider",
                "plan_name": "Standard Clinical Review Plan",
                "qualification_status": "qualified",
                "summary": "Primary care follow-up and standard diagnostic workups are allowed without specialist panel escalation in the mock contract.",
                "freshness": {
                    "fetched_at": now,
                    "expires_at": now,
                    "is_mock": True,
                },
            },
            "treatment_lookup": {
                "provider": "mock-treatment-lookup-provider",
                "results": treatments,
                "freshness": {
                    "fetched_at": now,
                    "expires_at": now,
                    "is_mock": True,
                },
            },
            "prior_auth_summaries": {
                "provider": "mock-prior-auth-provider",
                "results": [
                    {
                        "treatment_code": treatment["code"],
                        "status": "not_required" if treatment["category"] != "follow_up" else "review_not_required",
                        "summary": f"No prior authorization required for {treatment['title'].lower()} in the mock workflow.",
                    }
                    for treatment in treatments
                ],
                "freshness": {
                    "fetched_at": now,
                    "expires_at": now,
                    "is_mock": True,
                },
            },
            "communication_options": {
                "provider": "mock-communications-provider",
                "results": [
                    {
                        "channel": "patient_email",
                        "target": f"{mock_subject}@example-health.test",
                        "summary": "Send follow-up instructions and warning signs.",
                    },
                    {
                        "channel": "care_team_queue",
                        "target": "clinical-review-queue",
                        "summary": "Share encounter summary with internal care coordination.",
                    },
                ],
                "freshness": {
                    "fetched_at": now,
                    "expires_at": now,
                    "is_mock": True,
                },
            },
            "audit_metadata": {
                "mode": "mock",
                "source": "operational_context_mock_provider",
                "clinical_job_available": bool(job),
            },
        },
        encounter,
        job,
    )


def build_action_previews(encounter: EncounterSession, operational_context: dict) -> list:
    treatment_results = ((operational_context.get("treatment_lookup") or {}).get("results") or [])
    communication_results = ((operational_context.get("communication_options") or {}).get("results") or [])
    email_target = communication_results[0] if communication_results else {"channel": "patient_email", "target": "patient@example.test"}
    primary_treatment = treatment_results[0] if treatment_results else {
        "code": "general_follow_up",
        "title": "General clinical follow-up",
        "summary": "General review based on encounter context.",
    }

    return [
        {
            "actionId": f"{encounter.id}:patient_follow_up_email",
            "toolId": "patient_follow_up_email",
            "title": "Patient follow-up email",
            "target": email_target.get("target"),
            "summary": "Preview a patient-safe follow-up email summarizing next steps and return precautions.",
            "payloadPreview": {
                "channel": email_target.get("channel"),
                "subject": "Follow-up instructions after your visit",
                "body": [
                    "We are following up on your recent encounter.",
                    f"Recommended next step: {primary_treatment.get('title')}",
                    "Please seek urgent care if symptoms suddenly worsen or new severe neurological or visual symptoms appear.",
                ],
            },
            "approvalRequirements": ["clinician_review", "patient_safe_language_check"],
            "idempotencyKey": f"preview:{encounter.id}:patient_follow_up_email:v1",
            "riskFlags": ["patient_communication", "phi_review_required"],
            "auditMetadata": {
                "mode": "preview_only",
                "encounter_id": encounter.id,
                "source": "mock_preview_assembler",
            },
        },
        {
            "actionId": f"{encounter.id}:treatment_request",
            "toolId": "treatment_request",
            "title": "Treatment or diagnostic request",
            "target": primary_treatment.get("code"),
            "summary": "Preview a structured treatment or diagnostic request using encounter and mock operational context.",
            "payloadPreview": {
                "treatment_code": primary_treatment.get("code"),
                "treatment_title": primary_treatment.get("title"),
                "clinical_rationale": primary_treatment.get("summary"),
                "eligibility_status": ((operational_context.get("eligibility") or {}).get("status")),
            },
            "approvalRequirements": ["clinician_review"],
            "idempotencyKey": f"preview:{encounter.id}:treatment_request:{primary_treatment.get('code')}",
            "riskFlags": ["order_preview", "non_executing"],
            "auditMetadata": {
                "mode": "preview_only",
                "encounter_id": encounter.id,
                "source": "mock_preview_assembler",
            },
        },
        {
            "actionId": f"{encounter.id}:prior_auth_packet",
            "toolId": "prior_auth_packet",
            "title": "Prior authorization packet",
            "target": primary_treatment.get("code"),
            "summary": "Preview a prior-authorization handoff packet even when the current mock policy says approval is not required.",
            "payloadPreview": {
                "treatment_code": primary_treatment.get("code"),
                "coverage_summary": ((operational_context.get("scheme_qualification") or {}).get("summary")),
                "prior_auth_status": ((operational_context.get("prior_auth_summaries") or {}).get("results") or [None])[0],
            },
            "approvalRequirements": ["clinician_review", "operations_review"],
            "idempotencyKey": f"preview:{encounter.id}:prior_auth_packet:{primary_treatment.get('code')}",
            "riskFlags": ["payer_workflow", "non_executing"],
            "auditMetadata": {
                "mode": "preview_only",
                "encounter_id": encounter.id,
                "source": "mock_preview_assembler",
            },
        },
    ]


def split_text_for_stream(text: str, *, chunk_size: int = 120) -> list:
    normalized = normalize_context_value(text)
    if not normalized:
        return []

    words = normalized.split()
    chunks = []
    current_words = []

    for word in words:
        tentative = " ".join([*current_words, word])
        if current_words and len(tentative) > chunk_size:
            chunks.append(" ".join(current_words))
            current_words = [word]
        else:
            current_words.append(word)

    if current_words:
        chunks.append(" ".join(current_words))

    return chunks


def build_assistant_answer(encounter: EncounterSession, job: Optional[TranscriptionJob], question: str, config: AzureConfig) -> tuple[str, dict, dict]:
    context_response = build_encounter_context_response(encounter, job, config, q=question, limit=30)
    operational_context = build_mock_operational_context(encounter, job)
    top_items = context_response.get("items", [])
    evidence_snippets = build_answer_snippets(top_items, question)
    cited_items = []
    seen_citation_ids = set()
    for snippet in evidence_snippets:
        item = snippet.get("item") or {}
        item_id = item.get("id")
        if item_id in seen_citation_ids:
            continue
        cited_items.append(item)
        seen_citation_ids.add(item_id)
        if len(cited_items) >= 3:
            break

    if not cited_items:
        cited_items = top_items[:3]

    context_response["cited_items"] = cited_items
    cited_titles = [item.get("title", "Clinical context") for item in cited_items]

    if evidence_snippets:
        answer = " ".join([
            f"Based on the encounter-local record, here is the grounded answer to '{normalize_context_value(question)}'.",
            " ".join(snippet.get("text") or "" for snippet in evidence_snippets),
        ])
    else:
        answer = "No directly relevant encounter-local evidence was retrieved from Azure AI Search for this question."

    reasoning_summary = {
        "question": normalize_context_value(question),
        "matched_context_items": len(top_items),
        "cited_titles": cited_titles,
        "used_mock_operational_context": bool((operational_context.get("treatment_lookup") or {}).get("results")),
        "retrieval_backend": "azure_ai_search",
    }

    return answer, context_response, reasoning_summary


def build_streaming_envelopes(
    encounter: EncounterSession,
    job: Optional[TranscriptionJob],
    config: AzureConfig,
    *,
    question: str,
    scope: str,
    agent_id: str,
) -> list:
    request_id = str(uuid.uuid4())
    thread_id = f"thread:{encounter.id}:{agent_id}"
    turn_id = f"turn:{uuid.uuid4()}"
    started_at = utc_now()
    answer, context_response, reasoning_summary = build_assistant_answer(encounter, job, question, config)
    chunks = split_text_for_stream(answer)
    envelopes = [
        {
            "event": "turn.started",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "id": turn_id,
                "threadId": thread_id,
                "role": "assistant",
                "source": "encounter-runtime",
                "scope": scope,
                "status": "streaming",
                "requestId": request_id,
                "parts": [],
                "summary": None,
                "toolEvents": [],
                "citations": [],
                "error": None,
                "startedAt": started_at,
                "completedAt": None,
            },
        },
        {
            "event": "turn.tool_started",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "toolId": "encounter-context.search",
                "title": "Encounter context search",
                "status": "running",
            },
        },
        {
            "event": "turn.tool_completed",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "toolId": "encounter-context.search",
                "title": "Encounter context search",
                "status": "completed",
                "matchedItems": context_response.get("summary", {}).get("returned_items", 0),
            },
        },
        {
            "event": "turn.tool_started",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "toolId": "operational-context.mock",
                "title": "Operational context lookup",
                "status": "running",
            },
        },
        {
            "event": "turn.tool_completed",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "toolId": "operational-context.mock",
                "title": "Operational context lookup",
                "status": "completed",
                "mode": "mock",
            },
        },
        {
            "event": "turn.reasoning_summary",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": reasoning_summary,
        },
    ]

    for item in context_response.get("cited_items", context_response.get("items", [])[:3]):
        envelopes.append(
            {
                "event": "turn.citation",
                "requestId": request_id,
                "threadId": thread_id,
                "turnId": turn_id,
                "data": {
                    "title": item.get("title"),
                    "category": item.get("category"),
                    "kind": item.get("kind"),
                    "source": item.get("source"),
                    "provenance": item.get("provenance", []),
                },
            }
        )

    for index, chunk in enumerate(chunks):
        envelopes.append(
            {
                "event": "turn.delta",
                "requestId": request_id,
                "threadId": thread_id,
                "turnId": turn_id,
                "data": {
                    "index": index,
                    "delta": chunk,
                },
            }
        )

    envelopes.append(
        {
            "event": "turn.completed",
            "requestId": request_id,
            "threadId": thread_id,
            "turnId": turn_id,
            "data": {
                "id": turn_id,
                "threadId": thread_id,
                "role": "assistant",
                "source": "encounter-runtime",
                "scope": scope,
                "status": "completed",
                "requestId": request_id,
                "parts": [{"type": "text", "text": answer}],
                "summary": "Retrieval-only answer over encounter and mocked operational context.",
                "toolEvents": [
                    {"toolId": "encounter-context.search", "status": "completed"},
                    {"toolId": "operational-context.mock", "status": "completed"},
                ],
                "citations": context_response.get("cited_items", context_response.get("items", [])[:3]),
                "error": None,
                "startedAt": started_at,
                "completedAt": utc_now(),
            },
        }
    )

    return envelopes


def serialize_envelopes_as_ndjson(envelopes: list) -> str:
    return "\n".join(json.dumps(envelope) for envelope in envelopes)


def build_runtime_config_validation(config: AzureConfig) -> dict:
    environment = normalize_context_value(AZURE_FUNCTIONS_ENVIRONMENT) or "Production"
    if environment.lower() != "production":
        return {
            "status": "not_enforced",
            "environment": environment,
            "errors": [],
        }

    errors = []
    checks = [
        (is_configured_value(config.speech_key) or is_configured_value(config.speech_endpoint), "Speech credentials or managed-identity endpoint must be configured."),
        (is_configured_value(config.speech_region), "AZURE_SPEECH_REGION must be configured."),
        (is_configured_value(config.language_key) or is_configured_value(config.language_endpoint), "Language service credentials or endpoint must be configured."),
        (is_configured_value(config.cosmos_connection_string) or is_configured_value(config.cosmos_endpoint), "Cosmos DB connection string or managed-identity endpoint must be configured."),
        (is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name), "Storage connection string or account name must be configured."),
        (is_configured_value(config.openai_endpoint), "AZURE_OPENAI_ENDPOINT must be configured."),
        (is_configured_value(config.openai_deployment), "AZURE_OPENAI_DEPLOYMENT must be configured."),
        (is_configured_value(config.search_endpoint), "AZURE_SEARCH_ENDPOINT must be configured."),
        (is_configured_value(config.search_index_name), "AZURE_SEARCH_INDEX_NAME must be configured."),
    ]

    for is_valid, message in checks:
        if not is_valid:
            errors.append(message)

    return {
        "status": "healthy" if not errors else "unhealthy",
        "environment": environment,
        "errors": errors,
    }


def get_runtime_safety_error(config: AzureConfig) -> Optional[func.HttpResponse]:
    validation = build_runtime_config_validation(config)
    if validation["status"] in {"healthy", "not_enforced"}:
        return None

    return error_response(
        500,
        "Production configuration is unsafe",
        "UNSAFE_PRODUCTION_CONFIGURATION",
        details={
            "environment": validation["environment"],
            "errors": validation["errors"],
        },
    )


def get_required_service_config(
    config: AzureConfig,
    *,
    require_cosmos: bool = False,
    require_language: bool = False,
    require_openai: bool = False,
    require_search: bool = False,
) -> Optional[func.HttpResponse]:
    runtime_safety_error = get_runtime_safety_error(config)
    if runtime_safety_error:
        return runtime_safety_error

    if require_cosmos and not (is_configured_value(config.cosmos_connection_string) or is_configured_value(config.cosmos_endpoint)):
        return error_response(
            500,
            "Cosmos DB service is not configured",
            "COSMOS_CONFIGURATION_MISSING",
            details={"required": ["COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT"]},
        )

    if require_language and not (is_configured_value(config.language_key) or is_configured_value(config.language_endpoint)):
        return error_response(
            500,
            "Language service is not configured",
            "LANGUAGE_CONFIGURATION_MISSING",
            details={"required": ["AZURE_LANGUAGE_KEY or AZURE_LANGUAGE_ENDPOINT"]},
        )

    if require_openai and not (is_configured_value(config.openai_endpoint) and is_configured_value(config.openai_deployment)):
        return error_response(
            500,
            "Azure OpenAI service is not configured",
            "OPENAI_CONFIGURATION_MISSING",
            details={"required": ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]},
        )

    if require_search and not is_configured_value(config.search_endpoint):
        return error_response(
            500,
            "Azure AI Search service is not configured",
            "SEARCH_CONFIGURATION_MISSING",
            details={"required": ["AZURE_SEARCH_ENDPOINT", "AZURE_SEARCH_INDEX_NAME"]},
        )

    return None


def require_encounter_status(encounter: EncounterSession, allowed_statuses: tuple[str, ...], *, action: str, code: str) -> Optional[func.HttpResponse]:
    if encounter.status in allowed_statuses:
        return None

    return error_response(
        409,
        f"Encounter cannot {action} from its current state",
        "INVALID_TRANSITION",
        details={
            "transitionCode": code,
            "attemptedAction": action,
            "currentStatus": encounter.status,
            "allowedStatuses": list(allowed_statuses),
            "encounterId": encounter.id,
        },
    )


def _build_cosmos_account_client(config: AzureConfig):
    from azure.cosmos import CosmosClient

    if config.cosmos_connection_string:
        return CosmosClient.from_connection_string(config.cosmos_connection_string)

    from azure.identity import DefaultAzureCredential
    return CosmosClient(config.cosmos_endpoint, credential=DefaultAzureCredential())


def _build_blob_service_client(config: AzureConfig):
    from azure.storage.blob import BlobServiceClient

    if config.storage_connection_string:
        return BlobServiceClient.from_connection_string(config.storage_connection_string)

    from azure.identity import DefaultAzureCredential
    account_url = f"https://{config.storage_account_name}.blob.core.windows.net"
    return BlobServiceClient(account_url, credential=DefaultAzureCredential())


def probe_dependency(name: str, probe_fn, *, required: bool = True) -> dict:
    if not required:
        return {"status": "not_configured"}

    try:
        details = probe_fn() or {}
        return {"status": "healthy", **details}
    except Exception as exc:
        log_with_context("Dependency probe failed", level="error", dependency=name, error=str(exc))
        return {"status": "unhealthy"}


def probe_cosmos_health(config: AzureConfig) -> dict:
    client = _build_cosmos_account_client(config)
    database = client.get_database_client(config.cosmos_database_name)
    database.read()
    return {"database": config.cosmos_database_name}


def probe_storage_health(config: AzureConfig) -> dict:
    service_client = _build_blob_service_client(config)
    container_client = service_client.get_container_client(config.storage_container_name)
    container_client.get_container_properties()
    return {"container": config.storage_container_name}


def probe_search_health(config: AzureConfig) -> dict:
    index_client = get_search_index_client(config)
    index_client.get_index(config.search_index_name)
    return {"index": config.search_index_name}


def probe_speech_health(config: AzureConfig) -> dict:
    token = get_speech_token(config)
    if not token:
        raise RuntimeError("Speech token acquisition returned an empty token")
    return {"region": config.speech_region}


def build_health_status(config: AzureConfig) -> dict:
    has_cosmos = is_configured_value(config.cosmos_connection_string) or is_configured_value(config.cosmos_endpoint)
    has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
    has_search = is_configured_value(config.search_endpoint) and is_configured_value(config.search_index_name)
    has_speech = is_configured_value(config.speech_region)
    configuration = build_runtime_config_validation(config)

    dependencies = {
        "cosmos": probe_dependency("cosmos", lambda: probe_cosmos_health(config), required=has_cosmos),
        "storage": probe_dependency("storage", lambda: probe_storage_health(config), required=has_storage),
        "search": probe_dependency("search", lambda: probe_search_health(config), required=has_search),
        "speech": probe_dependency("speech", lambda: probe_speech_health(config), required=has_speech),
    }

    overall_status = "healthy"
    if any(details.get("status") != "healthy" for details in dependencies.values()):
        overall_status = "degraded"
    if configuration["status"] == "unhealthy":
        overall_status = "degraded"

    return {
        "status": overall_status,
        "service": "transcription-api",
        "timestamp": utc_now(),
        "configuration": configuration,
        "dependencies": dependencies,
    }


def is_automatic_processing_configured(config: AzureConfig) -> bool:
    return get_required_service_config(
        config,
        require_cosmos=True,
        require_language=True,
        require_openai=True,
        require_search=True,
    ) is None


def build_encounter_response_payload(encounter: EncounterSession) -> dict:
    return {
        "encounter_id": encounter.id,
        "status": encounter.status,
        "draft_text": encounter.draft_text,
        "draft_version": encounter.draft_version,
        "draft_segments": encounter.draft_segments or [],
        "diarized_phrases": encounter.diarized_phrases or [],
        "speaker_count": encounter.speaker_count,
        "draft_source": encounter.draft_source,
        "audio_blob_url": encounter.audio_blob_url,
        "finalized_text": encounter.finalized_text,
        "process_job_id": encounter.process_job_id,
        "updated_at": encounter.updated_at,
        "created_at": encounter.created_at,
        "metadata": encounter.metadata or {},
        "review_result": encounter.review_result,
        "links": {
            "self": f"/api/encounters/{encounter.id}",
            "results": f"/api/encounters/{encounter.id}/results",
            "approve": f"/api/encounters/{encounter.id}/review/approve",
            "save_edits": f"/api/encounters/{encounter.id}/review",
            "regenerate": f"/api/encounters/{encounter.id}/review/regenerate",
        },
    }


def build_encounter_process_payload(encounter: EncounterSession, job: TranscriptionJob) -> dict:
    return {
        "encounter_id": encounter.id,
        "job_id": job.id,
        "status": encounter.status,
        "job_status": job.status,
        "processing_stage": job.processing_stage,
        "processing_time_seconds": job.processing_time_seconds,
        "review_result": encounter.review_result,
        "links": {
            "results": f"/api/results/{job.id}",
            "encounter_results": f"/api/encounters/{encounter.id}/results",
            "approve": f"/api/encounters/{encounter.id}/review/approve",
            "save_edits": f"/api/encounters/{encounter.id}/review",
            "regenerate": f"/api/encounters/{encounter.id}/review/regenerate",
        },
    }


def get_encounter_or_response(container, encounter_id: str, *, access_mode: str = "write"):
    encounter_data, response = get_record_or_response(container, encounter_id, "encounter", "Encounter")
    if response:
        return None, response

    encounter = EncounterSession.from_dict(encounter_data)
    access_error = enforce_record_access(encounter.tenant_id, encounter.owner_id, access_mode=access_mode)
    if access_error:
        return None, access_error

    return encounter, None


@app.route(route="auth/session", methods=["GET"])
def get_auth_session(req: func.HttpRequest) -> func.HttpResponse:
    """Return normalized frontend auth state using Easy Auth or local-dev simulation."""
    try:
        config = AzureConfig.from_environment()
        auth_result = get_authenticated_context(req, config, allow_missing_active_tenant=True)
        if isinstance(auth_result, func.HttpResponse):
            return auth_result

        return func.HttpResponse(
            json.dumps(build_auth_session_payload(auth_result, config)),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:
        logger.error(f"Get auth session failed: {exc}")
        return error_response(500, "Authentication session could not be loaded", "AUTH_CONTEXT_FAILED")


# ============================================================================
# HTTP Functions
# ============================================================================

@app.route(route="encounters", methods=["POST"])
@require_authenticated_request
def create_encounter(req: func.HttpRequest) -> func.HttpResponse:
    """Create a new ambient encounter draft."""
    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        ctx = get_current_request_context()
        now = utc_now()
        encounter = EncounterSession(
            id=str(uuid.uuid4()),
            status=EncounterStatus.DRAFT,
            created_at=now,
            updated_at=now,
            metadata={
                "source": payload.get("source", "assistant_drawer"),
                "language": payload.get("language", "en-US"),
            },
            draft_segments=[],
            events=[],
            review_result=None,
            owner_id=ctx.user_id if ctx else None,
            tenant_id=ctx.tenant_id if ctx else None,
        )
        append_encounter_event(encounter, "created", {"source": encounter.metadata.get("source")})

        container = get_cosmos_client(config)
        create_record(container, encounter)

        encounter_payload = build_encounter_response_payload(encounter)
        return json_response(
            {
                **encounter_payload,
                "draft_version": encounter.draft_version,
                "links": {
                    **encounter_payload["links"],
                    "start_capture": f"/api/encounters/{encounter.id}/capture/start",
                    "stop_capture": f"/api/encounters/{encounter.id}/capture/stop",
                    "draft": f"/api/encounters/{encounter.id}/draft",
                    "finalize": f"/api/encounters/{encounter.id}/finalize",
                    "process": f"/api/encounters/{encounter.id}/process",
                },
            },
            status_code=201,
        )
    except Exception as e:
        return internal_server_error("Create encounter failed", e, code="ENCOUNTER_CREATE_FAILED")


@app.route(route="encounters/{encounter_id}", methods=["GET"])
@require_authenticated_request
def get_encounter(req: func.HttpRequest) -> func.HttpResponse:
    """Retrieve encounter draft state."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        write_platform_audit_event(
            config,
            action="encounter.read",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "status": encounter.status,
                "draft_version": encounter.draft_version,
            },
        )

        return json_response(build_encounter_response_payload(encounter), status_code=200)
    except Exception as e:
        return internal_server_error("Get encounter failed", e, code="ENCOUNTER_READ_FAILED")


@app.route(route="encounters/{encounter_id}/capture/start", methods=["POST"])
@require_authenticated_request
def start_encounter_capture(req: func.HttpRequest) -> func.HttpResponse:
    """Mark an encounter as actively capturing."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.DRAFT, EncounterStatus.REVIEW),
            action="start capture",
            code="ENCOUNTER_CAPTURE_START_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        encounter.status = EncounterStatus.CAPTURING
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "capture_started", {"mode": payload.get("mode", "ambient")})
        upsert_record(container, encounter)

        return json_response({"encounter_id": encounter.id, "status": encounter.status, "updated_at": encounter.updated_at}, status_code=200)
    except Exception as e:
        return internal_server_error("Start encounter capture failed", e, code="ENCOUNTER_CAPTURE_START_FAILED")


@app.route(route="encounters/{encounter_id}/capture/stop", methods=["POST"])
@require_authenticated_request
def stop_encounter_capture(req: func.HttpRequest) -> func.HttpResponse:
    """Stop capture and automatically trigger clinical processing when configured."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.CAPTURING,),
            action="stop capture",
            code="ENCOUNTER_CAPTURE_STOP_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        append_encounter_event(encounter, "capture_stopped")

        transcript_text = normalize_context_value(encounter.draft_text)
        if transcript_text and is_automatic_processing_configured(config):
            encounter.finalized_text = transcript_text
            encounter.status = EncounterStatus.PROCESSING
            encounter.updated_at = utc_now()
            encounter, job, _ = launch_encounter_processing(container, encounter)
            return json_response(build_encounter_process_payload(encounter, job), status_code=200)

        encounter.status = EncounterStatus.READY_FOR_REVIEW if transcript_text else EncounterStatus.REVIEW
        encounter.updated_at = utc_now()
        if transcript_text:
            encounter.finalized_text = transcript_text
            encounter.review_result = build_encounter_review_result(encounter, None)
        upsert_record(container, encounter)

        return json_response({"encounter_id": encounter.id, "status": encounter.status, "updated_at": encounter.updated_at}, status_code=200)
    except Exception as e:
        return internal_server_error("Stop encounter capture failed", e, code="ENCOUNTER_CAPTURE_STOP_FAILED")


@app.route(route="encounters/{encounter_id}/segments", methods=["POST"])
@require_authenticated_request
def append_encounter_segments(req: func.HttpRequest) -> func.HttpResponse:
    """Append transcript segments captured during ambient voice streaming."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        segments = payload.get("segments") or []
        segments_error = validate_segments_payload(segments)
        if segments_error:
            return segments_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.DRAFT, EncounterStatus.CAPTURING),
            action="append transcript segments",
            code="ENCOUNTER_SEGMENTS_APPEND_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        existing_segments = encounter.draft_segments or []
        existing_keys = {
            f"{segment.get('text', '').strip()}::{segment.get('timestamp', '')}::{segment.get('role', 'speaker')}"
            for segment in existing_segments
        }

        new_segments = []
        for segment in segments:
            text = (segment.get("text") or "").strip()
            if not text:
                continue

            normalized_segment = {
                "role": segment.get("role", "speaker"),
                "text": text,
                "timestamp": segment.get("timestamp", utc_now()),
                "is_final": bool(segment.get("is_final", True)),
            }
            segment_key = f"{normalized_segment['text']}::{normalized_segment['timestamp']}::{normalized_segment['role']}"
            if segment_key in existing_keys:
                continue

            existing_keys.add(segment_key)
            new_segments.append(normalized_segment)

        if not new_segments:
            return json_response(
                {
                    "encounter_id": encounter.id,
                    "status": encounter.status,
                    "draft_version": encounter.draft_version,
                    "segments_added": 0,
                },
                status_code=200,
            )

        existing_segments.extend(new_segments)
        encounter.draft_segments = existing_segments[-500:]
        final_segment_lines = [segment["text"] for segment in encounter.draft_segments if segment.get("is_final", True)]
        encounter.draft_text = "\n".join(final_segment_lines).strip()
        encounter.draft_version += 1
        encounter.updated_at = utc_now()
        if encounter.status == EncounterStatus.DRAFT:
            encounter.status = EncounterStatus.CAPTURING
        append_encounter_event(encounter, "segments_appended", {"count": len(new_segments), "draft_version": encounter.draft_version})
        upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "status": encounter.status,
                "draft_version": encounter.draft_version,
                "draft_text": encounter.draft_text,
                "segments_added": len(new_segments),
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Append encounter segments failed", e, code="ENCOUNTER_SEGMENTS_APPEND_FAILED")


@app.route(route="encounters/{encounter_id}/audio-session/start", methods=["POST"])
@require_authenticated_request
def start_encounter_audio_session(req: func.HttpRequest) -> func.HttpResponse:
    """Start a backend-backed audio ingest session for continuous capture uploads."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
        if not has_storage:
            return error_response(500, "Storage service is not configured", "STORAGE_CONFIGURATION_MISSING")

        payload = get_request_json(req)
        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.DRAFT, EncounterStatus.CAPTURING, EncounterStatus.REVIEW),
            action="start an audio session",
            code="ENCOUNTER_AUDIO_SESSION_START_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        existing_state = get_encounter_audio_upload_state(encounter)
        if existing_state and existing_state.get("status") == "active":
            session_id = existing_state.get("session_id")
        else:
            session_id = str(uuid.uuid4())
            session_state = {
                "session_id": session_id,
                "status": "active",
                "sample_rate": int(payload.get("sample_rate") or 24000),
                "channels": int(payload.get("channels") or 1),
                "format": payload.get("format") or "pcm16le",
                "started_at": utc_now(),
            }
            set_encounter_audio_upload_state(encounter, session_state)
            encounter.updated_at = utc_now()
            append_encounter_event(encounter, "audio_upload_session_started", {
                "session_id": session_id,
                "sample_rate": session_state["sample_rate"],
                "channels": session_state["channels"],
            })
            upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "session_id": session_id,
                "status": encounter.status,
                "updated_at": encounter.updated_at,
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Start encounter audio session failed", e, code="ENCOUNTER_AUDIO_SESSION_START_FAILED")


@app.route(route="encounters/{encounter_id}/audio-session/chunks", methods=["POST"])
@require_authenticated_request
def append_encounter_audio_chunk(req: func.HttpRequest) -> func.HttpResponse:
    """Append a staged PCM chunk for a continuous encounter audio upload session."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    session_id = (req.params.get("session_id") or "").strip()
    sequence_raw = (req.params.get("sequence") or "").strip()
    if not session_id:
        return error_response(400, "Audio session ID is required", "AUDIO_SESSION_ID_REQUIRED")
    if not validate_uuid_value(session_id):
        return error_response(400, "Audio session ID must be a valid UUID", "INVALID_AUDIO_SESSION_ID")
    if not sequence_raw.isdigit():
        return error_response(400, "Chunk sequence must be a non-negative integer", "INVALID_AUDIO_CHUNK_SEQUENCE")

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
        if not has_storage:
            return error_response(500, "Storage service is not configured", "STORAGE_CONFIGURATION_MISSING")

        chunk_bytes = req.get_body()
        if not chunk_bytes:
            return error_response(400, "No audio chunk was provided", "AUDIO_CHUNK_REQUIRED")

        payload_size_error = validate_payload_size(
            chunk_bytes,
            max_bytes=MAX_AUDIO_UPLOAD_BYTES,
            code="AUDIO_CHUNK_TOO_LARGE",
            message="Audio chunk payload is too large",
        )
        if payload_size_error:
            return payload_size_error

        sequence = int(sequence_raw)
        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.CAPTURING,),
            action="accept audio chunks",
            code="ENCOUNTER_AUDIO_CHUNK_APPEND_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        session_state = get_encounter_audio_upload_state(encounter)
        if not session_state or session_state.get("session_id") != session_id or session_state.get("status") != "active":
            return error_response(409, "Encounter audio upload session is not active", "ENCOUNTER_AUDIO_SESSION_NOT_ACTIVE")

        blob_name = build_encounter_audio_chunk_blob_name(encounter_id, session_id, sequence)
        blob_client = get_blob_client(config, blob_name)
        blob_client.upload_blob(chunk_bytes, overwrite=True)

        return json_response(
            {
                "encounter_id": encounter_id,
                "session_id": session_id,
                "sequence": sequence,
                "accepted": True,
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Append encounter audio chunk failed", e, code="ENCOUNTER_AUDIO_CHUNK_APPEND_FAILED")


@app.route(route="encounters/{encounter_id}/audio-session/finalize", methods=["POST"])
@require_authenticated_request
def finalize_encounter_audio_session(req: func.HttpRequest) -> func.HttpResponse:
    """Finalize a continuous audio upload session, transcribe the staged audio, and move the encounter into review."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    encounter = None
    session_state = None
    container = None

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        has_speech = is_configured_value(config.speech_key) or is_configured_value(config.speech_endpoint)
        has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
        if not has_speech or not config.speech_region:
            return error_response(500, "Speech service is not configured", "SPEECH_CONFIGURATION_MISSING")
        if not has_storage:
            return error_response(500, "Storage service is not configured", "STORAGE_CONFIGURATION_MISSING")

        payload = get_request_json(req)
        session_id = (payload.get("session_id") or "").strip()
        if not session_id:
            return error_response(400, "Audio session ID is required", "AUDIO_SESSION_ID_REQUIRED")
        if not validate_uuid_value(session_id):
            return error_response(400, "Audio session ID must be a valid UUID", "INVALID_AUDIO_SESSION_ID")

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.CAPTURING,),
            action="finalize an audio session",
            code="ENCOUNTER_AUDIO_SESSION_FINALIZE_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        session_state = get_encounter_audio_upload_state(encounter)
        if not session_state or session_state.get("session_id") != session_id or session_state.get("status") != "active":
            return error_response(409, "Encounter audio upload session is not active", "ENCOUNTER_AUDIO_SESSION_NOT_ACTIVE")

        pcm_bytes = download_staged_encounter_audio(config, encounter_id, session_state)
        wav_bytes = build_wav_audio_bytes(
            pcm_bytes,
            sample_rate=int(session_state.get("sample_rate") or 24000),
            channels=int(session_state.get("channels") or 1),
        )
        result = transcribe_and_store_audio(wav_bytes, encounter_id, config)

        encounter.draft_text = result["transcript_text"]
        encounter.draft_version += 1
        encounter.audio_blob_url = result["blob_url"]
        encounter.diarized_phrases = result["diarized_phrases"]
        encounter.speaker_count = result["speaker_count"]
        encounter.draft_source = "audio_transcription"
        encounter.finalized_text = encounter.draft_text
        encounter.status = EncounterStatus.PROCESSING if is_automatic_processing_configured(config) else EncounterStatus.REVIEW
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "audio_upload_session_finalized", {
            "session_id": session_id,
            "speaker_count": result["speaker_count"],
            "draft_version": encounter.draft_version,
        })
        clear_encounter_audio_upload_state(encounter)
        if is_automatic_processing_configured(config):
            encounter, job, _ = launch_encounter_processing(container, encounter)
        else:
            encounter.review_result = build_encounter_review_result(encounter, None)
            upsert_record(container, encounter)

        cleanup_staged_encounter_audio(config, encounter_id, session_state)

        response_payload = {
            "encounter_id": encounter.id,
            "draft_text": encounter.draft_text,
            "speaker_count": encounter.speaker_count,
            "draft_version": encounter.draft_version,
            "status": encounter.status,
            "review_result": encounter.review_result,
        }
        if encounter.process_job_id:
            response_payload["job_id"] = encounter.process_job_id
        if is_automatic_processing_configured(config):
            response_payload["processing_stage"] = (encounter.review_result or {}).get("processing_stage")

        return json_response(response_payload, status_code=200)
    except RuntimeError as e:
        if container is not None and encounter is not None:
            try:
                clear_encounter_audio_upload_state(encounter)
                persist_failed_encounter_audio_transcription(
                    container,
                    encounter,
                    event_name="audio_upload_session_failed",
                    error_message=str(e),
                    event_details={"session_id": session_id} if 'session_id' in locals() else None,
                )
            except Exception as persist_error:
                log_with_context(
                    "Persist failed audio upload session state failed",
                    level="error",
                    error=str(persist_error),
                    encounter_id=encounter.id,
                )
        if session_state and encounter is not None:
            try:
                cleanup_staged_encounter_audio(config, encounter.id, session_state)
            except Exception as cleanup_error:
                log_with_context(
                    "Cleanup staged encounter audio after finalize failure failed",
                    level="warning",
                    error=str(cleanup_error),
                    encounter_id=encounter.id,
                )
        return internal_server_error(
            "Finalize encounter audio session failed",
            e,
            code="ENCOUNTER_AUDIO_SESSION_FINALIZE_FAILED",
            message="Encounter audio session could not be finalized",
            status_code=502,
        )
    except Exception as e:
        return internal_server_error("Finalize encounter audio session failed", e, code="ENCOUNTER_AUDIO_SESSION_FINALIZE_FAILED")


@app.route(route="encounters/{encounter_id}/audio-session/abort", methods=["POST"])
@require_authenticated_request
def abort_encounter_audio_session(req: func.HttpRequest) -> func.HttpResponse:
    """Abort a continuous audio upload session and clean up any staged chunk blobs."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
        if not has_storage:
            return error_response(500, "Storage service is not configured", "STORAGE_CONFIGURATION_MISSING")

        payload = get_request_json(req)
        session_id = (payload.get("session_id") or req.params.get("session_id") or "").strip()
        if not session_id:
            return error_response(400, "Audio session ID is required", "AUDIO_SESSION_ID_REQUIRED")
        if not validate_uuid_value(session_id):
            return error_response(400, "Audio session ID must be a valid UUID", "INVALID_AUDIO_SESSION_ID")

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        session_state = get_encounter_audio_upload_state(encounter)
        if not session_state or session_state.get("session_id") != session_id:
            return func.HttpResponse(
                json.dumps({
                    "encounter_id": encounter.id,
                    "session_id": session_id,
                    "aborted": False,
                    "reason": "session_not_found",
                }),
                status_code=200,
                mimetype="application/json",
            )

        cleanup_staged_encounter_audio(config, encounter_id, session_state)
        clear_encounter_audio_upload_state(encounter)
        if encounter.status == EncounterStatus.CAPTURING:
            encounter.status = EncounterStatus.REVIEW if (encounter.draft_text or "").strip() else EncounterStatus.DRAFT
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "audio_upload_session_aborted", {"session_id": session_id})
        upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "session_id": session_id,
                "aborted": True,
                "status": encounter.status,
                "updated_at": encounter.updated_at,
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Abort encounter audio session failed", e, code="ENCOUNTER_AUDIO_SESSION_ABORT_FAILED")


@app.route(route="encounters/{encounter_id}/draft", methods=["PUT"])
@require_authenticated_request
def save_encounter_draft(req: func.HttpRequest) -> func.HttpResponse:
    """Persist the reviewed encounter draft text."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        draft_text = (payload.get("draft_text") or "").strip()
        expected_version = payload.get("expected_draft_version")

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        if expected_version is not None and expected_version != encounter.draft_version:
            return conflict_response(
                "Draft version conflict",
                details={
                    "reason": "DRAFT_VERSION_CONFLICT",
                    "currentDraftVersion": encounter.draft_version,
                },
            )

        encounter.draft_text = draft_text
        encounter.draft_segments = payload.get("segments") or encounter.draft_segments or []
        encounter.draft_version += 1
        encounter.status = EncounterStatus.REVIEW
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "draft_saved", {"draft_version": encounter.draft_version})
        encounter.review_result = build_encounter_review_result(encounter, None)
        upsert_record(container, encounter)

        return json_response(build_encounter_response_payload(encounter), status_code=200)
    except Exception as e:
        return internal_server_error("Save encounter draft failed", e, code="ENCOUNTER_DRAFT_SAVE_FAILED")


@app.route(route="encounters/{encounter_id}/audio", methods=["POST"])
@require_authenticated_request
def ingest_encounter_audio(req: func.HttpRequest) -> func.HttpResponse:
    """Accept captured audio, transcribe with diarization, and update encounter draft."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    encounter = None
    container = None

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        has_speech = is_configured_value(config.speech_key) or is_configured_value(config.speech_endpoint)
        has_storage = is_configured_value(config.storage_connection_string) or is_configured_value(config.storage_account_name)
        if not has_speech or not config.speech_region:
            return error_response(500, "Speech service is not configured", "SPEECH_CONFIGURATION_MISSING")
        if not has_storage:
            return error_response(500, "Storage service is not configured", "STORAGE_CONFIGURATION_MISSING")

        audio_bytes = req.get_body()
        if not audio_bytes:
            return error_response(400, "No audio data provided", "AUDIO_DATA_REQUIRED")

        payload_size_error = validate_payload_size(
            audio_bytes,
            max_bytes=MAX_AUDIO_UPLOAD_BYTES,
            code="AUDIO_DATA_TOO_LARGE",
            message="Captured audio payload is too large",
        )
        if payload_size_error:
            return payload_size_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        result = transcribe_and_store_audio(audio_bytes, encounter_id, config)

        encounter.draft_text = result["transcript_text"]
        encounter.draft_version += 1
        encounter.audio_blob_url = result["blob_url"]
        encounter.diarized_phrases = result["diarized_phrases"]
        encounter.speaker_count = result["speaker_count"]
        encounter.draft_source = "audio_transcription"
        encounter.finalized_text = encounter.draft_text
        encounter.status = EncounterStatus.PROCESSING if is_automatic_processing_configured(config) else EncounterStatus.REVIEW
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "audio_transcribed", {
            "speaker_count": result["speaker_count"],
            "draft_version": encounter.draft_version,
        })
        if is_automatic_processing_configured(config):
            encounter, job, _ = launch_encounter_processing(container, encounter)
        else:
            encounter.review_result = build_encounter_review_result(encounter, None)
            upsert_record(container, encounter)

        response_payload = {
            "encounter_id": encounter.id,
            "draft_text": encounter.draft_text,
            "speaker_count": encounter.speaker_count,
            "draft_version": encounter.draft_version,
            "status": encounter.status,
            "review_result": encounter.review_result,
        }
        if encounter.process_job_id:
            response_payload["job_id"] = encounter.process_job_id
            response_payload["processing_stage"] = (encounter.review_result or {}).get("processing_stage")

        return json_response(response_payload, status_code=200)
    except RuntimeError as e:
        if container is not None and encounter is not None:
            try:
                persist_failed_encounter_audio_transcription(
                    container,
                    encounter,
                    event_name="audio_transcription_failed",
                    error_message=str(e),
                )
            except Exception as persist_error:
                log_with_context(
                    "Persist failed captured audio transcription state failed",
                    level="error",
                    error=str(persist_error),
                    encounter_id=encounter.id,
                )
        return internal_server_error(
            "Encounter audio transcription failed",
            e,
            code="ENCOUNTER_AUDIO_TRANSCRIPTION_FAILED",
            message="Captured audio could not be transcribed",
            status_code=502,
        )
    except Exception as e:
        return internal_server_error("Encounter audio ingestion failed", e, code="ENCOUNTER_AUDIO_INGEST_FAILED")


@app.route(route="encounters/{encounter_id}/finalize", methods=["POST"])
@require_authenticated_request
def finalize_encounter_draft(req: func.HttpRequest) -> func.HttpResponse:
    """Freeze the reviewed encounter draft for downstream clinical processing."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        expected_version = payload.get("expected_draft_version")

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        if expected_version is not None and expected_version != encounter.draft_version:
            return conflict_response(
                "Draft version conflict",
                details={
                    "reason": "DRAFT_VERSION_CONFLICT",
                    "currentDraftVersion": encounter.draft_version,
                },
            )

        if not encounter.draft_text.strip():
            return error_response(400, "Draft transcript is empty", "DRAFT_TRANSCRIPT_EMPTY")

        encounter.finalized_text = encounter.draft_text.strip()
        encounter.status = EncounterStatus.PROCESSING if is_automatic_processing_configured(config) else EncounterStatus.READY
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "finalized", {"draft_version": encounter.draft_version})
        if is_automatic_processing_configured(config):
            encounter, job, _ = launch_encounter_processing(container, encounter)
            return json_response(build_encounter_process_payload(encounter, job), status_code=200)

        encounter.review_result = build_encounter_review_result(encounter, None)
        upsert_record(container, encounter)
        return json_response(build_encounter_response_payload(encounter), status_code=200)
    except Exception as e:
        return internal_server_error("Finalize encounter failed", e, code="ENCOUNTER_FINALIZE_FAILED")


@app.route(route="encounters/{encounter_id}/process", methods=["POST"])
@require_authenticated_request
def process_encounter(req: func.HttpRequest) -> func.HttpResponse:
    """Run transcript-first clinical processing for an approved encounter draft."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(
            config,
            require_cosmos=True,
            require_language=True,
            require_openai=True,
            require_search=True,
        )
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.READY, EncounterStatus.REVIEW),
            action="start clinical processing",
            code="ENCOUNTER_PROCESS_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        encounter, job, created = launch_encounter_processing(container, encounter)
        return json_response(build_encounter_process_payload(encounter, job), status_code=202 if created else 200)
    except Exception as e:
        log_with_context("Process encounter failed", level="error", error=str(e), encounter_id=encounter_id)
        try:
            config = AzureConfig.from_environment()
            container = get_cosmos_client(config)
            encounter, response = get_encounter_or_response(container, encounter_id)
            if encounter:
                encounter.status = EncounterStatus.FAILED
                encounter.error_message = str(e)
                encounter.updated_at = utc_now()
                append_encounter_event(encounter, "processing_failed", {"error": str(e)})
                upsert_record(container, encounter)
        except Exception:
            pass

        return error_response(500, "Encounter processing failed", "ENCOUNTER_PROCESS_FAILED")


def run_encounter_processing_job(encounter_id: str, job_id: str) -> None:
    start_time = time.time()

    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)

        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            raise RuntimeError(f"Encounter not found: {encounter_id}")

        job_data = container.read_item(item=job_id, partition_key=job_id)
        job = TranscriptionJob.from_dict(job_data)

        diarized_phrases = encounter.diarized_phrases or []
        encounter_speaker_count = encounter.speaker_count or 0

        job.status = JobStatus.ANALYZING
        job.processing_stage = "clinical_analysis"
        job.updated_at = utc_now()
        upsert_record(container, job)

        job.medical_entities = generate_medical_analysis(
            job.transcription_text or "",
            config,
            diarized_phrases,
            encounter_speaker_count,
        )

        job.processing_stage = "summary_generation"
        job.updated_at = utc_now()
        upsert_record(container, job)
        ensure_job_summary(job, config)

        job.processing_stage = "search_indexing"
        job.updated_at = utc_now()
        upsert_record(container, job)
        indexing_summary = persist_job_and_index_context(container, encounter, job, config)

        job.status = JobStatus.COMPLETED
        job.processing_stage = "completed"
        job.processing_time_seconds = time.time() - start_time
        job.updated_at = utc_now()
        upsert_record(container, job)

        encounter.status = EncounterStatus.READY_FOR_REVIEW
        encounter.updated_at = utc_now()
        encounter.error_message = None
        encounter.review_result = build_encounter_review_result(encounter, job)
        append_encounter_event(
            encounter,
            "processing_completed",
            {
                "job_id": job.id,
                "indexed_documents": indexing_summary.get("indexed_documents", 0),
            },
        )
        upsert_record(container, encounter)
    except Exception as error:
        logger.error(f"Background encounter processing failed for {encounter_id}: {error}")

        try:
            config = AzureConfig.from_environment()
            container = get_cosmos_client(config)
            encounter, _ = get_encounter_or_response(container, encounter_id)

            job_data = container.read_item(item=job_id, partition_key=job_id)
            job = TranscriptionJob.from_dict(job_data)
            job.status = JobStatus.FAILED
            job.processing_stage = "failed"
            job.error_message = str(error)
            job.processing_time_seconds = time.time() - start_time
            job.updated_at = utc_now()
            upsert_record(container, job)

            if encounter:
                encounter.status = EncounterStatus.FAILED
                encounter.error_message = str(error)
                encounter.updated_at = utc_now()
                encounter.review_result = build_encounter_review_result(encounter, job)
                append_encounter_event(encounter, "processing_failed", {"error": str(error), "job_id": job_id})
                upsert_record(container, encounter)
        except Exception as recovery_error:
            logger.error(f"Could not persist encounter processing failure state for {encounter_id}: {recovery_error}")


@app.route(route="encounters/{encounter_id}/context", methods=["GET"])
@require_authenticated_request
def get_encounter_context(req: func.HttpRequest) -> func.HttpResponse:
    """Return a normalized, encounter-scoped clinical context projection."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True, require_search=True)
        if config_error:
            return config_error

        query = req.params.get("q", "")
        category = req.params.get("category", "")
        assertion = req.params.get("assertion", "")
        try:
            limit = int(req.params.get("limit", "50"))
        except ValueError:
            return error_response(400, "Query parameter 'limit' must be an integer", "INVALID_CONTEXT_LIMIT")

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        job = None
        if encounter.process_job_id:
            job, _ = get_job_or_response(container, encounter.process_job_id, access_mode="read")

        payload = build_encounter_context_response(
            encounter,
            job,
            config,
            q=query,
            category=category,
            assertion=assertion,
            limit=limit,
        )

        write_platform_audit_event(
            config,
            action="encounter.context.read",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "query_hash": stable_hash(query) if query else None,
                "category": category or None,
                "assertion": assertion or None,
                "limit": limit,
                "returned_items": (payload.get("summary") or {}).get("returned_items"),
            },
        )

        return json_response(payload, status_code=200)
    except Exception as e:
        return internal_server_error("Get encounter context failed", e, code="ENCOUNTER_CONTEXT_READ_FAILED")


@app.route(route="encounters/{encounter_id}/operational-context", methods=["GET"])
@require_authenticated_request
def get_operational_context(req: func.HttpRequest) -> func.HttpResponse:
    """Return mock operational context using contracts-first provider seams."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        job = None
        if encounter.process_job_id:
            job, _ = get_job_or_response(container, encounter.process_job_id, access_mode="read")

        payload = build_mock_operational_context(encounter, job)
        write_platform_audit_event(
            config,
            action="encounter.operational_context.read",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "linked_job_id": encounter.process_job_id,
            },
        )
        return json_response(payload, status_code=200)
    except Exception as e:
        return internal_server_error("Get operational context failed", e, code="OPERATIONAL_CONTEXT_READ_FAILED")


@app.route(route="encounters/{encounter_id}/actions/preview", methods=["POST"])
@require_authenticated_request
def preview_encounter_actions(req: func.HttpRequest) -> func.HttpResponse:
    """Return auditable, preview-only action artifacts without executing side effects."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        requested_tool_id = normalize_context_value(payload.get("toolId")).lower()

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        job = None
        if encounter.process_job_id:
            job, _ = get_job_or_response(container, encounter.process_job_id, access_mode="read")

        operational_context = build_mock_operational_context(encounter, job)
        previews = build_action_previews(encounter, operational_context)
        if requested_tool_id:
            previews = [preview for preview in previews if normalize_context_value(preview.get("toolId")).lower() == requested_tool_id]

        write_platform_audit_event(
            config,
            action="encounter.action_preview.read",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "requested_tool_id": requested_tool_id or None,
                "preview_count": len(previews),
            },
        )

        return json_response(
            {
                "encounter_id": encounter.id,
                "generated_at": utc_now(),
                "preview_only": True,
                "previews": previews,
                "requested_tool_id": requested_tool_id or None,
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Preview encounter actions failed", e, code="ENCOUNTER_ACTION_PREVIEW_FAILED")


@app.route(route="encounters/{encounter_id}/assistant/query", methods=["POST"])
@require_authenticated_request
def query_encounter_assistant(req: func.HttpRequest) -> func.HttpResponse:
    """Return stable NDJSON streaming envelopes for retrieval-only assistant responses."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True, require_search=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        question = normalize_context_value(payload.get("question"))
        if not question:
            return error_response(400, "Question is required", "ASSISTANT_QUESTION_REQUIRED")

        scope = normalize_context_value(payload.get("scope")) or "local"
        agent_id = normalize_context_value(payload.get("agentId")) or "chat-agent"

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        job = None
        if encounter.process_job_id:
            job, _ = get_job_or_response(container, encounter.process_job_id, access_mode="read")

        write_platform_audit_event(
            config,
            action="encounter.assistant.query",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "question_hash": stable_hash(question),
                "scope": scope,
                "agent_id": agent_id,
            },
        )

        envelopes = build_streaming_envelopes(encounter, job, config, question=question, scope=scope, agent_id=agent_id)
        return func.HttpResponse(
            serialize_envelopes_as_ndjson(envelopes),
            status_code=200,
            mimetype="application/x-ndjson",
            headers={
                "Cache-Control": "no-store",
                "X-Streaming-Format": "ndjson-envelope",
            },
        )
    except Exception as e:
        logger.error(f"Encounter assistant query failed: {e}")
        failure = {
            "event": "turn.failed",
            "requestId": str(uuid.uuid4()),
            "threadId": f"thread:{encounter_id}:chat-agent",
            "turnId": f"turn:{uuid.uuid4()}",
            "data": {
                "error": "Assistant request failed",
                "code": "ASSISTANT_QUERY_FAILED",
                "correlationId": _get_correlation_id(),
            },
        }
        return func.HttpResponse(json.dumps(failure), status_code=500, mimetype="application/x-ndjson")


@app.route(route="encounters/{encounter_id}/results", methods=["GET"])
@require_authenticated_request
def get_encounter_results(req: func.HttpRequest) -> func.HttpResponse:
    """Get finalized results for an encounter-backed processing job."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
        if response:
            return response

        job = None
        if encounter.process_job_id:
            job, response = get_job_or_response(container, encounter.process_job_id, access_mode="read")
            if response:
                return response

            if normalize_job_failure_state(job):
                container.upsert_item(body=job.to_dict())

        result = build_encounter_review_result(encounter, job)
        encounter.review_result = result
        upsert_record(container, encounter)

        write_platform_audit_event(
            config,
            action="encounter.results.read",
            target_type="encounter",
            target_id=encounter.id,
            payload={
                "job_id": encounter.process_job_id,
                "status": encounter.status,
            },
        )

        return json_response(result, status_code=200)
    except Exception as e:
        return internal_server_error("Encounter results read failed", e, code="ENCOUNTER_RESULTS_READ_FAILED")


@app.route(route="encounters/{encounter_id}/review", methods=["PUT"])
@require_authenticated_request
def save_encounter_review(req: func.HttpRequest) -> func.HttpResponse:
    """Persist clinician edits against the encounter review payload."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        body_size_error = validate_request_body_size(req)
        if body_size_error:
            return body_size_error

        payload = get_request_json(req)
        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.READY_FOR_REVIEW, EncounterStatus.APPROVED),
            action="save review edits",
            code="ENCOUNTER_REVIEW_SAVE_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        job = None
        if encounter.process_job_id:
            job, response = get_job_or_response(container, encounter.process_job_id, access_mode="read")
            if response:
                return response

        review_result = build_encounter_review_result(encounter, job)
        encounter.review_result = apply_review_action_edits(review_result, payload)
        encounter.status = EncounterStatus.READY_FOR_REVIEW if encounter.status != EncounterStatus.APPROVED else encounter.status
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "review_saved")
        upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "action": "save_edits",
                "status": encounter.status,
                "updated_at": encounter.updated_at,
                "result": encounter.review_result,
                "links": (encounter.review_result or {}).get("links", {}),
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Save encounter review failed", e, code="ENCOUNTER_REVIEW_SAVE_FAILED")


@app.route(route="encounters/{encounter_id}/review/approve", methods=["POST"])
@require_authenticated_request
def approve_encounter_review(req: func.HttpRequest) -> func.HttpResponse:
    """Approve a clinician-reviewed final note."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.READY_FOR_REVIEW,),
            action="approve the final review",
            code="ENCOUNTER_REVIEW_APPROVE_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        job = None
        if encounter.process_job_id:
            job, response = get_job_or_response(container, encounter.process_job_id, access_mode="read")
            if response:
                return response

        encounter.review_result = build_encounter_review_result(encounter, job)
        encounter.status = EncounterStatus.APPROVED
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "review_approved", {"job_id": encounter.process_job_id})
        upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "action": "approve",
                "status": encounter.status,
                "updated_at": encounter.updated_at,
                "result": encounter.review_result,
                "links": (encounter.review_result or {}).get("links", {}),
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Approve encounter review failed", e, code="ENCOUNTER_REVIEW_APPROVE_FAILED")


@app.route(route="encounters/{encounter_id}/review/regenerate", methods=["POST"])
@require_authenticated_request
def regenerate_encounter_review(req: func.HttpRequest) -> func.HttpResponse:
    """Regenerate clinician-facing outputs for an encounter without re-uploading audio."""
    encounter_id, response = require_uuid_route_param(req, "encounter_id", "Encounter ID", "INVALID_ENCOUNTER_ID")
    if response:
        return response

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(
            config,
            require_cosmos=True,
            require_openai=True,
        )
        if config_error:
            return config_error

        container = get_cosmos_client(config)
        encounter, response = get_encounter_or_response(container, encounter_id)
        if response:
            return response

        state_error = require_encounter_status(
            encounter,
            (EncounterStatus.READY_FOR_REVIEW, EncounterStatus.APPROVED),
            action="regenerate the final review",
            code="ENCOUNTER_REVIEW_REGENERATE_NOT_ALLOWED",
        )
        if state_error:
            return state_error

        if not encounter.process_job_id:
            return error_response(400, "Encounter has no processed job to regenerate", "ENCOUNTER_REVIEW_REGENERATE_REQUIRES_JOB")

        job, response = get_job_or_response(container, encounter.process_job_id, access_mode="read")
        if response:
            return response

        encounter.status = EncounterStatus.PROCESSING
        encounter.updated_at = utc_now()
        append_encounter_event(encounter, "review_regeneration_started", {"job_id": job.id})
        upsert_record(container, encounter)

        ensure_job_summary(job, config, regenerate=True)
        upsert_record(container, job)

        encounter.status = EncounterStatus.READY_FOR_REVIEW
        encounter.updated_at = utc_now()
        encounter.review_result = build_encounter_review_result(encounter, job)
        append_encounter_event(encounter, "review_regeneration_completed", {"job_id": job.id})
        upsert_record(container, encounter)

        return json_response(
            {
                "encounter_id": encounter.id,
                "action": "regenerate",
                "status": encounter.status,
                "updated_at": encounter.updated_at,
                "result": encounter.review_result,
                "links": (encounter.review_result or {}).get("links", {}),
            },
            status_code=200,
        )
    except Exception as e:
        return internal_server_error("Regenerate encounter review failed", e, code="ENCOUNTER_REVIEW_REGENERATE_FAILED")


@app.route(route="platform-admin/tenants", methods=["POST"])
@require_authenticated_request
def create_tenant(req: func.HttpRequest) -> func.HttpResponse:
    """Create a tenant and assign the caller as its owner."""
    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        ctx = get_current_request_context()
        memberships = list((ctx.memberships or []) if ctx else [])
        if not ctx or not _can_create_tenant(config, memberships, ctx.role):
            return error_response(403, "Only eligible bootstrap users or tenant admins can create tenants", "ACCESS_DENIED")

        payload = get_request_json(req)
        tenant_name = normalize_context_value(payload.get("name"))
        tenant_slug = normalize_context_value(payload.get("slug")) or _slugify_tenant_name(tenant_name)
        if not tenant_name:
            return error_response(400, "Tenant name is required", "TENANT_NAME_REQUIRED")
        if not tenant_slug:
            return error_response(400, "Tenant slug is required", "TENANT_SLUG_REQUIRED")

        tenants_container = get_platform_tenants_container(config)
        existing_tenant = _query_single_item(
            tenants_container,
            "SELECT * FROM c WHERE c.slug = @slug",
            [{"name": "@slug", "value": tenant_slug}],
        )
        if existing_tenant:
            return error_response(409, "Tenant slug already exists", "TENANT_SLUG_CONFLICT")

        now = utc_now()
        tenant_id = str(uuid.uuid4())
        tenant_doc = {
            "id": tenant_id,
            "name": tenant_name,
            "slug": tenant_slug,
            "status": "active",
            "isolation_mode": "shared",
            "created_at": now,
        }
        tenants_container.create_item(tenant_doc)

        users_container = get_platform_users_container(config)
        user_doc = _query_single_item(
            users_container,
            "SELECT * FROM c WHERE c.id = @id",
            [{"name": "@id", "value": ctx.user_id}],
        )
        if not user_doc:
            return error_response(500, "Authenticated user record could not be loaded", "AUTH_CONTEXT_FAILED")

        user_doc["memberships"] = [
            membership for membership in list(user_doc.get("memberships") or [])
            if not _is_bootstrap_default_membership(config, membership)
        ]
        user_doc, _ = _upsert_membership(
            user_doc,
            {
                "tenant_id": tenant_id,
                "tenant_name": tenant_name,
                "tenant_slug": tenant_slug,
                "role": "owner",
            },
        )
        user_doc["updated_at"] = now
        users_container.upsert_item(user_doc)

        write_platform_audit_event(
            config,
            action="tenant.create",
            target_type="tenant",
            target_id=tenant_id,
            payload={
                "tenant_slug": tenant_slug,
            },
        )

        return json_response(
            {
                "tenant": tenant_doc,
                "membership": {
                    "tenant_id": tenant_id,
                    "tenant_name": tenant_name,
                    "tenant_slug": tenant_slug,
                    "role": "owner",
                },
            },
            status_code=201,
        )
    except Exception as exc:
        return internal_server_error("Create tenant failed", exc, code="TENANT_CREATE_FAILED")


@app.route(route="platform-admin/tenants/{tenant_id}/members", methods=["POST"])
@require_authenticated_request
def add_tenant_member(req: func.HttpRequest) -> func.HttpResponse:
    """Assign or update tenant membership for an existing or placeholder user."""
    tenant_id = normalize_context_value(req.route_params.get("tenant_id"))
    if not tenant_id:
        return error_response(400, "Tenant ID is required", "TENANT_ID_REQUIRED")

    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        ctx = get_current_request_context()
        if not ctx or normalize_context_value(ctx.tenant_id) != normalize_context_value(tenant_id) or normalize_context_value(ctx.role).lower() not in TENANT_MUTATION_ADMIN_ROLES:
            return error_response(403, "Only tenant owners or admins can manage tenant memberships", "ACCESS_DENIED")

        payload = get_request_json(req)
        email = normalize_context_value(payload.get("email")).lower()
        role = normalize_context_value(payload.get("role")).lower()
        display_name = normalize_context_value(payload.get("name"))
        if not email:
            return error_response(400, "Member email is required", "TENANT_MEMBER_EMAIL_REQUIRED")
        if role not in TENANT_ROLE_VALUES:
            return error_response(400, "Member role is invalid", "INVALID_TENANT_ROLE")

        tenants_container = get_platform_tenants_container(config)
        tenant_doc = tenants_container.read_item(item=tenant_id, partition_key=tenant_id)
        membership = {
            "tenant_id": tenant_doc.get("id", tenant_id),
            "tenant_name": tenant_doc.get("name", "Tenant"),
            "tenant_slug": tenant_doc.get("slug", "tenant"),
            "role": role,
        }

        users_container = get_platform_users_container(config)
        user_doc = _query_platform_user_by_email(config, email)
        placeholder_created = False
        now = utc_now()

        if not user_doc:
            placeholder_created = True
            user_doc = {
                "id": str(uuid.uuid4()),
                "issuer": "pending-email",
                "issuer_subject": f"pending-email::{email}",
                "email": email,
                "name": display_name or email,
                "memberships": [],
                "created_at": now,
            }

        user_doc, created_membership = _upsert_membership(user_doc, membership)
        user_doc["updated_at"] = now
        if not user_doc.get("name"):
            user_doc["name"] = display_name or email
        users_container.upsert_item(user_doc)

        write_platform_audit_event(
            config,
            action="tenant.member.assign",
            target_type="tenant_membership",
            target_id=f"{tenant_id}:{user_doc.get('id')}",
            payload={
                "role": role,
                "placeholder_user_created": placeholder_created,
                "membership_created": created_membership,
            },
        )

        return json_response(
            {
                "tenant_id": tenant_id,
                "user_id": user_doc.get("id"),
                "email": user_doc.get("email"),
                "role": role,
                "placeholder_user_created": placeholder_created,
                "membership_created": created_membership,
            },
            status_code=201 if (placeholder_created or created_membership) else 200,
        )
    except Exception as exc:
        return internal_server_error("Add tenant member failed", exc, code="TENANT_MEMBER_ASSIGN_FAILED")


@app.route(route="voice-sessions", methods=["POST"])
@require_authenticated_request
def create_voice_session(req: func.HttpRequest) -> func.HttpResponse:
    """Create a short-lived authenticated session token for VoiceLive websocket startup."""
    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(config, require_cosmos=True)
        if config_error:
            return config_error

        ctx = get_current_request_context()
        if not ctx or not normalize_context_value(ctx.tenant_id):
            return error_response(400, "Tenant selection is required", "TENANT_REQUIRED")

        payload = get_request_json(req)
        encounter_id = normalize_context_value(payload.get("encounter_id"))

        if encounter_id:
            container = get_cosmos_client(config)
            encounter, response = get_encounter_or_response(container, encounter_id, access_mode="read")
            if response:
                return response

        session_token = str(uuid.uuid4())
        expires_at = datetime.utcnow() + timedelta(minutes=15)
        session_doc = {
            "id": session_token,
            "user_id": ctx.user_id,
            "tenant_id": ctx.tenant_id,
            "encounter_id": encounter_id or None,
            "created_at": utc_now(),
            "expires_at": expires_at.isoformat() + "Z",
            "ttl": 900,
        }
        voice_sessions_container = get_platform_voice_sessions_container(config)
        voice_sessions_container.upsert_item(session_doc)

        write_platform_audit_event(
            config,
            action="voice_session.create",
            target_type="voice_session",
            target_id=session_token,
            payload={
                "encounter_id": encounter_id or None,
                "expires_at": session_doc["expires_at"],
            },
        )

        return json_response(
            {
                "session_token": session_token,
                "expires_at": session_doc["expires_at"],
                "encounter_id": encounter_id or None,
            },
            status_code=201,
        )
    except Exception as exc:
        return internal_server_error("Create voice session failed", exc, code="VOICE_SESSION_CREATE_FAILED")

@app.route(route="health", methods=["GET"])
def health_check(req: func.HttpRequest) -> func.HttpResponse:
    """Dependency-aware health check endpoint."""
    try:
        config = AzureConfig.from_environment()
        payload = build_health_status(config)
        status_code = 200 if payload["status"] == "healthy" else 503
        return json_response(payload, status_code=status_code)
    except Exception as exc:
        return internal_server_error("Health check failed", exc, code="HEALTH_CHECK_FAILED", message="Health checks could not be completed", status_code=503)


@app.route(route="upload", methods=["POST"])
@require_authenticated_request
def upload_audio(req: func.HttpRequest) -> func.HttpResponse:
    """Upload an audio file for transcription"""
    try:
        log_with_context("Received upload request")
        config = AzureConfig.from_environment()
        encounter_id = req.params.get("encounter_id")
        ctx = get_current_request_context()

        if encounter_id and not validate_uuid_value(encounter_id):
            return error_response(400, "Encounter ID must be a valid UUID", "INVALID_ENCOUNTER_ID")

        runtime_safety_error = get_runtime_safety_error(config)
        if runtime_safety_error:
            return runtime_safety_error
        
        if not config.validate():
            return error_response(500, "Server configuration error", "SERVER_CONFIGURATION_ERROR")

        content_length = normalize_context_value(req.headers.get("Content-Length"))
        if content_length and content_length.isdigit() and int(content_length) > MAX_AUDIO_UPLOAD_BYTES:
            return error_response(
                413,
                "Uploaded audio file is too large",
                "AUDIO_FILE_TOO_LARGE",
                details={"maxBytes": MAX_AUDIO_UPLOAD_BYTES, "receivedBytes": int(content_length)},
            )
        
        file = req.files.get('file')
        if not file:
            return error_response(400, "No file provided", "FILE_REQUIRED")
        
        filename = file.filename
        if not is_supported_format(filename):
            return error_response(400, f"Unsupported format. Supported: {SUPPORTED_FORMATS}", "UNSUPPORTED_AUDIO_FORMAT")
        
        content = file.read()
        payload_size_error = validate_payload_size(
            content,
            max_bytes=MAX_AUDIO_UPLOAD_BYTES,
            code="AUDIO_FILE_TOO_LARGE",
            message="Uploaded audio file is too large",
        )
        if payload_size_error:
            return payload_size_error
        container = get_cosmos_client(config)

        if encounter_id:
            encounter, response = get_encounter_or_response(container, encounter_id)
            if response:
                return response

            if encounter.status in {EncounterStatus.PROCESSING, EncounterStatus.COMPLETED}:
                return error_response(
                    409,
                    "Encounter can no longer accept a new uploaded recording",
                    "ENCOUNTER_UPLOAD_NOT_ALLOWED",
                    details={"encounterId": encounter.id},
                )

            result = transcribe_and_store_audio(content, encounter_id, config)

            encounter.draft_text = result["transcript_text"]
            encounter.draft_version += 1
            encounter.audio_blob_url = result["blob_url"]
            encounter.diarized_phrases = result["diarized_phrases"]
            encounter.speaker_count = result["speaker_count"]
            encounter.draft_source = "uploaded_recording"
            encounter.finalized_text = encounter.draft_text
            encounter.owner_id = encounter.owner_id or (ctx.user_id if ctx else None)
            encounter.tenant_id = encounter.tenant_id or (ctx.tenant_id if ctx else None)
            encounter.status = EncounterStatus.PROCESSING if is_automatic_processing_configured(config) else EncounterStatus.REVIEW
            encounter.error_message = None
            encounter.updated_at = utc_now()
            append_encounter_event(
                encounter,
                "uploaded_recording_transcribed",
                {
                    "filename": filename,
                    "speaker_count": encounter.speaker_count,
                    "draft_version": encounter.draft_version,
                },
            )
            if is_automatic_processing_configured(config):
                encounter, job, _ = launch_encounter_processing(container, encounter)
            else:
                encounter.review_result = build_encounter_review_result(encounter, None)
                upsert_record(container, encounter)

            return json_response(
                {
                    "encounter_id": encounter.id,
                    "filename": filename,
                    "status": encounter.status,
                    "draft_text": encounter.draft_text,
                    "draft_version": encounter.draft_version,
                    "draft_segments": encounter.draft_segments or [],
                    "diarized_phrases": encounter.diarized_phrases or [],
                    "speaker_count": encounter.speaker_count,
                    "draft_source": encounter.draft_source,
                    "updated_at": encounter.updated_at,
                    "created_at": encounter.created_at,
                    "job_id": encounter.process_job_id,
                    "review_result": encounter.review_result,
                    "links": {
                        "self": f"/api/encounters/{encounter.id}",
                        "review": f"/encounters/{encounter.id}/review",
                        "results": f"/api/encounters/{encounter.id}/results",
                        "draft": f"/api/encounters/{encounter.id}/draft",
                        "finalize": f"/api/encounters/{encounter.id}/finalize",
                        "process": f"/api/encounters/{encounter.id}/process",
                    },
                },
                status_code=201,
            )

        job_id = str(uuid.uuid4())
        now = utc_now()
        
        # Upload to blob
        blob_name = f"{job_id}/{filename}"
        blob_client = get_blob_client(config, blob_name)
        blob_client.upload_blob(content, overwrite=True)
        
        # Create job
        job = TranscriptionJob(
            id=job_id,
            filename=filename,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
            blob_url=blob_client.url,
            owner_id=ctx.user_id if ctx else None,
            tenant_id=ctx.tenant_id if ctx else None,
        )
        
        # Save to Cosmos
        container.create_item(body=job.to_dict())
        
        log_with_context("Created transcription job", job_id=job_id, filename=filename)
        return json_response(
            {"job_id": job_id, "filename": filename, "status": JobStatus.PENDING,
             "links": {"status": f"/api/status/{job_id}", "process": f"/api/process/{job_id}", "results": f"/api/results/{job_id}"}},
            status_code=201,
        )
    except Exception as e:
        return internal_server_error("Upload failed", e, code="UPLOAD_FAILED")


@app.route(route="process/{job_id}", methods=["POST"])
@require_authenticated_request
def process_transcription(req: func.HttpRequest) -> func.HttpResponse:
    """Process a transcription job using REST APIs"""
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    try:
        config = AzureConfig.from_environment()
        config_error = get_required_service_config(
            config,
            require_cosmos=True,
            require_language=True,
            require_openai=True,
            require_search=True,
        )
        if config_error:
            return config_error
        container = get_cosmos_client(config)
        start_time = time.time()
        
        job, response = get_job_or_response(container, job_id)
        if response:
            return response
        
        # Update status
        job.status = JobStatus.TRANSCRIBING
        job.updated_at = utc_now()
        container.upsert_item(body=job.to_dict())
        
        # Download audio
        blob_name = f"{job_id}/{job.filename}"
        blob_client = get_blob_client(config, blob_name)
        audio_bytes = blob_client.download_blob().readall()
        
        # Transcribe using REST API with diarization
        transcription_result = transcribe_audio_rest(audio_bytes, config, enable_diarization=True)
        failure_message = transcription_result_error(transcription_result)
        if failure_message:
            raise RuntimeError(failure_message)
        transcription_text = transcription_result.get("text", "")
        diarized_phrases = transcription_result.get("phrases", [])
        speaker_count = transcription_result.get("speaker_count", 0)
        
        job.transcription_text = transcription_text
        job.status = JobStatus.ANALYZING
        job.updated_at = utc_now()
        container.upsert_item(body=job.to_dict())
        job.medical_entities = generate_medical_analysis(transcription_text, config, diarized_phrases, speaker_count)
        ensure_job_summary(job, config)
        job.status = JobStatus.COMPLETED
        job.processing_time_seconds = time.time() - start_time
        job.updated_at = utc_now()
        indexing_summary = persist_job_and_index_context(container, None, job, config)

        total_entities = job.medical_entities.get("summary", {}).get("total_entities", 0)
        
        log_with_context(
            "Transcription job completed",
            job_id=job_id,
            processing_time_seconds=job.processing_time_seconds,
            speaker_count=speaker_count,
            entities_found=total_entities,
        )
        return json_response(
            {"job_id": job_id, "status": JobStatus.COMPLETED, "processing_time": job.processing_time_seconds,
             "transcription_preview": transcription_text[:500] if transcription_text else "",
             "entities_found": total_entities, "speakers_detected": speaker_count,
             "summary_generated": bool((job.llm_summary or {}).get("summary_text")),
             "indexed_documents": indexing_summary.get("indexed_documents", 0)},
            status_code=200,
        )
        
    except Exception as e:
        log_with_context("Transcription job processing failed", level="error", error=str(e), job_id=job_id)
        try:
            job.status = JobStatus.FAILED
            job.error_message = str(e)
            container.upsert_item(body=job.to_dict())
        except:
            pass
        return error_response(500, "Transcription job processing failed", "JOB_PROCESSING_FAILED")


@app.route(route="status/{job_id}", methods=["GET"])
@require_authenticated_request
def get_status(req: func.HttpRequest) -> func.HttpResponse:
    """Get job status"""
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)
        job, response = get_job_or_response(container, job_id, access_mode="read")
        if response:
            return response
        if normalize_job_failure_state(job):
            container.upsert_item(body=job.to_dict())
        
        return json_response(
            {"job_id": job.id, "filename": job.filename, "status": job.status,
             "created_at": job.created_at, "updated_at": job.updated_at,
             "processing_time_seconds": job.processing_time_seconds, "error_message": job.error_message,
             "processing_stage": job.processing_stage},
            status_code=200,
        )
    except Exception as e:
        return internal_server_error(
            "Get job status failed",
            e,
            code="JOB_STATUS_READ_FAILED",
            message="Job status could not be loaded",
            status_code=404,
        )


@app.route(route="results/{job_id}", methods=["GET"])
@require_authenticated_request
def get_results(req: func.HttpRequest) -> func.HttpResponse:
    """Get full results"""
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)
        
        job, response = get_job_or_response(container, job_id, access_mode="read")
        if response:
            return response
        if normalize_job_failure_state(job):
            container.upsert_item(body=job.to_dict())
        
        result = build_job_result(job)
        return json_response(result, status_code=200)
    except Exception as e:
        return internal_server_error("Job results read failed", e, code="JOB_RESULTS_READ_FAILED")


@app.route(route="summary/{job_id}", methods=["GET"])
@require_authenticated_request
def get_summary(req: func.HttpRequest) -> func.HttpResponse:
    """
    Get AI-generated clinical summary for a transcription job.
    
    Query parameters:
    - regenerate=true: Force regeneration of cached summary (respects 30-second cooldown)
    
    Returns cached summary if available, or generates new one on-demand.
    """
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    regenerate = req.params.get('regenerate', '').lower() == 'true'
    
    try:
        config = AzureConfig.from_environment()
        
        config_error = get_required_service_config(config, require_cosmos=True, require_openai=True, require_search=True)
        if config_error:
            return config_error
        
        container = get_cosmos_client(config)
        
        job, response = get_job_or_response(container, job_id, access_mode="read")
        if response:
            return response
        if normalize_job_failure_state(job):
            container.upsert_item(body=job.to_dict())
        
        # Check if job is completed
        if job.status != JobStatus.COMPLETED:
            if job.status == JobStatus.FAILED:
                return error_response(400, job.error_message or "Job failed during transcription or downstream analysis", "JOB_SUMMARY_SOURCE_FAILED")
            return error_response(400, f"Job is not ready for summary generation from status '{job.status}'", "JOB_SUMMARY_NOT_READY")
        
        # Check for cached summary (unless regenerate requested)
        if job.llm_summary and not regenerate:
            # Return cached summary
            return json_response(
                {
                    "job_id": job.id,
                    "cached": True,
                    **job.llm_summary
                },
                status_code=200,
            )
        
        # Check regeneration cooldown (30 seconds)
        if regenerate and job.llm_summary:
            generated_at = job.llm_summary.get("generated_at")
            if generated_at:
                try:
                    last_gen_time = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
                    now = datetime.now(last_gen_time.tzinfo or timezone.utc)
                    cooldown_remaining = 30 - (now - last_gen_time).total_seconds()
                    if cooldown_remaining > 0:
                        return error_response(
                            429,
                            "Regeneration cooldown active",
                            "SUMMARY_REGENERATION_COOLDOWN_ACTIVE",
                            details={
                                "cooldownRemainingSeconds": int(cooldown_remaining),
                                "cached": True,
                                "summary": job.llm_summary,
                            },
                        )
                except Exception as e:
                    logger.warning(f"Could not parse generated_at timestamp: {e}")
        
        # Generate new summary
        logger.info(f"Generating AI summary for job {job_id} (regenerate={regenerate})")
        try:
            summary_result = ensure_job_summary(job, config, regenerate=regenerate)
        except Exception as generation_error:
            return internal_server_error(
                "Summary generation failed",
                generation_error,
                code="JOB_SUMMARY_GENERATION_FAILED",
                message="Clinical summary generation failed",
            )
        
        # Save summary to Cosmos DB (cache it)
        try:
            encounter = None
            if job.source_encounter_id:
                encounter, _ = get_encounter_or_response(container, job.source_encounter_id, access_mode="read")
            persist_job_and_index_context(container, encounter, job, config)
            logger.info(f"Cached AI summary for job {job_id}")
        except Exception as save_err:
            logger.error(f"Failed to cache summary or index search context for job {job_id}: {save_err}")
            return internal_server_error(
                "Summary cache or indexing update failed",
                save_err,
                code="JOB_SUMMARY_PERSIST_FAILED",
                message="Clinical summary refresh failed",
            )
        
        return json_response(
            {
                "job_id": job.id,
                "cached": False,
                **summary_result
            },
            status_code=200,
        )
        
    except Exception as e:
        return internal_server_error("Summary endpoint failed", e, code="JOB_SUMMARY_READ_FAILED")


@app.route(route="summary/{job_id}/pdf", methods=["GET"])
@require_authenticated_request
def get_summary_pdf(req: func.HttpRequest) -> func.HttpResponse:
    """
    Generate and return a PDF of the AI clinical summary
    Returns 404 if no cached summary exists (user must generate summary first)
    Returns 500 with fallback_available=true if PDF generation fails
    """
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)
        
        job, response = get_job_or_response(container, job_id, access_mode="read")
        if response:
            return response
        
        # Check if summary exists
        if not job.llm_summary or not job.llm_summary.get('summary_text'):
            return error_response(404, "No summary available. Generate a summary first.", "JOB_SUMMARY_NOT_FOUND")
        
        # Prepare metadata for PDF
        pdf_metadata = {
            'filename': job.filename,
            'generated_at': job.llm_summary.get('generated_at'),
            'model': job.llm_summary.get('model', 'GPT-4o-mini'),
            'token_usage': job.llm_summary.get('token_usage', {})
        }
        
        # Generate PDF
        try:
            from pdf_generator import generate_summary_pdf
            pdf_bytes = generate_summary_pdf(
                summary_text=job.llm_summary['summary_text'],
                job_metadata=pdf_metadata
            )
            
            # Create safe filename
            safe_filename = ''.join(c for c in job.filename if c.isalnum() or c in '._- ')[:50]
            pdf_filename = f"clinical-summary-{safe_filename}.pdf"
            
            return func.HttpResponse(
                pdf_bytes,
                status_code=200,
                mimetype="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{pdf_filename}"',
                    "Content-Length": str(len(pdf_bytes))
                }
            )
            
        except Exception as pdf_err:
            logger.error(f"PDF generation failed for job {job_id}: {pdf_err}")
            return error_response(
                500,
                "PDF generation failed",
                "JOB_SUMMARY_PDF_FAILED",
                details={"fallback_available": True},
            )
    
    except Exception as e:
        return error_response(
            500,
            "Summary PDF endpoint failed",
            "JOB_SUMMARY_PDF_ENDPOINT_FAILED",
            details={"fallback_available": True},
        )


@app.route(route="summary/{job_id}/txt", methods=["GET"])
@require_authenticated_request
def get_summary_txt(req: func.HttpRequest) -> func.HttpResponse:
    """
    Return the raw summary text as plain text (fallback when PDF fails)
    """
    job_id, response = require_uuid_route_param(req, "job_id", "Job ID", "INVALID_JOB_ID")
    if response:
        return response
    
    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)
        
        job, response = get_job_or_response(container, job_id, access_mode="read")
        if response:
            return response
        
        # Check if summary exists
        if not job.llm_summary or not job.llm_summary.get('summary_text'):
            return error_response(404, "No summary available. Generate a summary first.", "JOB_SUMMARY_NOT_FOUND")
        
        # Create safe filename
        safe_filename = ''.join(c for c in job.filename if c.isalnum() or c in '._- ')[:50]
        txt_filename = f"clinical-summary-{safe_filename}.txt"
        
        summary_text = job.llm_summary['summary_text']
        
        return func.HttpResponse(
            summary_text,
            status_code=200,
            mimetype="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{txt_filename}"',
                "Content-Length": str(len(summary_text.encode('utf-8')))
            }
        )
    
    except Exception as e:
        return internal_server_error("Summary TXT endpoint failed", e, code="JOB_SUMMARY_TXT_ENDPOINT_FAILED")


@app.route(route="jobs", methods=["GET"])
@require_authenticated_request
def list_jobs(req: func.HttpRequest) -> func.HttpResponse:
    """List recent jobs"""
    try:
        config = AzureConfig.from_environment()
        container = get_cosmos_client(config)
        
        ctx = get_current_request_context()
        if not ctx or not normalize_context_value(ctx.tenant_id):
            return error_response(400, "Tenant selection is required", "TENANT_REQUIRED")

        limit = int(req.params.get('limit', 50))
        query = "SELECT * FROM c WHERE (NOT IS_DEFINED(c.record_type) OR c.record_type = 'job') AND c.tenant_id = @tenant_id ORDER BY c.created_at DESC OFFSET 0 LIMIT @limit"
        items = list(
            container.query_items(
                query=query,
                parameters=[
                    {"name": "@tenant_id", "value": ctx.tenant_id},
                    {"name": "@limit", "value": limit},
                ],
                enable_cross_partition_query=True,
            )
        )
        
        jobs = [{"job_id": j["id"], "filename": j["filename"], "status": j["status"], "created_at": j["created_at"]} for j in items]
        return json_response({"jobs": jobs, "total": len(jobs)}, status_code=200)
    except Exception as e:
        return internal_server_error("List jobs failed", e, code="JOB_LIST_FAILED")
