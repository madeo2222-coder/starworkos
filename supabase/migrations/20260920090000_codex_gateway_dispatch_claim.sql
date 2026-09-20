begin;

create table if not exists public.codex_gateway_dispatches (
  job_id uuid primary key references public.external_agent_jobs(id) on delete cascade,
  contract_digest text not null,
  issue_number bigint,
  issue_url text,
  claimed_at timestamptz not null default now(),
  delegated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint codex_gateway_dispatches_digest_check check (contract_digest ~ '^[0-9a-f]{64}$'),
  constraint codex_gateway_dispatches_issue_check check (issue_number is null or issue_number > 0)
);

alter table public.codex_gateway_dispatches enable row level security;
revoke all on table public.codex_gateway_dispatches from public, anon, authenticated;
grant all on table public.codex_gateway_dispatches to service_role;

create or replace function public.claim_codex_gateway_dispatch(
  p_job_id uuid,
  p_contract_digest text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.codex_gateway_dispatches%rowtype;
  v_inserted boolean := false;
begin
  if p_contract_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid codex gateway contract digest';
  end if;

  insert into public.codex_gateway_dispatches(job_id, contract_digest)
  values (p_job_id, p_contract_digest)
  on conflict (job_id) do nothing
  returning * into v_row;
  v_inserted := found;

  if v_inserted then
    return jsonb_build_object(
      'claimed', true,
      'issue_number', v_row.issue_number,
      'issue_url', v_row.issue_url
    );
  end if;

  select * into v_row
  from public.codex_gateway_dispatches
  where job_id = p_job_id
  for update;

  if not found then
    raise exception 'codex gateway dispatch claim not found';
  end if;

  if v_row.contract_digest <> p_contract_digest then
    raise exception 'codex gateway contract digest mismatch';
  end if;

  if v_row.issue_number is not null then
    return jsonb_build_object(
      'claimed', false,
      'issue_number', v_row.issue_number,
      'issue_url', v_row.issue_url
    );
  end if;

  if v_row.claimed_at <= now() - interval '2 minutes' then
    update public.codex_gateway_dispatches
    set claimed_at = now(), updated_at = now()
    where job_id = p_job_id;

    return jsonb_build_object('claimed', true, 'issue_number', null, 'issue_url', null);
  end if;

  return jsonb_build_object('claimed', false, 'issue_number', null, 'issue_url', null);
end;
$$;

create or replace function public.record_codex_gateway_issue(
  p_job_id uuid,
  p_contract_digest text,
  p_issue_number bigint,
  p_issue_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.codex_gateway_dispatches%rowtype;
begin
  if p_issue_number < 1 then raise exception 'invalid codex gateway issue number'; end if;
  if p_issue_url !~ '^https://github\.com/' then raise exception 'invalid codex gateway issue url'; end if;

  select * into v_row
  from public.codex_gateway_dispatches
  where job_id = p_job_id
  for update;

  if not found then raise exception 'codex gateway dispatch claim not found'; end if;
  if v_row.contract_digest <> p_contract_digest then raise exception 'codex gateway contract digest mismatch'; end if;
  if v_row.issue_number is not null and v_row.issue_number <> p_issue_number then
    raise exception 'codex gateway issue identity mismatch';
  end if;

  update public.codex_gateway_dispatches
  set issue_number = p_issue_number,
      issue_url = p_issue_url,
      delegated_at = coalesce(delegated_at, now()),
      updated_at = now()
  where job_id = p_job_id
  returning * into v_row;

  return jsonb_build_object(
    'issue_number', v_row.issue_number,
    'issue_url', v_row.issue_url
  );
end;
$$;

revoke all on function public.claim_codex_gateway_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_codex_gateway_dispatch(uuid, text) to service_role;
revoke all on function public.record_codex_gateway_issue(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_codex_gateway_issue(uuid, text, bigint, text) to service_role;

commit;
