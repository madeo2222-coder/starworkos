-- STAR WORK OS Phase2-A
-- CEO Inbox decision foundation and atomic approval/rejection processing.
-- Existing ceo_inbox columns are preserved and reused where appropriate.

begin;

-- Existing columns already present:
-- project_id, workflow_id, workflow_step_id, ai_employee_id,
-- ceo_comment, read_at, resolved_at.
--
-- Add only the missing decision/audit columns.

alter table public.ceo_inbox
  add column if not exists task_id uuid null,
  add column if not exists processed_by_user_id uuid null,
  add column if not exists decision text null,
  add column if not exists response text null,
  add column if not exists reason text null,
  add column if not exists dedupe_key text null,
  add column if not exists source_event text null,
  add column if not exists decision_context jsonb null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ceo_inbox_task_id_fkey'
      and conrelid = 'public.ceo_inbox'::regclass
  ) then
    alter table public.ceo_inbox
      add constraint ceo_inbox_task_id_fkey
      foreign key (task_id)
      references public.tasks(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ceo_inbox_decision_check'
      and conrelid = 'public.ceo_inbox'::regclass
  ) then
    alter table public.ceo_inbox
      add constraint ceo_inbox_decision_check
      check (
        decision is null
        or decision in (
          'APPROVED',
          'REJECTED',
          'RETURNED',
          'ANSWERED',
          'ACKNOWLEDGED',
          'KNOWLEDGE_APPROVED'
        )
      );
  end if;
end;
$$;

create unique index if not exists ceo_inbox_dedupe_key_unique_idx
  on public.ceo_inbox (dedupe_key)
  where dedupe_key is not null;

create index if not exists ceo_inbox_status_priority_created_idx
  on public.ceo_inbox (status, priority, created_at desc);

create index if not exists ceo_inbox_workflow_id_idx
  on public.ceo_inbox (workflow_id);

create index if not exists ceo_inbox_workflow_step_id_idx
  on public.ceo_inbox (workflow_step_id);

create index if not exists ceo_inbox_task_id_idx
  on public.ceo_inbox (task_id);

create index if not exists ceo_inbox_ai_employee_id_idx
  on public.ceo_inbox (ai_employee_id);

create index if not exists ceo_inbox_project_id_idx
  on public.ceo_inbox (project_id);

create or replace function public.set_ceo_inbox_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_ceo_inbox_updated_at
  on public.ceo_inbox;

create trigger set_ceo_inbox_updated_at
before update on public.ceo_inbox
for each row
execute function public.set_ceo_inbox_updated_at();

-- Only backfill values that are deterministically available
-- through the linked Workflow.
update public.ceo_inbox as inbox
set
  task_id = coalesce(inbox.task_id, workflow.task_id),
  project_id = coalesce(inbox.project_id, workflow.project_id)
from public.workflows as workflow
where workflow.id = inbox.workflow_id
  and (
    (inbox.task_id is null and workflow.task_id is not null)
    or
    (inbox.project_id is null and workflow.project_id is not null)
  );

