-- WhatsApp Business Account (WABA) connected directly to Meta's WhatsApp Cloud API.
-- The business access token returned by Embedded Signup is stored AES-256-GCM encrypted
-- (src/lib/whatsapp/crypto.ts); the encryption key and Meta app secret live in env only.

create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  verified_name text,
  quality_rating text,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  access_token_enc text,
  webhook_subscribed boolean not null default false,
  last_error text,
  connected_by uuid references public.app_users(id),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_number_id)
);
-- A phone number can belong to only one org: inbound webhooks are routed by phone_number_id.
create unique index whatsapp_accounts_phone_active_idx on public.whatsapp_accounts (phone_number_id) where status <> 'disconnected';

create table public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  account_id uuid references public.whatsapp_accounts(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound', 'status', 'account')),
  wa_message_id text,
  counterparty text,
  message_type text,
  status text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index whatsapp_events_org_idx on public.whatsapp_events (organization_id, created_at desc);
-- Meta retries deliveries: one row per (message id, direction, status).
create unique index whatsapp_events_dedupe_idx on public.whatsapp_events (wa_message_id, direction, coalesce(status, ''))
  where wa_message_id is not null;

alter table public.whatsapp_accounts enable row level security;
alter table public.whatsapp_events enable row level security;
-- No policies: only the server (service role) reads or writes these tables.

create trigger whatsapp_accounts_touch before update on public.whatsapp_accounts
  for each row execute function public.touch_updated_at();
