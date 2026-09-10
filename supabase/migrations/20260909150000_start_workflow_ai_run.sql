-- Claim a Workflow AI run atomically and recover abandoned RUNNING rows.
-- The OpenAI request timeout is two minutes, so a five-minute lease leaves a
-- conservative buffer before an abandoned execution can be replaced.
-- This migration is stored locally and has not been applied.

begin;

create or replace function public.start_workflow_ai_run(
  p_workflow_id uuid,
  p_workflow_step_id uuid,
  p_model text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workflow public.workflows%rowtype;
  v_step public.workflow_steps%rowtype;
  v_existing_execution public.execution_history%rowtype;
  v_execution_id uuid;
  v_stale_duration_ms bigint;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_workflow_id is null or p_workflow_step_id is null then
    raise exception 'WORKFLOW_AI_ID_REQUIRED';
  end if;

  if p_model is null
     or length(btrim(p_model)) = 0
     or length(btrim(p_model)) > 100
     or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
    raise exception 'INVALID_AI_MODEL';
  end if;

  select *
  into v_workflow
  from public.workflows
  where id = p_workflow_id
  for update;

  if not found then
    raise exception 'WORKFLOW_NOT_FOUND';
  end if;

  select *
  into v_step
  from public.workflow_steps
  where id = p_workflow_step_id
    and workflow_id = p_workflow_id
  for update;

  if not found then
    raise exception 'WORKFLOW_STEP_NOT_FOUND';
  end if;

  if v_workflow.status <> 'IN_PROGRESS'
     or v_workflow.current_step_order is distinct from v_step.step_order
     or v_step.status <> 'IN_PROGRESS' then
    raise exception 'WORKFLOW_STEP_STATE_CHANGED';
  end if;

  if coalesce(v_step.requires_human_approval, false)
     and v_step.approved_at is null then
    raise exception 'HUMAN_APPROVAL_REQUIRED';
  end if;

  select *
  into v_existing_execution
  from public.execution_history
  where workflow_step_id = v_step.id
    and status = 'RUNNING'
  for update;

  if found then
    if v_existing_execution.started_at is not null
       and v_existing_execution.started_at > now() - interval '5 minutes' then
      raise exception 'WORKFLOW_AI_ALREADY_RUNNING';
    end if;

    v_stale_duration_ms := least(
      2147483647::numeric,
      greatest(
        0::numeric,
        extract(
          epoch from now() - coalesce(
            v_existing_execution.started_at,
            v_existing_execution.created_at,
            now()
          )
        ) * 1000
      )
    )::bigint;

    update public.execution_history
    set
      status = 'ERROR',
      duration_ms = v_stale_duration_ms,
      completed_at = now(),
      error_message = 'AI実行が規定時間を超過したため、安全に再実行可能な状態へ復旧しました。'
    where id = v_existing_execution.id
      and status = 'RUNNING';

    if not found then
      raise exception 'EXECUTION_HISTORY_STATE_CHANGED';
    end if;
  end if;

  insert into public.execution_history (
    workflow_id,
    workflow_step_id,
    ai_employee_id,
    model,
    action,
    status,
    started_at
  )
  values (
    v_workflow.id,
    v_step.id,
    v_step.assigned_ai_employee_id,
    btrim(p_model),
    'STEP ' || v_step.step_order || '：' || v_step.name,
    'RUNNING',
    now()
  )
  returning id into v_execution_id;

  return jsonb_build_object(
    'ok', true,
    'execution_history_id', v_execution_id,
    'recovered_stale_execution_id',
      case
        when v_existing_execution.id is null then null
        else v_existing_execution.id
      end
  );
end;
$$;

revoke all on function public.start_workflow_ai_run(
  uuid, uuid, text
) from public, anon;

grant execute on function public.start_workflow_ai_run(
  uuid, uuid, text
) to authenticated;

commit;
