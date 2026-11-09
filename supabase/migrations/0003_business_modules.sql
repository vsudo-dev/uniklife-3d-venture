-- Commissions (8-level plans, ledger, settlements, finance reconciliation),
-- notifications, follow-up reminders, site visits, push subscriptions and
-- white-label tenant domains.

-- ---------------------------------------------------------------------------
-- Tenant domains (white-label PWA routing)
-- ---------------------------------------------------------------------------
create table public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{2,5})?$'),
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index organization_domains_domain_key on public.organization_domains (lower(domain));
create unique index organization_domains_one_primary on public.organization_domains (organization_id) where is_primary;

-- ---------------------------------------------------------------------------
-- Commission plans (versioned, approved, effective-dated)
-- ---------------------------------------------------------------------------
create table public.commission_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'superseded', 'rejected')),
  -- differential: each upline earns its level rate minus the highest rate already paid below it in the chain.
  -- full_rate:    each eligible person earns its full level rate.
  calculation_method text not null default 'differential' check (calculation_method in ('differential', 'full_rate')),
  pay_selling_employee boolean not null default true,
  -- When true, the Level 1 (CEO) rate is an entitlement paid in full in addition to the chain payouts.
  ceo_separate_entitlement boolean not null default false,
  max_payable_levels integer not null default 8 check (max_payable_levels between 1 and 8),
  effective_from timestamptz,
  effective_to timestamptz,
  notes text,
  created_by uuid references public.app_users(id),
  submitted_by uuid references public.app_users(id),
  submitted_at timestamptz,
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, version),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (status not in ('active', 'superseded') or (approved_by is not null and approved_at is not null and effective_from is not null))
);
-- At most one approved plan without an end date per organization.
create unique index commission_plans_one_open on public.commission_plans (organization_id)
  where status in ('active', 'superseded') and effective_to is null;
alter table public.commission_plans add constraint commission_plans_org_id_key unique (organization_id, id);

create table public.commission_plan_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  level integer not null check (level between 1 and 8),
  label text not null,
  rate_per_sq_yard numeric(12,2) not null check (rate_per_sq_yard >= 0),
  is_eligible boolean not null default true,
  unique (plan_id, level),
  foreign key (organization_id, plan_id) references public.commission_plans (organization_id, id) on delete cascade
);

create table public.commission_plan_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.commission_plans(id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'submitted', 'approved', 'rejected', 'superseded')),
  actor_user_id uuid references public.app_users(id),
  note text,
  created_at timestamptz not null default now()
);
create index commission_plan_approvals_plan_idx on public.commission_plan_approvals (plan_id, created_at desc);

-- Levels of a non-draft plan are frozen; activation requires 8 strictly descending rates.
create or replace function public.guard_commission_plan_levels() returns trigger
language plpgsql
as $$
declare
  plan_status text;
begin
  select status into plan_status from public.commission_plans where id = coalesce(new.plan_id, old.plan_id);
  if plan_status is not null and plan_status <> 'draft' then
    raise exception 'levels of a % commission plan cannot be modified', plan_status using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

create trigger commission_plan_levels_guard before insert or update or delete on public.commission_plan_levels
  for each row execute function public.guard_commission_plan_levels();

create or replace function public.guard_commission_plan() returns trigger
language plpgsql
as $$
declare
  n integer;
  violations integer;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    if old.status <> 'pending_approval' then
      raise exception 'only a plan pending approval can be activated' using errcode = 'P0001';
    end if;
    if new.approved_by is not distinct from new.submitted_by then
      raise exception 'a commission plan must be approved by someone other than its submitter' using errcode = 'P0001';
    end if;
    select count(*) into n from public.commission_plan_levels where plan_id = new.id;
    if n <> 8 then
      raise exception 'commission plan must define exactly 8 levels (found %)', n using errcode = 'P0001';
    end if;
    select count(*) into violations
      from public.commission_plan_levels a
      join public.commission_plan_levels b on b.plan_id = a.plan_id and b.level = a.level + 1
     where a.plan_id = new.id and b.rate_per_sq_yard >= a.rate_per_sq_yard;
    if violations > 0 then
      raise exception 'commission rates must strictly descend from level 1 to level 8' using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('active', 'superseded') then
    if new.calculation_method is distinct from old.calculation_method
       or new.pay_selling_employee is distinct from old.pay_selling_employee
       or new.ceo_separate_entitlement is distinct from old.ceo_separate_entitlement
       or new.max_payable_levels is distinct from old.max_payable_levels
       or new.effective_from is distinct from old.effective_from
       or new.approved_by is distinct from old.approved_by then
      raise exception 'an approved commission plan is immutable; create a new version' using errcode = 'P0001';
    end if;
    if old.effective_to is not null and new.effective_to is distinct from old.effective_to then
      raise exception 'end date of a closed commission plan cannot change' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

create trigger commission_plans_guard before update on public.commission_plans
  for each row execute function public.guard_commission_plan();

-- ---------------------------------------------------------------------------
-- Commission settlements, ledger & finance reconciliation
-- ---------------------------------------------------------------------------
create table public.commission_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  period_type text not null check (period_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'finance_requested', 'paid', 'cancelled')),
  total_amount numeric(16,2) not null default 0 check (total_amount >= 0),
  entry_count integer not null default 0,
  created_by uuid references public.app_users(id),
  submitted_by uuid references public.app_users(id),
  submitted_at timestamptz,
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  finance_requested_at timestamptz,
  finance_reference text,
  payment_confirmation_source text check (payment_confirmation_source is null or payment_confirmation_source in ('authorized_confirmation', 'finance_reconciliation')),
  payment_reference text,
  paid_confirmed_by uuid references public.app_users(id),
  paid_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference),
  check (period_end >= period_start),
  -- Paid only with a human confirmation (direct or by accepting a finance reconciliation).
  check (status <> 'paid' or (payment_confirmation_source is not null and paid_confirmed_by is not null and paid_at is not null))
);
create unique index commission_settlements_period_key on public.commission_settlements (organization_id, period_type, period_start)
  where status <> 'cancelled';