create or replace function public.resolve_ceo_inbox_item(
  p_inbox_id uuid,
  p_decision text,
  p_response text default null,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  inbox_record public.ceo_inbox%rowtype;
  workflow_record public.workflows%rowtype;
  step_record public.workflow_steps%rowtype;
  normalized_response text;
  normalized_reason text;
  resolved_message text;
  combined_comment text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_inbox_id is null then
    raise exception 'INBOX_ITEM_NOT_FOUND';
  end if;

  if p_decision is null
     or p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'INVALID_DECISION';
  end if;

  normalized_response :=
    nullif(btrim(coalesce(p_response, '')), '');

  normalized_reason :=
    nullif(btrim(coalesce(p_reason, '')), '');

  select *
  into inbox_record
  from public.ceo_inbox
  where id = p_inbox_id
  for update;

  if not found then
    raise exception 'INBOX_ITEM_NOT_FOUND';
  end if;

  if inbox_record.status <> 'UNREAD' then
    raise exception 'INBOX_ITEM_ALREADY_PROCESSED';
  end if;

  if inbox_record.item_type <> 'APPROVAL_REQUEST' then
    raise exception 'UNSUPPORTED_INBOX_ITEM_TYPE';
  end if;

  if p_expected_updated_at is not null
     and inbox_record.updated_at is distinct from p_expected_updated_at then
    raise exception 'INBOX_ITEM_CHANGED';
  end if;

  if inbox_record.workflow_id is null then
    raise exception 'WORKFLOW_NOT_FOUND';
  end if;

  -- Never infer a historical notification's STEP from the current STEP.
  -- An approval notification must explicitly identify its target STEP.
  if inbox_record.workflow_step_id is null then
    raise exception 'WORKFLOW_STEP_NOT_FOUND';
  end if;

  select *
  into workflow_record
  from public.workflows
  where id = inbox_record.workflow_id;

  if not found then
    raise exception 'WORKFLOW_NOT_FOUND';
  end if;

  select *
  into step_record
  from public.workflow_steps
  where id = inbox_record.workflow_step_id
    and workflow_id = workflow_record.id;

  if not found then
    raise exception 'WORKFLOW_STEP_MISMATCH';
  end if;

  if step_record.step_order is distinct from workflow_record.current_step_order then
    raise exception 'WORKFLOW_ALREADY_ADVANCED';
  end if;

  if not coalesce(step_record.requires_human_approval, false) then
    raise exception 'APPROVAL_NOT_REQUIRED';
  end if;

  if p_decision = 'APPROVED' then
    update public.workflow_steps
    set
      requires_human_approval = false,
      approved_at = now(),
      approved_by = current_user_id::text,
      updated_at = now()
    where id = step_record.id
      and workflow_id = workflow_record.id
      and requires_human_approval = true;

    if not found then
      raise exception 'APPROVAL_NOT_REQUIRED';
    end if;

    resolved_message := 'CEOが承認しました。';
  else
    -- REJECTED:
    -- Do not advance the Workflow.
    -- Do not change requires_human_approval.
    -- Do not cancel the linked Task.
    resolved_message := 'CEOが却下しました。';
  end if;

  if normalized_response is not null then
    resolved_message :=
      resolved_message || E'\n回答: ' || normalized_response;
  end if;

  if normalized_reason is not null then
    resolved_message :=
      resolved_message || E'\n理由: ' || normalized_reason;
  end if;

  combined_comment := concat_ws(
    E'\n',
    case
      when normalized_response is not null
        then '回答: ' || normalized_response
      else null
    end,
    case
      when normalized_reason is not null
        then '理由: ' || normalized_reason
      else null
    end
  );

  if combined_comment = '' then
    combined_comment := null;
  end if;

  insert into public.workflow_messages (
    workflow_id,
    workflow_step_id,
    sender_type,
    message_type,
    content,
    created_by_user_id
  )
  values (
    workflow_record.id,
    step_record.id,
    'CEO',
    'APPROVAL_RESULT',
    resolved_message,
    current_user_id
  );

  update public.ceo_inbox
  set
    status = 'READ',
    task_id = coalesce(task_id, workflow_record.task_id),
    project_id = coalesce(project_id, workflow_record.project_id),
    decision = p_decision,
    response = normalized_response,
    reason = normalized_reason,
    ceo_comment = coalesce(combined_comment, ceo_comment),
    read_at = coalesce(read_at, now()),
    resolved_at = now(),
    processed_by_user_id = current_user_id,
    updated_at = now()
  where id = inbox_record.id
    and status = 'UNREAD';

  if not found then
    raise exception 'INBOX_ITEM_ALREADY_PROCESSED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'inbox_id', inbox_record.id,
    'workflow_id', workflow_record.id,
    'workflow_step_id', step_record.id,
    'task_id', workflow_record.task_id,
    'decision', p_decision,
    'status', 'READ'
  );
end;
$$;

revoke all on function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
) from public;

revoke all on function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
) from anon;

grant execute on function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
) to authenticated;

commit;
