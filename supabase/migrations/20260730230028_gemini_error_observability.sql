-- Sanitized Gemini failure observability.
-- Never store upstream bodies, headers, prompts, responses, phone numbers or credentials.

alter table public.beauty_ai_runs
  add column if not exists error_phase text,
  add column if not exists upstream_http_status integer,
  add column if not exists error_category text,
  add column if not exists retryable boolean;

alter table public.beauty_ai_runs
  drop constraint if exists beauty_ai_runs_error_phase_check,
  add constraint beauty_ai_runs_error_phase_check
    check (
      error_phase is null
      or error_phase in ('model_metadata', 'generate_content', 'tool_followup_generate_content')
    ),
  drop constraint if exists beauty_ai_runs_upstream_http_status_check,
  add constraint beauty_ai_runs_upstream_http_status_check
    check (
      upstream_http_status is null
      or upstream_http_status between 100 and 599
    ),
  drop constraint if exists beauty_ai_runs_error_category_check,
  add constraint beauty_ai_runs_error_category_check
    check (
      error_category is null
      or error_category in (
        'authentication',
        'not_found',
        'rate_limit',
        'client_error',
        'server_error',
        'network_error'
      )
    );

comment on column public.beauty_ai_runs.error_phase is
  'Sanitized phase only; never contains upstream text or request data.';
comment on column public.beauty_ai_runs.upstream_http_status is
  'Numeric upstream HTTP status only; null for network and non-HTTP failures.';
comment on column public.beauty_ai_runs.error_category is
  'Sanitized fixed-category classification; never stores an upstream error body.';
comment on column public.beauty_ai_runs.retryable is
  'Diagnostic retry eligibility. No automatic retry is performed by this migration.';
