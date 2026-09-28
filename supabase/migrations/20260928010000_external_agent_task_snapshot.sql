begin;

alter table public.external_agent_jobs
  add column if not exists task_snapshot jsonb;

comment on column public.external_agent_jobs.task_snapshot is
  'Immutable snapshot of the source Task captured for external-agent dispatch.';

create or replace function public.capture_external_agent_task_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task jsonb;
begin
  if new.task_snapshot is not null then
    return new;
  end if;

  select to_jsonb(t) into v_task
  from public.tasks as t
  where t.id = new.task_id;

  if v_task is null then
    raise exception 'Task not found for external agent snapshot';
  end if;

  new.task_snapshot := v_task;
  return new;
end;
$$;

drop trigger if exists capture_external_agent_task_snapshot on public.external_agent_jobs;
create trigger capture_external_agent_task_snapshot
before insert on public.external_agent_jobs
for each row execute function public.capture_external_agent_task_snapshot();

-- Existing jobs are intentionally not backfilled here. The table has an update
-- guard that rejects no-op status transitions, so mutating legacy RUNNING jobs
-- during activation would fail the migration. New jobs are snapshotted by the
-- BEFORE INSERT trigger above; legacy jobs remain untouched and fail closed if
-- dispatched without a snapshot.

alter table public.external_agent_jobs
  add constraint external_agent_jobs_task_snapshot_object_check
  check (task_snapshot is null or jsonb_typeof(task_snapshot) = 'object');

revoke all on function public.capture_external_agent_task_snapshot() from public, anon, authenticated;
grant execute on function public.capture_external_agent_task_snapshot() to service_role;

commit;
