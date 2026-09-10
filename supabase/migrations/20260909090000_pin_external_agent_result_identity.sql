-- Pin external result identity after first observation and validate result
-- provenance at the database boundary. Intentionally not applied until the
-- production database migration is explicitly approved.
begin;

alter table public.external_agent_jobs
  add constraint external_agent_jobs_pull_request_identity_check
  check (
    (pull_request_number is null) = (pull_request_url is null)
    and (
      pull_request_url is null
      or lower(pull_request_url) = lower(
        'https://github.com/' || repository || '/pull/' || pull_request_number::text
      )
    )
  );

create or replace function public.update_external_agent_job_result(
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
  v_current public.external_agent_jobs%rowtype;
  v_updated public.external_agent_jobs%rowtype;
  v_external_job_id text;
  v_branch_name text;
  v_commit_sha text;
  v_pull_request_number bigint;
  v_pull_request_url text;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_expected_pull_request_url text;
begin
  if p_status not in ('RUNNING', 'WAITING_HUMAN_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED') then
    raise exception 'invalid result status';
  end if;

  select * into v_current
  from public.external_agent_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'external agent job not found';
  end if;

  if v_current.external_job_id is not null
     and p_external_job_id is not null
     and v_current.external_job_id <> p_external_job_id then
    raise exception 'external job id does not match the dispatched job';
  end if;
  if v_current.branch_name is not null
     and p_branch_name is not null
     and v_current.branch_name <> p_branch_name then
    raise exception 'branch name cannot be replaced';
  end if;
  if v_current.commit_sha is not null
     and p_commit_sha is not null
     and lower(v_current.commit_sha) <> lower(p_commit_sha) then
    raise exception 'commit sha cannot be replaced';
  end if;
  if v_current.pull_request_number is not null
     and p_pull_request_number is not null
     and v_current.pull_request_number <> p_pull_request_number then
    raise exception 'pull request number cannot be replaced';
  end if;
  if v_current.pull_request_url is not null
     and p_pull_request_url is not null
     and lower(v_current.pull_request_url) <> lower(p_pull_request_url) then
    raise exception 'pull request url cannot be replaced';
  end if;

  v_external_job_id := coalesce(v_current.external_job_id, p_external_job_id);
  v_branch_name := coalesce(v_current.branch_name, p_branch_name);
  v_commit_sha := coalesce(v_current.commit_sha, p_commit_sha);
  v_pull_request_number := coalesce(v_current.pull_request_number, p_pull_request_number);
  v_pull_request_url := coalesce(v_current.pull_request_url, p_pull_request_url);

  if (v_pull_request_number is null) <> (v_pull_request_url is null) then
    raise exception 'pull request number and url must be supplied together';
  end if;
  if v_pull_request_number is not null then
    v_expected_pull_request_url := format(
      'https://github.com/%s/pull/%s',
      v_current.repository,
      v_pull_request_number
    );
    if lower(v_pull_request_url) <> lower(v_expected_pull_request_url) then
      raise exception 'pull request url does not match the authorized repository';
    end if;
  end if;

  v_started_at := case
    when v_current.started_at is not null and p_started_at is not null
      then least(v_current.started_at, p_started_at)
    else coalesce(v_current.started_at, p_started_at)
  end;
  if p_status = 'RUNNING' then
    v_started_at := coalesce(v_started_at, now());
  end if;

  v_completed_at := case
    when p_status in ('SUCCEEDED', 'FAILED', 'CANCELLED')
      then coalesce(v_current.completed_at, p_completed_at, now())
    else v_current.completed_at
  end;

  if v_started_at is not null
     and v_started_at < v_current.created_at - interval '5 minutes' then
    raise exception 'started_at predates the job';
  end if;
  if v_started_at is not null and v_started_at > now() + interval '5 minutes' then
    raise exception 'started_at is too far in the future';
  end if;
  if v_completed_at is not null and v_completed_at > now() + interval '5 minutes' then
    raise exception 'completed_at is too far in the future';
  end if;
  if v_started_at is not null
     and v_completed_at is not null
     and v_completed_at < v_started_at then
    raise exception 'completed_at cannot precede started_at';
  end if;

  update public.external_agent_jobs
  set status = p_status,
      external_job_id = v_external_job_id,
      branch_name = v_branch_name,
      commit_sha = v_commit_sha,
      pull_request_number = v_pull_request_number,
      pull_request_url = v_pull_request_url,
      result_summary = coalesce(p_result_summary, result_summary),
      error_code = coalesce(p_error_code, error_code),
      error_summary = coalesce(p_error_summary, error_summary),
      started_at = v_started_at,
      completed_at = v_completed_at
  where id = p_job_id
  returning * into v_updated;

  return to_jsonb(v_updated);
end
$$;

revoke all on function public.update_external_agent_job_result(
  uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_external_agent_job_result(
  uuid, text, text, text, text, bigint, text, text, text, text, timestamptz, timestamptz
) to service_role;

commit;
