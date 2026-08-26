-- Phase 1 external AI agent job contract. Stored locally; intentionally not applied.
begin;

create table public.external_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  ai_employee_id uuid not null references public.ai_employees(id) on delete restrict,
  provider text not null,
  capability text not null,
  repository text not null,
  base_branch text not null default 'main',
  requested_action text not null default 'software_development',
  status text not null default 'QUEUED',
  approval_requirement text not null default 'RESTRICTED_OPERATIONS_REQUIRE_HUMAN',
  started_at timestamptz,
  completed_at timestamptz,
  external_job_id text,
  branch_name text,
  commit_sha text,
  pull_request_number bigint,
  pull_request_url text,
  result_summary text,
  error_code text,
  error_summary text,
  retry_count integer not null default 0,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_agent_jobs_status_check check (status in ('QUEUED', 'RUNNING', 'WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  constraint external_agent_jobs_provider_check check (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint external_agent_jobs_capability_check check (capability ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint external_agent_jobs_repository_check check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  constraint external_agent_jobs_commit_check check (commit_sha is null or commit_sha ~ '^[0-9a-fA-F]{40}$'),
  constraint external_agent_jobs_retry_check check (retry_count >= 0),
  constraint external_agent_jobs_completion_check check ((status in ('SUCCEEDED', 'FAILED', 'CANCELLED') and completed_at is not null) or status not in ('SUCCEEDED', 'FAILED', 'CANCELLED'))
);

comment on table public.external_agent_jobs is 'Current state and external references only; execution_history remains the audit timeline.';
comment on column public.external_agent_jobs.approval_requirement is 'Main merge, production deploy/DB migration, secret changes, and destructive operations always require a human.';
create index external_agent_jobs_task_id_idx on public.external_agent_jobs(task_id, created_at desc);
create index external_agent_jobs_ai_employee_id_idx on public.external_agent_jobs(ai_employee_id);
create unique index external_agent_jobs_provider_external_id_idx on public.external_agent_jobs(provider, external_job_id) where external_job_id is not null;
create unique index external_agent_jobs_active_contract_idx on public.external_agent_jobs(task_id, capability, repository)
  where status in ('QUEUED', 'RUNNING', 'WAITING_HUMAN_APPROVAL');

alter table public.external_agent_jobs enable row level security;
-- Deliberately no table policies: browsers (anon/authenticated) cannot select or mutate jobs.
revoke all on table public.external_agent_jobs from anon, authenticated;
grant all on table public.external_agent_jobs to service_role;

create function public.guard_external_agent_job_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then raise exception 'terminal job cannot be updated'; end if;
  if not (
    (old.status = 'QUEUED' and new.status in ('RUNNING', 'CANCELLED')) or
    (old.status = 'RUNNING' and new.status in ('WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED')) or
    (old.status = 'WAITING_HUMAN_APPROVAL' and new.status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
  ) then raise exception 'invalid external agent job transition: % -> %', old.status, new.status; end if;
  if (new.task_id, new.ai_employee_id, new.provider, new.capability, new.repository, new.base_branch, new.requested_action, new.idempotency_key)
     is distinct from
     (old.task_id, old.ai_employee_id, old.provider, old.capability, old.repository, old.base_branch, old.requested_action, old.idempotency_key)
  then raise exception 'job contract fields are immutable'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_external_agent_job_update before update on public.external_agent_jobs for each row execute function public.guard_external_agent_job_update();

create function public.notify_external_agent_job_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid; v_suffix text; v_item_type text;
begin
  if new.status not in ('WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED') then return new; end if;
  select project_id into v_project_id from public.tasks where id = new.task_id;
  v_suffix := case new.status when 'WAITING_HUMAN_APPROVAL' then 'approval' when 'SUCCEEDED' then 'success' else 'failure' end;
  v_item_type := case when new.status = 'WAITING_HUMAN_APPROVAL' then 'APPROVAL_REQUEST' else 'REVIEW_REQUEST' end;
  insert into public.ceo_inbox(project_id, ai_employee_id, task_id, title, message, item_type, status, priority, dedupe_key, source_event, decision_context)
  values (v_project_id, new.ai_employee_id, new.task_id,
    case new.status when 'WAITING_HUMAN_APPROVAL' then 'External Agent Jobの承認が必要です' when 'SUCCEEDED' then 'External Agent Jobが完了しました' else 'External Agent Jobが失敗しました' end,
    coalesce(new.result_summary, new.error_summary, 'Job ' || new.id::text || ' の結果を確認してください。'),
    v_item_type, 'UNREAD', case when new.status = 'FAILED' then 'HIGH' else 'MEDIUM' end,
    'external-agent-job:' || new.id::text || ':' || v_suffix, 'EXTERNAL_AGENT_JOB_' || new.status,
    jsonb_build_object('external_agent_job_id', new.id, 'provider', new.provider, 'repository', new.repository, 'pull_request_url', new.pull_request_url))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
create trigger notify_external_agent_job_transition after update of status on public.external_agent_jobs
for each row when (old.status is distinct from new.status) execute function public.notify_external_agent_job_transition();

create function public.create_external_agent_job(
  p_task_id uuid, p_ai_employee_id uuid, p_provider text, p_capability text,
  p_repository text, p_base_branch text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks%rowtype; v_existing public.external_agent_jobs%rowtype; v_job public.external_agent_jobs%rowtype;
begin
  select * into v_existing from public.external_agent_jobs where idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.task_id, v_existing.ai_employee_id, v_existing.provider, v_existing.capability, v_existing.repository, v_existing.base_branch)
       is distinct from (p_task_id, p_ai_employee_id, p_provider, p_capability, p_repository, p_base_branch)
    then raise exception 'idempotency key conflicts with another request'; end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if v_task.status in ('COMPLETED', 'CANCELLED') then raise exception 'Task is not eligible for an external job'; end if;
  if not exists (select 1 from public.ai_employees where id = p_ai_employee_id) then raise exception 'AI Employee not found'; end if;
  if p_provider not in ('openai_codex', 'anthropic_claude_code') then raise exception 'Unsupported provider'; end if;
  if p_capability not in ('software_development', 'code_review', 'repository_analysis') then raise exception 'Unsupported capability'; end if;
  if p_repository !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then raise exception 'Invalid repository'; end if;
  insert into public.external_agent_jobs(task_id, ai_employee_id, provider, capability, repository, base_branch, idempotency_key)
  values (p_task_id, p_ai_employee_id, p_provider, p_capability, p_repository, p_base_branch, p_idempotency_key)
  returning * into v_job;
  return to_jsonb(v_job);
exception when unique_violation then
  select * into v_existing from public.external_agent_jobs where idempotency_key = p_idempotency_key;
  if not found then raise exception 'duplicate active external agent job'; end if;
  return to_jsonb(v_existing);
end $$;

create function public.update_external_agent_job_result(
  p_job_id uuid, p_status text, p_external_job_id text default null, p_branch_name text default null,
  p_commit_sha text default null, p_pull_request_number bigint default null, p_pull_request_url text default null,
  p_result_summary text default null, p_error_code text default null, p_error_summary text default null,
  p_started_at timestamptz default null, p_completed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.external_agent_jobs%rowtype;
begin
  if p_status not in ('RUNNING', 'WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED') then raise exception 'invalid result status'; end if;
  update public.external_agent_jobs set status = p_status, external_job_id = coalesce(p_external_job_id, external_job_id),
    branch_name = coalesce(p_branch_name, branch_name), commit_sha = coalesce(p_commit_sha, commit_sha),
    pull_request_number = coalesce(p_pull_request_number, pull_request_number), pull_request_url = coalesce(p_pull_request_url, pull_request_url),
    result_summary = coalesce(p_result_summary, result_summary), error_code = coalesce(p_error_code, error_code), error_summary = coalesce(p_error_summary, error_summary),
    started_at = case when p_status = 'RUNNING' then coalesce(p_started_at, started_at, now()) else coalesce(p_started_at, started_at) end,
    completed_at = case when p_status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then coalesce(p_completed_at, now()) else completed_at end
  where id = p_job_id returning * into v_job;
  if not found then raise exception 'external agent job not found'; end if;
  return to_jsonb(v_job);
end $$;

revoke all on function public.create_external_agent_job(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.create_external_agent_job(uuid, uuid, text, text, text, text, text) to authenticated;
revoke all on function public.update_external_agent_job_result(uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.update_external_agent_job_result(uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz) to service_role;

commit;
