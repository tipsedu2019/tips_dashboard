-- Raw provider and application error text may contain upstream diagnostics.
-- Keep only structured status/error-code columns; future writers persist fixed codes.
update public.gemini_api_keys
set last_error = null
where last_error is not null;

update public.gemini_api_usage_logs
set error_message = null
where error_message is not null;
