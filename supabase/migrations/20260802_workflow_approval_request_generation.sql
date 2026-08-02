-- STAR WORK OS Phase2-A
-- Generate CEO approval requests when a Workflow enters an approval STEP.
-- Resume the Workflow automatically after CEO approval.

begin;

create or replace function public.resume_workflow_after_step_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.requires_human_approval = true
     and new.requires_human_approval = false
     and new.approved_at is not null then

    update public.workflow_steps
    set
      status = 'IN_PROGRESS',
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id = new.id
      and status = 'HUMAN_REVIEW';

    update public.workflows
    set
      status = 'IN_PROGRESS',
      current_step_order = new.step_order,
      updated_at = now()
    where id = new.workflow_id
      and current_step_order = new.step_order
      and status = 'HUMAN_REVIEW';
  end if;

  return new;
end;
$$;

drop trigger if exists resume_workflow_after_step_approval
  on public.workflow_steps;

create trigger resume_workflow_after_step_approval
after update of requires_human_approval, approved_at
on public.workflow_steps
for each row
execute function public.resume_workflow_after_step_approval();

create or replace function public.complete_current_workflow_step(
  p_workflow_id uuid,
  p_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.workflows%rowtype;
  v_current_step public.workflow_steps%rowtype;
  v_next_step public.workflow_steps%rowtype;
  v_inbox_exists boolean;
  v_approval_inbox_id uuid;
  v_approval_title text;
  v_approval_message text;
  v_dedupe_key text;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select *
  into v_workflow
  from public.workflows
  where id = p_workflow_id
  for update;

  if not found then
    raise exception 'WORKFLOW_NOT_FOUND';
  end if;

  if v_workflow.status = 'DONE' then
    raise exception 'WORKFLOW_ALREADY_COMPLETED';
  end if;

  select *
  into v_current_step
  from public.workflow_steps
  where workflow_id = p_workflow_id
    and step_order = v_workflow.current_step_order
  for update;

  if not found then
    raise exception 'CURRENT_STEP_NOT_FOUND';
  end if;

  if v_current_step.requires_human_approval
     and v_current_step.approved_at is null then
    raise exception 'HUMAN_APPROVAL_REQUIRED';
  end if;

  update public.workflow_steps
  set
    status = 'DONE',
    result = coalesce(p_result, result),
    completed_at = now(),
    updated_at = now()
  where id = v_current_step.id;

  select *
  into v_next_step
  from public.workflow_steps
  where workflow_id = p_workflow_id
    and step_order > v_current_step.step_order
  order by step_order asc
  limit 1
  for update;

  if found then
    if coalesce(v_next_step.requires_human_approval, false)
       and v_next_step.approved_at is null then

      update public.workflow_steps
      set
        status = 'HUMAN_REVIEW',
        updated_at = now()
      where id = v_next_step.id;

      update public.workflows
      set
        status = 'HUMAN_REVIEW',
        current_step_order = v_next_step.step_order,
        updated_at = now()
      where id = p_workflow_id;

      v_dedupe_key :=
        'workflow-approval:'
        || v_workflow.id::text
        || ':'
        || v_next_step.id::text;

      v_approval_title :=
        '承認依頼：'
        || v_workflow.title
        || ' / STEP'
        || v_next_step.step_order
        || ' '
        || v_next_step.name;

      v_approval_message :=
        'Workflow「'
        || v_workflow.title
        || '」がSTEP'
        || v_next_step.step_order
        || '「'
        || v_next_step.name
        || '」へ進みました。'
        || E'\n\nこのSTEPを開始するにはCEOの承認が必要です。';

      insert into public.ceo_inbox (
        project_id,
        workflow_id,
        workflow_step_id,
        ai_employee_id,
        task_id,
        title,
        message,
        item_type,
        status,
        priority,
        dedupe_key,
        source_event,
        decision_context
      )
      values (
        v_workflow.project_id,
        v_workflow.id,
        v_next_step.id,
        v_next_step.assigned_ai_employee_id,
        v_workflow.task_id,
        v_approval_title,
        v_approval_message,
        'APPROVAL_REQUEST',
        'UNREAD',
        'HIGH',
        v_dedupe_key,
        'WORKFLOW_STEP_APPROVAL_REQUIRED',
        jsonb_build_object(
          'workflow_id', v_workflow.id,
          'workflow_step_id', v_next_step.id,
          'step_order', v_next_step.step_order,
          'step_name', v_next_step.name
        )
      )
      on conflict (dedupe_key)
      where dedupe_key is not null
      do nothing
      returning id into v_approval_inbox_id;

      if v_approval_inbox_id is not null then
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
          v_next_step.id,
          v_next_step.assigned_ai_employee_id,
          'AI_EMPLOYEE',
          'APPROVAL_REQUEST',
          v_approval_message,
          null
        );
      end if;

      return jsonb_build_object(
        'ok', true,
        'workflow_status', 'HUMAN_REVIEW',
        'completed_step_order', v_current_step.step_order,
        'current_step_order', v_next_step.step_order,
        'approval_required', true,
        'approval_inbox_id', v_approval_inbox_id
      );
    end if;

    update public.workflow_steps
    set
      status = 'IN_PROGRESS',
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id = v_next_step.id;

    update public.workflows
    set
      status = 'IN_PROGRESS',
      current_step_order = v_next_step.step_order,
      updated_at = now()
    where id = p_workflow_id;

    return jsonb_build_object(
      'ok', true,
      'workflow_status', 'IN_PROGRESS',
      'completed_step_order', v_current_step.step_order,
      'current_step_order', v_next_step.step_order,
      'approval_required', false
    );
  end if;

  update public.workflows
  set
    status = 'DONE',
    current_step_order = v_current_step.step_order,
    updated_at = now()
  where id = p_workflow_id;

  select exists (
    select 1
    from public.ceo_inbox
    where workflow_id = v_workflow.id
      and item_type = 'REVIEW_REQUEST'
      and title = 'Workflow完了：' || v_workflow.title
  )
  into v_inbox_exists;

  if not v_inbox_exists then
    insert into public.ceo_inbox (
      project_id,
      workflow_id,
      workflow_step_id,
      ai_employee_id,
      task_id,
      title,
      message,
      item_type,
      status,
      priority
    )
    values (
      v_workflow.project_id,
      v_workflow.id,
      v_current_step.id,
      v_current_step.assigned_ai_employee_id,
      v_workflow.task_id,
      'Workflow完了：' || v_workflow.title,
      case
        when v_current_step.deliverable is not null
             and trim(v_current_step.deliverable) <> ''
        then
          'WorkflowがSTEP'
          || v_current_step.step_order
          || 'まで完了しました。'
          || E'\n\n最終成果物：\n'
          || v_current_step.deliverable
        else
          'WorkflowがSTEP'
          || v_current_step.step_order
          || 'まで完了しました。内容を確認してください。'
      end,
      'REVIEW_REQUEST',
      'UNREAD',
      'HIGH'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'workflow_status', 'DONE',
    'completed_step_order', v_current_step.step_order,
    'current_step_order', null,
    'approval_required', false
  );
end;
$$;

commit;
