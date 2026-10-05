/** The 39 prototype entities (reference/ascentra.html, DATA_MODEL) as tables, plus F6's four safeguard tables B1's two billing tables and B4's notices and privacy requests, and L1's source chunks, open-license list and AI call log. */
export const EXPECTED_TABLES = [
  "accounts", "profiles", "role_assignments", "guardian_relationships", "trusted_devices", "session_events",
  "subscriptions", "trial_consents", "entitlements", "academies", "courses", "academy_blueprints", "modules",
  "lessons", "skills", "sources", "source_claims", "source_conflicts", "authority_decisions",
  "learning_activities", "assessment_attempts", "assignments", "projects", "capstones", "review_items",
  "schedules", "progress_records", "mastery_records", "retention_signals", "mentor_threads", "notes", "uploads",
  "world_preferences", "notification_preferences", "legal_document_versions", "consent_records",
  "safety_events", "audit_events", "connection_statuses",
  "sharing_signals", "sharing_flags", "enforcement_steps", "appeals",
  "billing_customers", "billing_events",
  "notices", "privacy_requests",
  "source_chunks", "open_license_sources", "ai_calls",
  // L2
  "research_runs", "lesson_versions",
].sort();