alter table public.commission_settlements add constraint commission_settlements_org_id_key unique (organization_id, id);

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null,
  plan_id uuid not null,
  plan_version integer not null,
  employee_id uuid not null,
  beneficiary_role text not null check (beneficiary_role in ('seller', 'upline', 'ceo_entitlement')),
  chain_depth integer not null check (chain_depth >= 0),
  employee_level integer not null check (employee_level between 1 and 8),
  level_rate numeric(12,2) not null check (level_rate >= 0),
  payable_rate numeric(12,2) not null check (payable_rate >= 0),
  area_sq_yards numeric(12,2) not null check (area_sq_yards > 0),
  amount numeric(16,2) not null check (amount >= 0),
  status text not null default 'calculated' check (status in ('calculated', 'approved', 'rejected', 'settled', 'paid', 'reversed')),
  settlement_id uuid,
  hierarchy_snapshot jsonb not null,
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  rejected_reason text,
  reversed_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, booking_id) references public.bookings (organization_id, id),
  foreign key (organization_id, plan_id) references public.commission_plans (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id),
  foreign key (organization_id, settlement_id) references public.commission_settlements (organization_id, id),
  check (amount = round(payable_rate * area_sq_yards, 2))
);
-- One live entry per booking/employee/role — recalculation can never double-pay.
create unique index commission_entries_one_live on public.commission_entries (booking_id, employee_id, beneficiary_role)
  where status not in ('rejected', 'reversed');
create index commission_entries_employee_idx on public.commission_entries (employee_id, status);
create index commission_entries_settlement_idx on public.commission_entries (settlement_id);

create or replace function public.guard_commission_entry() returns trigger
language plpgsql
as $$
begin
  if new.amount is distinct from old.amount or new.payable_rate is distinct from old.payable_rate
     or new.level_rate is distinct from old.level_rate or new.employee_id is distinct from old.employee_id
     or new.booking_id is distinct from old.booking_id or new.area_sq_yards is distinct from old.area_sq_yards
     or new.plan_id is distinct from old.plan_id or new.hierarchy_snapshot is distinct from old.hierarchy_snapshot then
    raise exception 'commission ledger amounts are immutable; reverse and recalculate instead' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'calculated' and new.status in ('approved', 'rejected', 'reversed')) or
    (old.status = 'approved' and new.status in ('settled', 'reversed')) or
    (old.status = 'settled' and new.status in ('paid', 'approved')) -- 'approved' when a settlement is cancelled
  ) then
    raise exception 'invalid commission status transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger commission_entries_guard before update on public.commission_entries
  for each row execute function public.guard_commission_entry();

create trigger commission_entries_no_delete before delete on public.commission_entries
  for each row execute function public.forbid_audit_mutation();

create table public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_id uuid not null,
  source text not null check (source in ('manual', 'uniklife_webhook')),
  external_reference text,
  reported_amount numeric(16,2) not null check (reported_amount >= 0),
  status text not null default 'received' check (status in ('received', 'matched', 'mismatch', 'accepted', 'rejected')),
  details jsonb not null default '{}',
  webhook_event_id uuid,
  received_at timestamptz not null default now(),
  reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,
  review_note text,
  foreign key (organization_id, settlement_id) references public.commission_settlements (organization_id, id)
);
create index finance_reconciliations_settlement_idx on public.finance_reconciliations (settlement_id);

-- ---------------------------------------------------------------------------
-- Site visits
-- ---------------------------------------------------------------------------
create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null,
  enquiry_id uuid references public.enquiries(id) on delete set null,
  visitor_name text not null,
  visitor_phone text not null,
  scheduled_at timestamptz not null,
  employee_id uuid,
  status text not null default 'requested' check (status in ('requested', 'scheduled', 'completed', 'cancelled', 'no_show')),
  plot_ids uuid[] not null default '{}',
  notes text,
  outcome text,
  created_by uuid references public.app_users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id)
);
create index site_visits_org_idx on public.site_visits (organization_id, scheduled_at);
create index site_visits_employee_idx on public.site_visits (employee_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Notifications, preferences, reminders, push subscriptions
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references public.app_users(id) on delete cascade,
  type text not null check (type in ('downline_booking', 'downline_reservation', 'reservation_reminder', 'followup_reminder',
                                     'site_visit_update', 'commission_update', 'booking_update', 'system')),
  title text not null,
  body text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  booking_number text,
  plot_numbers text[] not null default '{}',
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.%-]*$'), -- same-origin relative deep links only
  follow_up_action text,
  dedupe_key text unique,
  push_status text not null default 'not_requested' check (push_status in ('not_requested', 'pending', 'sent', 'failed', 'unavailable')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, organization_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_user_id) where read_at is null;

create table public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  in_app boolean not null default true,
  dashboard_alerts boolean not null default true,
  -- Delivered via UNIKLIFE.AI only if that channel is verified as supported; otherwise recorded as requested.
  whatsapp_via_uniklife boolean not null default false,
  email_via_uniklife boolean not null default false,
  push boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.follow_up_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('booking_followup', 'reservation_expiry', 'site_visit')),
  booking_id uuid references public.bookings(id) on delete cascade,
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  recipient_user_id uuid not null references public.app_users(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'done')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index follow_up_reminders_due_idx on public.follow_up_reminders (status, due_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['commission_plans', 'commission_settlements', 'commission_entries', 'site_visits'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end
$$;
