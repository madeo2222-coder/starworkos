-- Prevent duplicate OpenAI calls for the same Workflow STEP.
-- Stored locally for review; intentionally not applied by this change.
begin;

-- Fail closed if production already contains conflicting active executions.
-- An operator must inspect them instead of this migration choosing a winner.
do $$
begin
  if exists (
    select 1
    from public.execution_history
    where workflow_step_id is not null
      and status = 'RUNNING'
    group by workflow_step_id
    having count(*) > 1
  ) then
    raise exception 'CONCURRENT_WORKFLOW_AI_RUNS_EXIST';
  end if;
end;
$$;

create unique index if not exists execution_history_one_running_per_step_idx
  on public.execution_history (workflow_step_id)
  where workflow_step_id is not null
    and status = 'RUNNING';

comment on index public.execution_history_one_running_per_step_idx is
  'Allows at most one active AI execution for each Workflow STEP.';

commit;
