-- STAR WORK OS Ver1.1 Task / Workflow status synchronization
-- This migration is stored locally and has not been applied.

-- A Task owns at most one Workflow in Ver1.1.
-- Migration intentionally fails here if duplicate task_id values already exist.
create unique index if not exists workflows_task_id_unique_idx
  on public.workflows(task_id)
  where task_id is not null;

create or replace function public.sync_task_status_from_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_step_requires_approval boolean := false;
begin
  if new.task_id is null then
    return new;
  end if;

  if new.status = 'DONE' then
    update public.tasks
    set status = 'COMPLETED'
    where id = new.task_id
      and status <> 'CANCELLED'
      and status <> 'COMPLETED';

    return new;
  end if;

  select coalesce(step.requires_human_approval, false)
  into current_step_requires_approval
  from public.workflow_steps as step
  where step.workflow_id = new.id
    and step.step_order = new.current_step_order
  limit 1;

  update public.tasks
  set status = case
    when current_step_requires_approval then 'WAITING'
    else 'IN_PROGRESS'
  end
  where id = new.task_id
    and status not in ('COMPLETED', 'CANCELLED');

  return new;
end;
$$;

drop trigger if exists sync_task_status_after_workflow_insert
  on public.workflows;

create trigger sync_task_status_after_workflow_insert
after insert on public.workflows
for each row
execute function public.sync_task_status_from_workflow();

drop trigger if exists sync_task_status_after_workflow_update
  on public.workflows;

create trigger sync_task_status_after_workflow_update
after update of status, current_step_order, task_id on public.workflows
for each row
when (
  old.status is distinct from new.status
  or old.current_step_order is distinct from new.current_step_order
  or old.task_id is distinct from new.task_id
)
execute function public.sync_task_status_from_workflow();

create or replace function public.sync_task_status_from_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workflow_id is null then
    return new;
  end if;

  if new.status = 'ERROR' then
    update public.tasks as task
    set status = 'WAITING'
    from public.workflows as workflow
    where workflow.id = new.workflow_id
      and workflow.task_id = task.id
      and workflow.status <> 'DONE'
      and task.status not in ('COMPLETED', 'CANCELLED');
  elsif new.status = 'RUNNING' then
    update public.tasks as task
    set status = 'IN_PROGRESS'
    from public.workflows as workflow
    where workflow.id = new.workflow_id
      and workflow.task_id = task.id
      and workflow.status <> 'DONE'
      and task.status not in ('COMPLETED', 'CANCELLED');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_task_status_after_execution_insert
  on public.execution_history;

create trigger sync_task_status_after_execution_insert
after insert on public.execution_history
for each row
when (new.status in ('RUNNING', 'ERROR'))
execute function public.sync_task_status_from_execution();

drop trigger if exists sync_task_status_after_execution_update
  on public.execution_history;

create trigger sync_task_status_after_execution_update
after update of status on public.execution_history
for each row
when (
  old.status is distinct from new.status
  and new.status in ('RUNNING', 'ERROR')
)
execute function public.sync_task_status_from_execution();

-- Bring already-linked Tasks into the same state when this migration is applied.
with desired_task_status as (
  select
    workflow.task_id,
    case
      when workflow.status = 'DONE' then 'COMPLETED'
      when coalesce(step.requires_human_approval, false) then 'WAITING'
      else 'IN_PROGRESS'
    end as status
  from public.workflows as workflow
  left join public.workflow_steps as step
    on step.workflow_id = workflow.id
    and step.step_order = workflow.current_step_order
  where workflow.task_id is not null
)
update public.tasks as task
set status = desired.status
from desired_task_status as desired
where task.id = desired.task_id
  and task.status <> 'CANCELLED'
  and task.status is distinct from desired.status;
