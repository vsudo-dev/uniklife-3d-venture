-- Direct Meta ingestion and durable worker logs. Secrets stay in server variables.
create table public.meta_lead_forms (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 venture_id uuid not null references public.ventures(id) on delete cascade,
 page_id text not null check (page_id ~ '^[0-9]+$'),
 form_id text not null unique check (form_id ~ '^[0-9]+$'),
 enabled boolean not null default true,
 poll_since timestamptz not null default (now() - interval '1 day'),
 poll_cursor text,
 poll_window_since timestamptz,
 poll_window_end timestamptz,
 last_polled_at timestamptz,
 next_poll_at timestamptz not null default now(),
 poll_failures integer not null default 0,
 last_error text,
 created_at timestamptz not null default now()
);
create table public.meta_leads (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 form_connection_id uuid not null references public.meta_lead_forms(id) on delete cascade,
 lead_id text not null unique,
 enquiry_id uuid references public.enquiries(id) on delete set null,
 status text not null default 'pending' check (status in ('pending','processing','imported','failed','needs_review')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error text,
 created_at timestamptz not null default now(),
 imported_at timestamptz
);
create index meta_leads_queue_idx on public.meta_leads(status,next_attempt_at);
create table public.integration_sync_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 source text not null,
 status text not null check (status in ('running','completed','failed','skipped')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 processed integer not null default 0,
 details jsonb not null default '{}'
);
create index integration_sync_runs_org_idx on public.integration_sync_runs(organization_id,started_at desc);
create unique index integration_sync_runs_active_org on public.integration_sync_runs(organization_id) where status='running';
alter table public.organizations add column next_agent_number integer not null default 1;
create table public.agents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 agent_code text not null,
 full_name text not null,
 phone text,
 email text,
 linked_employee_id uuid references public.employees(id) on delete set null,
 reporting_agent_id uuid references public.agents(id),
 commission_level integer not null default 8 check (commission_level between 1 and 8),
 status text not null default 'active' check (status in ('active','inactive')),
 created_at timestamptz not null default now(),
 unique(organization_id,agent_code),
 unique(organization_id,linked_employee_id)
);
create table public.incentive_policies (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 audience text not null check (audience in ('employee','agent')),
 config jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(organization_id,audience)
);
create table public.organization_smtp (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 host text not null,
 port integer not null check (port in (465,587)),
 username text not null,
 from_email text not null,
 from_name text not null,
 enabled boolean not null default false,
 verified_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
create table public.message_deliveries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 notification_id uuid not null references public.notifications(id) on delete cascade,
 channel text not null check (channel in ('smtp','whatsapp')),
 status text not null default 'pending' check (status in ('pending','processing','sent','failed','blocked','unknown')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error text,
 external_reference text,
 created_at timestamptz not null default now(),
 unique(notification_id,channel)
);
alter table public.meta_lead_forms enable row level security;
alter table public.meta_leads enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.agents enable row level security;
alter table public.incentive_policies enable row level security;
alter table public.organization_smtp enable row level security;
alter table public.message_deliveries enable row level security;
-- Service/server access only, matching the existing application's server authorization.
