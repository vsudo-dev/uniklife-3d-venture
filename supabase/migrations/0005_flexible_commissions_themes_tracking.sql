-- 0005: flexible commission structures (configurable level count, per-sq-yd or
-- percentage basis, per-venture / per-property-type plans), property types,
-- per-venture viewer & theme settings, brand themes + colour modes, and
-- consent-based site-visit trip tracking with venture geofences.

-- ---------------------------------------------------------------------------
-- Property types
-- ---------------------------------------------------------------------------
alter table public.ventures
  add column property_type text not null default 'open_plot'
    check (property_type in ('open_plot', 'villa_plot', 'apartment', 'commercial', 'farm_land', 'mixed')),
  -- Per-venture 3D viewer & presentation settings (validated by the application).
  add column viewer_settings jsonb not null default '{}',
  -- Geofence for site-visit arrival detection (centre defaults to latitude/longitude).
  add column geofence_radius_m integer not null default 300 check (geofence_radius_m between 50 and 5000);

alter table public.plots
  add column property_type text
    check (property_type is null or property_type in ('open_plot', 'villa_plot', 'apartment', 'commercial', 'farm_land', 'mixed'));

-- ---------------------------------------------------------------------------
-- Brand themes & colour modes
-- ---------------------------------------------------------------------------
alter table public.organizations drop constraint if exists organizations_theme_check;
alter table public.organizations
  add constraint organizations_theme_check check (theme in (
    'royal', 'midnight', 'ivory', 'emerald', 'ruby', 'sapphire', 'onyx', 'pearl', 'saffron', 'teal', 'amethyst', 'copper'
  )),
  add column default_color_mode text not null default 'system' check (default_color_mode in ('system', 'light', 'dark', 'night')),
  add column commission_requires_second_approver boolean not null default true;

alter table public.app_users
  add column color_mode text check (color_mode is null or color_mode in ('system', 'light', 'dark', 'night'));

-- ---------------------------------------------------------------------------
-- Flexible commission plans
-- ---------------------------------------------------------------------------
alter table public.employees drop constraint if exists employees_commission_level_check;
alter table public.employees add constraint employees_commission_level_check check (commission_level is null or commission_level between 1 and 12);

alter table public.commission_plans drop constraint if exists commission_plans_max_payable_levels_check;
alter table public.commission_plans
  add constraint commission_plans_max_payable_levels_check check (max_payable_levels between 1 and 12),
  add column level_count integer not null default 8 check (level_count between 1 and 12),
  add column basis text not null default 'per_sq_yard' check (basis in ('per_sq_yard', 'percentage')),
  add column property_type text not null default 'any'
    check (property_type in ('any', 'open_plot', 'villa_plot', 'apartment', 'commercial', 'farm_land', 'mixed')),
  -- Empty = applies to every venture of the organization. Stored sorted by the application.
  add column venture_ids uuid[] not null default '{}';

-- One open (no end date) approved plan per scope instead of per organization.
drop index if exists public.commission_plans_one_open;
create unique index commission_plans_one_open_per_scope on public.commission_plans
  (organization_id, property_type, venture_ids)
  where status in ('active', 'superseded') and effective_to is null;

alter table public.commission_plan_levels drop constraint if exists commission_plan_levels_level_check;
alter table public.commission_plan_levels
  add constraint commission_plan_levels_level_check check (level between 1 and 12),
  add column rate_percent numeric(7,4) check (rate_percent is null or (rate_percent >= 0 and rate_percent <= 100));

alter table public.commission_entries drop constraint if exists commission_entries_employee_level_check;
alter table public.commission_entries drop constraint if exists commission_entries_check;
alter table public.commission_entries drop constraint if exists commission_entries_amount_check;
alter table public.commission_entries
  add constraint commission_entries_employee_level_check check (employee_level between 1 and 12),
  add column basis text not null default 'per_sq_yard' check (basis in ('per_sq_yard', 'percentage')),
  add column level_rate_percent numeric(7,4),
  add column payable_rate_percent numeric(7,4),
  add column base_amount numeric(16,2),
  add constraint commission_entries_amount_check check (
    (basis = 'per_sq_yard' and amount = round(payable_rate * area_sq_yards, 2))
    or (basis = 'percentage' and base_amount is not null and payable_rate_percent is not null
        and amount = round(base_amount * payable_rate_percent / 100, 2))
  );

