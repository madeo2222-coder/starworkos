-- STAR WORK OS Ver1.1 Task Center
-- This migration is intentionally stored locally and has not been applied.

alter table public.tasks
  add column if not exists content text,
  add column if not exists due_date date,
  add column if not exists assigned_ai_employee_id uuid
    references public.ai_employees(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.tasks
  drop constraint if exists tasks_status_check;

update public.tasks
set status = case status
  when 'BACKLOG' then 'NEW'
  when 'READY' then 'NEW'
  when 'HUMAN_REVIEW' then 'WAITING'
  when 'BLOCKED' then 'WAITING'
  when 'DONE' then 'COMPLETED'
  else status
end;

alter table public.tasks
  add constraint tasks_status_check
  check (
    status in (
      'NEW',
      'PLANNING',
      'IN_PROGRESS',
      'WAITING',
      'COMPLETED',
      'CANCELLED'
    )
  );

alter table public.tasks
  alter column status set default 'NEW';

alter table public.workflows
  add column if not exists task_id uuid
    references public.tasks(id) on delete set null;

create index if not exists tasks_status_idx
  on public.tasks(status);

create index if not exists tasks_due_date_idx
  on public.tasks(due_date);

create index if not exists tasks_assigned_ai_employee_id_idx
  on public.tasks(assigned_ai_employee_id);

create index if not exists workflows_task_id_idx
  on public.workflows(task_id);

create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;

create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_tasks_updated_at();
