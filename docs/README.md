# QTIP Documentation

Product, feature, and operational documentation. The repo's quick-start
lives at the [top-level README](../README.md); deploy templates live in
[`deploy/`](../deploy/README.md); shell scripts in
[`scripts/`](../scripts/README.md).

> Time-bound migration / phase / status reports were removed during the
> pre-production cleanup (review item #57). Their content lives in git
> history if you need to retrieve it.

---

## Project basics

- [`project_overview.md`](./project_overview.md) — system objective, roles, architecture
- [`design.md`](./design.md) — design decisions
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — backend + frontend architecture
- [`CHANGELOG.md`](./CHANGELOG.md) — change log

## Production / operations

- [`PRODUCTION_READINESS_GUIDE.md`](./PRODUCTION_READINESS_GUIDE.md) — production checklist
- [`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md) — deploy / runbook
- [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md) — winston / PM2 logging
- [`audit_logging.md`](./audit_logging.md) — application audit trail
- [`multiple_database_connections.md`](./multiple_database_connections.md) — DB connection topology
- [`database_schema_updates.md`](./database_schema_updates.md) — schema change process

## Role dashboards

- [`admin_dashboard.md`](./admin_dashboard.md)
- [`csr_dashboard.md`](./csr_dashboard.md)
- [`csr_training_dashboard.md`](./csr_training_dashboard.md)
- [`director_dashboard.md`](./director_dashboard.md)
- [`manager_dashboard.md`](./manager_dashboard.md)
- [`qa_dashboard.md`](./qa_dashboard.md)
- [`trainer_dashboard.md`](./trainer_dashboard.md)

## QA workflows

- [`qa_assigned_reviews.md`](./qa_assigned_reviews.md)
- [`qa_manual_reviews.md`](./qa_manual_reviews.md)
- [`qa_form_reference.md`](./qa_form_reference.md)
- [`qa_submissions_api.md`](./qa_submissions_api.md) — QA audit submission API
- [`form_api_examples.md`](./form_api_examples.md)
- [`form_builder_instructions.md`](./form_builder_instructions.md)
- [`scoring_preview.md`](./scoring_preview.md) — form-preview scoring panel
- [`audit_assignment.md`](./audit_assignment.md)
- [`audit_assignment_api_examples.md`](./audit_assignment_api_examples.md)

## CSR workflows

- [`csr_my_audits.md`](./csr_my_audits.md)
- [`csr_dispute_history.md`](./csr_dispute_history.md)
- [`csr_certificates.md`](./csr_certificates.md)

## Manager / Director workflows

- [`director_assignment.md`](./director_assignment.md)
- [`director_dispute_resolution.md`](./director_dispute_resolution.md)
- [`manager_coaching_sessions.md`](./manager_coaching_sessions.md)
- [`manager_dispute_resolution.md`](./manager_dispute_resolution.md)
- [`manager_performance_reports.md`](./manager_performance_reports.md)
- [`manager_team_audits.md`](./manager_team_audits.md)
- [`manager_team_training.md`](./manager_team_training.md)

## Training / LMS

- [`lms_trainer_workflow.md`](./lms_trainer_workflow.md)
- [`trainer_assign_training.md`](./trainer_assign_training.md)
- [`trainer_assign_training_component.md`](./trainer_assign_training_component.md) — component reference
- [`trainer_feedback_review.md`](./trainer_feedback_review.md)
- [`trainer_reports.md`](./trainer_reports.md)

## Analytics & reports

- [`analytics_builder.md`](./analytics_builder.md)
- [`analytics_comparison_summary.md`](./analytics_comparison_summary.md)
- [`performance_goals.md`](./performance_goals.md)

## Admin / system

- [`user_management.md`](./user_management.md)
- [`department_management.md`](./department_management.md)
- [`navigation_overview.md`](./navigation_overview.md)
- [`profile_settings.md`](./profile_settings.md)
- [`help_center.md`](./help_center.md)
- [`phone_system_integration.md`](./phone_system_integration.md)
- [`ADMIN_COMPONENTS_README.md`](./ADMIN_COMPONENTS_README.md)

## Testing

- [`test_plan.md`](./test_plan.md)

## Insights validation

- [`insights-validation/quality.md`](./insights-validation/quality.md)

## Implementation instructions

See [`instructions/`](./instructions) for in-depth feature implementation
notes (form builder, scoring logic, trainer course creation, etc.).

## Frontend conventions

- [`frontend_query_keys.md`](./frontend_query_keys.md) — TanStack Query
  key conventions (domain-first tuples, how to invalidate safely).

---

## Conventions

- File names use `snake_case.md`. The `.markdown` extension is
  deprecated — see review item #61.
- Stale, time-bound, or duplicate documents are deleted (not archived
  in-tree); git history is the archive.
- When you add a new document, add it to the appropriate section above
  in the same PR.
