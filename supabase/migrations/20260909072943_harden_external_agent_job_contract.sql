-- Mirror the public API limits at the database boundary. The job-creation RPC
-- is callable by authenticated users, so table constraints remain the final
-- guard if a caller bypasses the Next.js route.
begin;

alter table public.external_agent_jobs
  add constraint external_agent_jobs_repository_length_check
    check (char_length(repository) between 3 and 200),
  add constraint external_agent_jobs_base_branch_length_check
    check (char_length(base_branch) between 1 and 255),
  add constraint external_agent_jobs_base_branch_format_check
    check (
      base_branch ~ '^[A-Za-z0-9._/-]+$'
      and base_branch !~ '^[-/]'
      and base_branch !~ '[/.]$'
      and base_branch !~ '(^|/)\.'
      and base_branch !~ '\.\.'
      and base_branch !~ '//'
      and base_branch !~ '\.lock(/|$)'
    ),
  add constraint external_agent_jobs_idempotency_key_length_check
    check (char_length(idempotency_key) between 1 and 200),
  add constraint external_agent_jobs_external_job_id_length_check
    check (external_job_id is null or char_length(external_job_id) between 1 and 200),
  add constraint external_agent_jobs_branch_name_length_check
    check (branch_name is null or char_length(branch_name) between 1 and 255),
  add constraint external_agent_jobs_branch_name_format_check
    check (
      branch_name is null or (
        branch_name ~ '^[A-Za-z0-9._/-]+$'
        and branch_name !~ '^[-/]'
        and branch_name !~ '[/.]$'
        and branch_name !~ '(^|/)\.'
        and branch_name !~ '\.\.'
        and branch_name !~ '//'
        and branch_name !~ '\.lock(/|$)'
      )
    ),
  add constraint external_agent_jobs_pull_request_number_check
    check (pull_request_number is null or pull_request_number > 0),
  add constraint external_agent_jobs_pull_request_url_check
    check (
      pull_request_url is null or (
        char_length(pull_request_url) between 1 and 500
        and pull_request_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]*$'
      )
    ),
  add constraint external_agent_jobs_result_summary_length_check
    check (result_summary is null or char_length(result_summary) <= 16384),
  add constraint external_agent_jobs_error_code_check
    check (error_code is null or (char_length(error_code) <= 128 and error_code ~ '^[A-Z][A-Z0-9_]*$')),
  add constraint external_agent_jobs_error_summary_length_check
    check (error_summary is null or char_length(error_summary) <= 16384),
  add constraint external_agent_jobs_approval_requirement_check
    check (approval_requirement = 'RESTRICTED_OPERATIONS_REQUIRE_HUMAN');

create or replace function public.guard_external_agent_job_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
    raise exception 'terminal job cannot be updated';
  end if;

  if not (
    (old.status = 'QUEUED' and new.status in ('RUNNING', 'CANCELLED')) or
    (old.status = 'RUNNING' and new.status in ('WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED')) or
    (old.status = 'WAITING_HUMAN_APPROVAL' and new.status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
  ) then
    raise exception 'invalid external agent job transition: % -> %', old.status, new.status;
  end if;

  if (
    new.task_id,
    new.ai_employee_id,
    new.provider,
    new.capability,
    new.repository,
    new.base_branch,
    new.requested_action,
    new.approval_requirement,
    new.idempotency_key
  ) is distinct from (
    old.task_id,
    old.ai_employee_id,
    old.provider,
    old.capability,
    old.repository,
    old.base_branch,
    old.requested_action,
    old.approval_requirement,
    old.idempotency_key
  ) then
    raise exception 'job contract fields are immutable';
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.guard_external_agent_job_update() from public, anon, authenticated;

commit;
