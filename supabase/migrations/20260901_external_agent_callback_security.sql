-- Phase 2 callback replay protection. Intentionally not applied until approved.
begin;

create table public.external_agent_callback_nonces (
  nonce text primary key,
  received_at timestamptz not null default now(),
  constraint external_agent_callback_nonces_length_check check (char_length(nonce) between 16 and 200)
);

alter table public.external_agent_callback_nonces enable row level security;
revoke all on table public.external_agent_callback_nonces from public, anon, authenticated;
grant all on table public.external_agent_callback_nonces to service_role;

create index external_agent_callback_nonces_received_at_idx
  on public.external_agent_callback_nonces(received_at);

commit;
