CREATE OR REPLACE FUNCTION public.create_development_workflow(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_ceo_instruction text,
  p_priority text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_workflow_id uuid;
  v_ai_pm_id uuid;
  v_ai_architect_id uuid;
  v_ai_developer_id uuid;
  v_ai_qa_id uuid;
  v_ai_knowledge_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'WORKFLOW_TITLE_REQUIRED';
  end if;

  if nullif(trim(p_ceo_instruction), '') is null then
    raise exception 'CEO_INSTRUCTION_REQUIRED';
  end if;

  if p_priority not in (
    '低',
    '中',
    '高'
  ) then
    raise exception 'INVALID_PRIORITY';
  end if;

  if p_project_id is not null
     and not exists (
       select 1
       from public.projects
       where id = p_project_id
     ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  select id
  into v_ai_pm_id
  from public.ai_employees
  where name = 'AI PM';

  select id
  into v_ai_architect_id
  from public.ai_employees
  where name = 'AI Architect';

  select id
  into v_ai_developer_id
  from public.ai_employees
  where name = 'AI Developer';

  select id
  into v_ai_qa_id
  from public.ai_employees
  where name = 'AI QA';

  select id
  into v_ai_knowledge_id
  from public.ai_employees
  where name = 'AI Knowledge';

  if v_ai_pm_id is null then
    raise exception 'AI_PM_NOT_FOUND';
  end if;

  if v_ai_architect_id is null then
    raise exception 'AI_ARCHITECT_NOT_FOUND';
  end if;

  if v_ai_developer_id is null then
    raise exception 'AI_DEVELOPER_NOT_FOUND';
  end if;

  if v_ai_qa_id is null then
    raise exception 'AI_QA_NOT_FOUND';
  end if;

  if v_ai_knowledge_id is null then
    raise exception 'AI_KNOWLEDGE_NOT_FOUND';
  end if;

  insert into public.workflows (
    project_id,
    title,
    description,
    status,
    priority,
    current_step_order
  )
  values (
    p_project_id,
    trim(p_title),
    nullif(trim(p_description), ''),
    'IN_PROGRESS',
    p_priority,
    1
  )
  returning id into v_workflow_id;

  insert into public.workflow_steps (
    workflow_id,
    step_order,
    name,
    status,
    assigned_ai_employee_id,
    requires_human_approval,
    ceo_instruction,
    started_at
  )
  values
    (
      v_workflow_id,
      1,
      '要件整理',
      'IN_PROGRESS',
      v_ai_pm_id,
      false,
      trim(p_ceo_instruction),
      now()
    ),
    (
      v_workflow_id,
      2,
      '設計',
      'READY',
      v_ai_architect_id,
      true,
      null,
      null
    ),
    (
      v_workflow_id,
      3,
      '実装',
      'READY',
      v_ai_developer_id,
      false,
      null,
      null
    ),
    (
      v_workflow_id,
      4,
      '品質確認',
      'READY',
      v_ai_qa_id,
      true,
      null,
      null
    ),
    (
      v_workflow_id,
      5,
      'ナレッジ化',
      'READY',
      v_ai_knowledge_id,
      false,
      null,
      null
    );

  insert into public.workflow_messages (
    workflow_id,
    workflow_step_id,
    ai_employee_id,
    sender_type,
    message_type,
    content,
    created_by_user_id
  )
  select
    v_workflow_id,
    ws.id,
    v_ai_pm_id,
    'CEO',
    'MESSAGE',
    trim(p_ceo_instruction),
    auth.uid()
  from public.workflow_steps ws
  where ws.workflow_id = v_workflow_id
    and ws.step_order = 1;

  return v_workflow_id;
end;
$function$;
