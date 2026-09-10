-- Phase 2 audit integration for External Agent Jobs.
-- Intentionally not applied to Production until explicitly approved.
begin;

alter table public.execution_history
  add column if not exists external_agent_job_id uuid
  references public.external_agent_jobs(id) on delete set null;

create unique index if not exists execution_history_external_agent_job_id_uidx
  on public.execution_history(external_agent_job_id)
  where external_agent_job_id is not null;

create or replace function public.sync_external_agent_job_execution_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution_status text;
  v_error_message text;
begin
  if new.status = 'RUNNING' then
    insert into public.execution_history(
      external_agent_job_id,
      ai_employee_id,
      model,
      action,
      status,
      started_at
    ) values (
      new.id,
      new.ai_employee_id,
      'external:' || new.provider,
      'External Agent: ' || new.capability,
      'RUNNING',
      coalesce(new.started_at, now())
    )
    on conflict (external_agent_job_id) where external_agent_job_id is not null
    do update set
      ai_employee_id = excluded.ai_employee_id,
      model = excluded.model,
      action = excluded.action,
      status = 'RUNNING',
      started_at = coalesce(public.execution_history.started_at, excluded.started_at),
      completed_at = null,
      error_message = null;

    return new;
  end if;

  if new.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
    v_execution_status := case when new.status = 'SUCCEEDED' then 'SUCCESS' else 'ERROR' end;
    v_error_message := case
      when new.status = 'SUCCEEDED' then null
      else coalesce(new.error_summary, new.error_code, 'External Agent Job ' || new.status)
    end;

    update public.execution_history
    set
      status = v_execution_status,
      completed_at = coalesce(new.completed_at, now()),
      error_message = v_error_message
    where external_agent_job_id = new.id;

    if not found then
      insert into public.execution_history(
        external_agent_job_id,
        ai_employee_id,
        model,
        action,
        status,
        error_message,
        started_at,
        completed_at
      ) values (
        new.id,
        new.ai_employee_id,
        'external:' || new.provider,
        'External Agent: ' || new.capability,
        v_execution_status,
        v_error_message,
        coalesce(new.started_at, new.created_at, now()),
        coalesce(new.completed_at, now())
      )
      on conflict (external_agent_job_id) where external_agent_job_id is not null
      do update set
        status = excluded.status,
        completed_at = excluded.completed_at,
        error_message = excluded.error_message;
    end if;
  end if;

  return new;
end $$;

revoke all on function public.sync_external_agent_job_execution_history() from public, anon, authenticated;
grant execute on function public.sync_external_agent_job_execution_history() to service_role;

drop trigger if exists sync_external_agent_job_execution_history_insert on public.external_agent_jobs;
create trigger sync_external_agent_job_execution_history_insert
after insert on public.external_agent_jobs
for each row execute function public.sync_external_agent_job_execution_history();

drop trigger if exists sync_external_agent_job_execution_history_update on public.external_agent_jobs;
create trigger sync_external_agent_job_execution_history_update
after update of status on public.external_agent_jobs
for each row
when (old.status is distinct from new.status)
execute function public.sync_external_agent_job_execution_history();

commit;
