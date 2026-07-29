-- STAR WORK OS Ver1.1
-- Atomic Task-to-Workflow creation and STEP-aware Task status correction.
-- This migration is stored locally and has not been applied.

create or replace function public.create_development_workflow(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_ceo_instruction text,
  p_priority text,
  p_task_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task_status text;
  claimed_task_id uuid;
  created_workflow_id uuid;
  linked_workflow_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_task_id is null then
    raise exception 'TASK_ID_REQUIRED';
  end if;

  select task.status
  into task_status
  from public.tasks as task
  where task.id = p_task_id;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if task_status <> 'NEW' then
    raise exception 'TASK_STATUS_MUST_BE_NEW';
  end if;

  if exists (
    select 1
    from public.workflows as workflow
    where workflow.task_id = p_task_id
  ) then
    raise exception 'TASK_WORKFLOW_ALREADY_EXISTS';
  end if;

  update public.tasks
  set status = 'PLANNING'
  where id = p_task_id
    and status = 'NEW'
  returning id into claimed_task_id;

  if claimed_task_id is null then
    raise exception 'TASK_STATE_CHANGED';
  end if;

  created_workflow_id :=
    public.create_development_workflow(
      p_project_id => p_project_id,
      p_title => p_title,
      p_description => p_description,
      p_ceo_instruction => p_ceo_instruction,
      p_priority => p_priority
    );

  if created_workflow_id is null then
    raise exception 'WORKFLOW_ID_NOT_RETURNED';
  end if;

  update public.workflows
  set task_id = p_task_id
  where id = created_workflow_id
    and task_id is null
  returning id into linked_workflow_id;

  if linked_workflow_id is null then
    raise exception 'WORKFLOW_TASK_LINK_FAILED';
  end if;

  return created_workflow_id;
end;
$$;

revoke all on function public.create_development_workflow(
  uuid,
  text,
  text,
  text,
  text,
  uuid
) from public;

grant execute on function public.create_development_workflow(
  uuid,
  text,
  text,
  text,
  text,
  uuid
) to authenticated;

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
      and status not in ('COMPLETED', 'CANCELLED');

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
    when coalesce(new.current_step_order, 1) <= 1 then 'PLANNING'
    else 'IN_PROGRESS'
  end
  where id = new.task_id
    and status not in ('COMPLETED', 'CANCELLED');

  return new;
end;
$$;

create or replace function public.sync_task_status_from_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  execution_step_order integer;
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

    return new;
  end if;

  if new.status = 'RUNNING' then
    select step.step_order
    into execution_step_order
    from public.workflow_steps as step
    where step.id = new.workflow_step_id
      and step.workflow_id = new.workflow_id;

    update public.tasks as task
    set status = case
      when coalesce(
        execution_step_order,
        workflow.current_step_order,
        1
      ) <= 1 then 'PLANNING'
      else 'IN_PROGRESS'
    end
    from public.workflows as workflow
    where workflow.id = new.workflow_id
      and workflow.task_id = task.id
      and workflow.status <> 'DONE'
      and task.status not in ('COMPLETED', 'CANCELLED');
  end if;

  return new;
end;
$$;

-- Correct already-linked Tasks without changing explicitly cancelled Tasks.
with desired_task_status as (
  select
    workflow.task_id,
    case
      when workflow.status = 'DONE' then 'COMPLETED'
      when coalesce(step.requires_human_approval, false) then 'WAITING'
      when current_task.status = 'WAITING' then 'WAITING'
      when coalesce(workflow.current_step_order, 1) <= 1 then 'PLANNING'
      else 'IN_PROGRESS'
    end as status
  from public.workflows as workflow
  join public.tasks as current_task
    on current_task.id = workflow.task_id
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
