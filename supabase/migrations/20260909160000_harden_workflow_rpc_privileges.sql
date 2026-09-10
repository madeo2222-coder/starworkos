-- Ensure browser-callable Workflow mutation RPCs cannot bypass table RLS.
-- Service-role-only external callback functions intentionally remain SECURITY
-- DEFINER because they perform their own authorization and are not granted to
-- browser roles.
-- This migration is stored locally and has not been applied.

begin;

do $$
begin
  if exists (
    select 1
    from (
      values
        ('workflows'),
        ('workflow_steps'),
        ('workflow_messages'),
        ('ceo_inbox')
    ) as required_table(table_name)
    left join pg_catalog.pg_namespace as namespace
      on namespace.nspname = 'public'
    left join pg_catalog.pg_class as relation
      on relation.relnamespace = namespace.oid
      and relation.relname = required_table.table_name
      and relation.relkind in ('r', 'p')
    where relation.oid is null
       or relation.relrowsecurity is distinct from true
  ) then
    raise exception 'WORKFLOW_RLS_REQUIRED';
  end if;
end;
$$;

alter function public.complete_current_workflow_step(uuid, text)
  security invoker;

revoke all on function public.complete_current_workflow_step(uuid, text)
  from public, anon;

grant execute on function public.complete_current_workflow_step(uuid, text)
  to authenticated;

alter function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
)
  security invoker;

revoke all on function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
)
  from public, anon;

grant execute on function public.resolve_ceo_inbox_item(
  uuid,
  text,
  text,
  text,
  timestamptz
)
  to authenticated;

commit;