create or replace function public.guard_commission_plan() returns trigger
language plpgsql
as $$
declare
  n integer;
  violations integer;
  four_eyes boolean;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    if old.status <> 'pending_approval' then
      raise exception 'only a plan pending approval can be activated' using errcode = 'P0001';
    end if;
    select commission_requires_second_approver into four_eyes from public.organizations where id = new.organization_id;
    if coalesce(four_eyes, true) and new.approved_by is not distinct from new.submitted_by then
      raise exception 'a commission plan must be approved by someone other than its submitter' using errcode = 'P0001';
    end if;
    select count(*) into n from public.commission_plan_levels where plan_id = new.id and level <= new.level_count;
    if n <> new.level_count then
      raise exception 'commission plan must define exactly % levels (found %)', new.level_count, n using errcode = 'P0001';
    end if;
    if exists (select 1 from public.commission_plan_levels where plan_id = new.id and level > new.level_count) then
      raise exception 'commission plan has levels beyond its level count' using errcode = 'P0001';
    end if;
    if new.basis = 'percentage' then
      if exists (select 1 from public.commission_plan_levels where plan_id = new.id and rate_percent is null) then
        raise exception 'percentage plans need a percentage for every level' using errcode = 'P0001';
      end if;
      select count(*) into violations
        from public.commission_plan_levels a
        join public.commission_plan_levels b on b.plan_id = a.plan_id and b.level = a.level + 1
       where a.plan_id = new.id and b.rate_percent >= a.rate_percent;
    else
      select count(*) into violations
        from public.commission_plan_levels a
        join public.commission_plan_levels b on b.plan_id = a.plan_id and b.level = a.level + 1
       where a.plan_id = new.id and b.rate_per_sq_yard >= a.rate_per_sq_yard;
    end if;
    if violations > 0 then
      raise exception 'commission rates must strictly descend from level 1 to level %', new.level_count using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('active', 'superseded') then
    if new.calculation_method is distinct from old.calculation_method
       or new.pay_selling_employee is distinct from old.pay_selling_employee
       or new.ceo_separate_entitlement is distinct from old.ceo_separate_entitlement
       or new.max_payable_levels is distinct from old.max_payable_levels
       or new.level_count is distinct from old.level_count
       or new.basis is distinct from old.basis
       or new.property_type is distinct from old.property_type
       or new.venture_ids is distinct from old.venture_ids
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

create or replace function public.guard_commission_entry() returns trigger
language plpgsql
as $$
begin
  if new.amount is distinct from old.amount or new.payable_rate is distinct from old.payable_rate
     or new.level_rate is distinct from old.level_rate or new.employee_id is distinct from old.employee_id
     or new.booking_id is distinct from old.booking_id or new.area_sq_yards is distinct from old.area_sq_yards
     or new.plan_id is distinct from old.plan_id or new.hierarchy_snapshot is distinct from old.hierarchy_snapshot
     or new.basis is distinct from old.basis or new.payable_rate_percent is distinct from old.payable_rate_percent
     or new.level_rate_percent is distinct from old.level_rate_percent or new.base_amount is distinct from old.base_amount then
    raise exception 'commission ledger amounts are immutable; reverse and recalculate instead' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'calculated' and new.status in ('approved', 'rejected', 'reversed')) or
    (old.status = 'approved' and new.status in ('settled', 'reversed')) or
    (old.status = 'settled' and new.status in ('paid', 'approved'))
  ) then
    raise exception 'invalid commission status transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Site-visit trip tracking (consent-based, only during an active trip)
-- ---------------------------------------------------------------------------
alter table public.site_visits
  add column tracking_stage text not null default 'not_started' check (tracking_stage in (
    'not_started', 'trip_started', 'arrived_site', 'visit_in_progress', 'visit_completed', 'left_site', 'returned', 'cancelled'
  )),
  add column tracking_consent_at timestamptz,
  add column trip_started_at timestamptz,
  add column arrived_at timestamptz,
  add column visit_started_at timestamptz,
  add column visit_completed_at timestamptz,
  add column left_site_at timestamptz,
  add column returned_at timestamptz,
  add column start_lat numeric(9,6),
  add column start_lng numeric(9,6),
  add column end_lat numeric(9,6),
  add column end_lng numeric(9,6),
  add column check_in_at timestamptz,
  add column check_in_lat numeric(9,6),
  add column check_in_lng numeric(9,6),
  add column check_in_accuracy_m numeric(8,1),
  add column total_distance_m numeric(12,1) not null default 0;

create table public.site_visit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  employee_id uuid references public.employees(id),
  stage text not null check (stage in (
    'trip_started', 'location_ping', 'arrived_site', 'visit_started', 'visit_completed', 'left_site', 'returned', 'cancelled', 'geofence_enter', 'geofence_exit'
  )),
  source text not null default 'manual' check (source in ('manual', 'gps_ping', 'geofence_auto')),
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric(8,1),
  inside_geofence boolean,
  distance_to_site_m numeric(12,1),
  recorded_at timestamptz not null,       -- device time
  received_at timestamptz not null default now(),
  note text,
  created_by uuid references public.app_users(id),
  check ((lat is null) = (lng is null)),
  check (lat is null or (lat between -90 and 90 and lng between -180 and 180))
);
create index site_visit_events_visit_idx on public.site_visit_events (site_visit_id, recorded_at);
create index site_visit_events_employee_idx on public.site_visit_events (employee_id, recorded_at desc);

alter table public.site_visit_events enable row level security;
grant select on public.site_visit_events to authenticated;
create policy site_visit_events_read on public.site_visit_events for select to authenticated
  using (
    public.has_org_role(organization_id, array['org_admin', 'venture_manager'])
    or public.in_my_network(organization_id, employee_id)
  );

-- Location events are evidence: append-only.
create trigger site_visit_events_no_update before update on public.site_visit_events
  for each row execute function public.forbid_audit_mutation();
