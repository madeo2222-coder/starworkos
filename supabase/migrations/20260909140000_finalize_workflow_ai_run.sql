-- Persist a completed Workflow AI run as one transaction.
-- This migration is stored locally and has not been applied.

begin;

create or replace function public.finalize_workflow_ai_run(
  p_execution_history_id uuid,
  p_workflow_id uuid,
  p_workflow_step_id uuid,
  p_work_note text,
  p_deliverable text,
  p_message_content text,
  p_duration_ms bigint,
  p_prompt_tokens bigint default null,
  p_completion_tokens bigint default null,
  p_total_tokens bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_execution public.execution_history%rowtype;
  v_step public.workflow_steps%rowtype;
  v_workflow public.workflows%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_execution_history_id is null
     or p_workflow_id is null
     or p_workflow_step_id is null then
    raise exception 'WORKFLOW_AI_ID_REQUIRED';
  end if;

  if p_work_note is null
     or length(btrim(p_work_note)) = 0
     or length(btrim(p_work_note)) > 24000 then
    raise exception 'INVALID_WORK_NOTE';
  end if;

  if p_deliverable is null
     or length(btrim(p_deliverable)) = 0
     or length(btrim(p_deliverable)) > 40000 then
    raise exception 'INVALID_DELIVERABLE';
  end if;

  if p_message_content is null
     or length(btrim(p_message_content)) = 0
     or length(p_message_content) > 64100 then
    raise exception 'INVALID_MESSAGE_CONTENT';
  end if;

  if p_duration_ms is null
     or p_duration_ms < 0
     or p_duration_ms > 600000 then
    raise exception 'INVALID_DURATION';
  end if;

  if coalesce(p_prompt_tokens, 0) < 0
     or coalesce(p_completion_tokens, 0) < 0
     or coalesce(p_total_tokens, 0) < 0 then
    raise exception 'INVALID_TOKEN_USAGE';
  end if;

  -- Keep the same lock order as start_workflow_ai_run to avoid a finalize/retry
  -- deadlock: Workflow, STEP, then execution history.
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
  into v_execution
  from public.execution_history
  where id = p_execution_history_id
  for update;

  if not found then
    raise exception 'EXECUTION_HISTORY_NOT_FOUND';
  end if;

  if v_execution.status <> 'RUNNING' then
    raise exception 'EXECUTION_HISTORY_NOT_RUNNING';
  end if;

  if v_execution.workflow_id is distinct from p_workflow_id
     or v_execution.workflow_step_id is distinct from p_workflow_step_id then
    raise exception 'EXECUTION_HISTORY_MISMATCH';
  end if;

  update public.workflow_steps
  set
    work_note = btrim(p_work_note),
    deliverable = btrim(p_deliverable),
    updated_at = now()
  where id = v_step.id
    and workflow_id = v_workflow.id;

  insert into public.workflow_messages (
    workflow_id,
    workflow_step_id,
    ai_employee_id,
    sender_type,
    message_type,
    content,
    created_by_user_id
  )
  values (
    v_workflow.id,
    v_step.id,
    v_execution.ai_employee_id,
    'AI_EMPLOYEE',
    'HANDOFF',
    p_message_content,
    v_user_id
  );

  update public.execution_history
  set
    status = 'SUCCESS',
    duration_ms = p_duration_ms,
    prompt_tokens = p_prompt_tokens,
    completion_tokens = p_completion_tokens,
    total_tokens = p_total_tokens,
    completed_at = now(),
    error_message = null
  where id = v_execution.id
    and status = 'RUNNING';

  if not found then
    raise exception 'EXECUTION_HISTORY_STATE_CHANGED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'execution_history_id', v_execution.id,
    'workflow_id', v_workflow.id,
    'workflow_step_id', v_step.id
  );
end;
$$;

revoke all on function public.finalize_workflow_ai_run(
  uuid, uuid, uuid, text, text, text, bigint, bigint, bigint, bigint
) from public, anon;

grant execute on function public.finalize_workflow_ai_run(
  uuid, uuid, uuid, text, text, text, bigint, bigint, bigint, bigint
) to authenticated;

commit;
