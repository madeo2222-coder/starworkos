-- Apply a callback result and reserve its nonce in one transaction. Intentionally
-- not applied until the production database migration is explicitly approved.
begin;

create function public.apply_external_agent_job_callback(
  p_nonce text,
  p_job_id uuid,
  p_status text,
  p_external_job_id text default null,
  p_branch_name text default null,
  p_commit_sha text default null,
  p_pull_request_number bigint default null,
  p_pull_request_url text default null,
  p_result_summary text default null,
  p_error_code text default null,
  p_error_summary text default null,
  p_started_at timestamptz default null,
  p_completed_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job jsonb;
begin
  insert into public.external_agent_callback_nonces(nonce, received_at)
  values (p_nonce, now());

  select public.update_external_agent_job_result(
    p_job_id,
    p_status,
    p_external_job_id,
    p_branch_name,
    p_commit_sha,
    p_pull_request_number,
    p_pull_request_url,
    p_result_summary,
    p_error_code,
    p_error_summary,
    p_started_at,
    p_completed_at
  ) into v_job;

  return v_job;
end
$$;

revoke all on function public.apply_external_agent_job_callback(
  text, uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_external_agent_job_callback(
  text, uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz
) to service_role;

commit;
