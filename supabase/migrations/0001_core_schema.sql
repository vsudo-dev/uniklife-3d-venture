-- UNIKLIFE.AI 3D Venture — core schema
-- Compatible with PostgreSQL 15+ (Supabase) and PGlite (local disposable dev/test DB).
-- All primary keys are UUIDs; every tenant table carries organization_id for isolation.

-- ---------------------------------------------------------------------------
-- Roles used by RLS (already exist on Supabase; created locally for PGlite)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- Resolves the requesting user from the JWT claims PostgREST/Supabase sets per request.
-- Works on Supabase (request.jwt.claims) and locally (tests set the same GUC).
create or replace function public.request_user_id() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Organizations, users, memberships
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  contact_email text,
  contact_phone text,
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  hold_minutes integer not null default 15 check (hold_minutes between 1 and 1440),
  payment_window_minutes integer not null default 120 check (payment_window_minutes between 5 and 10080),
  booking_amount_percent numeric(5,2) not null default 10 check (booking_amount_percent > 0 and booking_amount_percent <= 100),
  allow_discount_stacking boolean not null default false,
  max_discount_percent numeric(5,2) not null default 20 check (max_discount_percent >= 0 and max_discount_percent <= 100),
  discount_approval_threshold_percent numeric(5,2) not null default 5 check (discount_approval_threshold_percent >= 0 and discount_approval_threshold_percent <= 100),
  -- Follow-up reminders for uplines after a downline booking/reservation (hours after the event).
  followup_reminder_hours integer[] not null default '{24,72}',
  -- Employee ID generation (EMP-00001 ...), unique within the organization.
  employee_code_prefix text not null default 'EMP' check (employee_code_prefix ~ '^[A-Z]{2,6}$'),
  next_employee_number integer not null default 1 check (next_employee_number > 0),
  -- White-label branding (PWA identity). Logos are stored as uploaded; icons are generated from them.
  app_name text,
  short_name text check (short_name is null or length(short_name) <= 12),
  theme text not null default 'royal' check (theme in ('royal', 'midnight', 'ivory')),
  logo_path text,
  logo_mime text,
  logo_width integer,
  logo_height integer,
  branding_version integer not null default 1,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null,
  phone text,
  -- Only used by the local auth provider. With Supabase Auth, id = auth.users.id and this stays null.
  password_hash text,
  auth_provider text not null default 'local' check (auth_provider in ('local', 'supabase')),
  is_platform_admin boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index app_users_email_key on public.app_users (lower(email));

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('org_admin', 'venture_manager', 'sales_manager', 'sales_executive', 'customer')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Ventures
-- ---------------------------------------------------------------------------
create table public.ventures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  description text,
  location_text text,
  city text,
  state text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  survey_numbers text,
  -- Approval details are USER-PROVIDED and unverified until a staff member records verification.
  approval_authority text,
  approval_reference text,
  approval_verified boolean not null default false,
  approval_verified_by uuid references public.app_users(id),
  approval_verified_at timestamptz,
  total_land_area numeric(12,3) check (total_land_area is null or total_land_area > 0),
  land_area_unit text not null default 'acres' check (land_area_unit in ('acres', 'sq_yards', 'sq_meters', 'hectares')),
  declared_total_plots integer check (declared_total_plots is null or declared_total_plots >= 0),
  roads_description text,
  amenities text[] not null default '{}',
  launch_date date,
  status text not null default 'draft' check (status in ('draft', 'upcoming', 'launched', 'sold_out', 'on_hold', 'archived')),
  is_published boolean not null default false,
  is_demo boolean not null default false,
  hold_minutes integer check (hold_minutes is null or hold_minutes between 1 and 1440),
  booking_amount_percent numeric(5,2) check (booking_amount_percent is null or (booking_amount_percent > 0 and booking_amount_percent <= 100)),
  viewer_mode text not null default 'procedural' check (viewer_mode in ('procedural', 'glb')),
  model_asset_id uuid,
  layout_pdf_asset_id uuid,
  cover_image_asset_id uuid,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index ventures_org_idx on public.ventures (organization_id, status);

create table public.venture_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  kind text not null check (kind in ('image', 'layout_pdf', 'model_glb', 'cad_dxf', 'cad_dwg', 'document')),
  storage_driver text not null default 'local' check (storage_driver in ('local', 'supabase')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index venture_assets_venture_idx on public.venture_assets (venture_id, kind);

alter table public.ventures
  add constraint ventures_model_asset_fk foreign key (model_asset_id) references public.venture_assets(id) on delete set null,
  add constraint ventures_layout_pdf_fk foreign key (layout_pdf_asset_id) references public.venture_assets(id) on delete set null,
  add constraint ventures_cover_image_fk foreign key (cover_image_asset_id) references public.venture_assets(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Employee directory & reporting hierarchy
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_code text not null check (employee_code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  user_id uuid references public.app_users(id) on delete set null,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  mobile text,
  email text,
  designation text,
  -- Organizational rank used by the commission plan (1 = CEO ... 8 = seventh line). Null = not on the commission ladder.
  commission_level integer check (commission_level is null or commission_level between 1 and 8),
  commission_eligible boolean not null default true,
  reporting_manager_id uuid references public.employees(id) on delete set null,
  employment_status text not null default 'active' check (employment_status in ('active', 'on_leave', 'resigned', 'terminated')),
  joining_date date,
  -- Reference to an external HRM record; only set via an administrator-approved import/mapping.
  hrm_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_code),
  check (reporting_manager_id is null or reporting_manager_id <> id)
);
create unique index employees_org_user_key on public.employees (organization_id, user_id) where user_id is not null;
create index employees_manager_idx on public.employees (reporting_manager_id);

create table public.venture_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (venture_id, employee_id)
);
create index venture_assignments_employee_idx on public.venture_assignments (employee_id);

create table public.venture_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  name text not null,
  code text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (venture_id, code)
);

-- Roads, amenities, boundaries etc. rendered in the 3D / 2D viewer.
create table public.venture_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  kind text not null check (kind in ('road', 'amenity', 'park', 'boundary', 'entrance', 'water', 'other')),
  name text,
  polygon jsonb not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index venture_features_venture_idx on public.venture_features (venture_id);

-- ---------------------------------------------------------------------------
-- Plots
-- ---------------------------------------------------------------------------
create table public.plots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  phase_id uuid references public.venture_phases(id) on delete set null,
  plot_number text not null check (length(trim(plot_number)) between 1 and 32),
  area_sq_yards numeric(12,2) not null check (area_sq_yards > 0),
  length_ft numeric(10,2) check (length_ft is null or length_ft > 0),
  width_ft numeric(10,2) check (width_ft is null or width_ft > 0),
  dimensions_text text,
  facing text check (facing is null or facing in ('N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW')),
  road_width_ft numeric(6,2) check (road_width_ft is null or road_width_ft > 0),
  is_corner boolean not null default false,
  base_price_per_sq_yard numeric(14,2) not null check (base_price_per_sq_yard >= 0),
  total_base_price numeric(16,2) generated always as (round(area_sq_yards * base_price_per_sq_yard, 2)) stored,
  status text not null default 'available' check (status in ('available', 'held', 'reserved', 'booked', 'sold', 'blocked')),
  blocked_reason text,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venture_id, plot_number)
);
create index plots_org_idx on public.plots (organization_id);
create index plots_venture_status_idx on public.plots (venture_id, status);

-- Mapping between 3D mesh identifiers (GLB node names / generated meshes) and plots.
create table public.plot_geometry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  plot_id uuid not null unique references public.plots(id) on delete cascade,
  mesh_id text not null check (length(mesh_id) between 1 and 128),
  polygon jsonb,           -- [[x, y], ...] in metres, layout plane
  centroid_x numeric(12,3),
  centroid_y numeric(12,3),
  source text not null default 'generated' check (source in ('generated', 'dxf', 'glb', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venture_id, mesh_id)
);

create table public.plot_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  price_per_sq_yard numeric(14,2) not null check (price_per_sq_yard >= 0),
  effective_from timestamptz not null default now(),
  reason text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index plot_prices_plot_idx on public.plot_prices (plot_id, effective_from desc);

create table public.plot_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  reservation_id uuid,
  booking_id uuid,
  actor_user_id uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index plot_status_history_plot_idx on public.plot_status_history (plot_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Customers & enquiries
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  email text,
  phone text,
  address text,
  notes text,
  crm_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_org_user_key on public.customers (organization_id, user_id) where user_id is not null;
create index customers_org_email_idx on public.customers (organization_id, lower(email));
create index customers_org_phone_idx on public.customers (organization_id, phone);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  plot_id uuid references public.plots(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  email text,
  phone text not null,
  message text,
  source text not null default 'web' check (source in ('web', '3d_viewer', 'portal', 'staff', 'crm')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'converted', 'closed')),
  assigned_employee_id uuid references public.employees(id) on delete set null,
  created_by uuid references public.app_users(id),
  crm_lead_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiries_org_idx on public.enquiries (organization_id, status, created_at desc);
create index enquiries_employee_idx on public.enquiries (assigned_employee_id);

-- ---------------------------------------------------------------------------
-- Reservations (temporary holds) & bookings
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  -- Plots held together in one request share a hold group; a booking converts a whole group.
  hold_group_id uuid not null,
  created_by uuid references public.app_users(id),
  credited_employee_id uuid references public.employees(id),
  status text not null default 'active' check (status in ('active', 'converted', 'expired', 'released', 'cancelled')),
  expires_at timestamptz not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key, plot_id)
);
-- Concurrency guard: at most ONE active hold per plot, enforced by the database.
create unique index reservations_one_active_per_plot on public.reservations (plot_id) where status = 'active';
create index reservations_expiry_idx on public.reservations (status, expires_at);
create index reservations_group_idx on public.reservations (hold_group_id);

create sequence public.booking_number_seq start 1001;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venture_id uuid not null references public.ventures(id),
  customer_id uuid not null references public.customers(id),
  hold_group_id uuid,
  booking_number text not null unique default ('BK-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_number_seq')::text, 6, '0')),
  status text not null default 'payment_pending' check (status in ('payment_pending', 'confirmed', 'completed', 'cancelled', 'expired')),
  currency text not null default 'INR',
  plot_count integer not null check (plot_count >= 1),
  total_area_sq_yards numeric(12,2) not null check (total_area_sq_yards > 0),
  -- Attribution: the authenticated actor (requested_by) and the credited selling employee are stored separately.
  credited_employee_id uuid references public.employees(id),
  attribution_snapshot jsonb,       -- seller, reporting manager & eligible upline chain at booking time
  attribution_locked boolean not null default false, -- set once any commission for this booking is approved
  base_amount numeric(16,2) not null check (base_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  net_amount numeric(16,2) not null check (net_amount >= 0),
  booking_amount numeric(16,2) not null check (booking_amount >= 0),
  discount_codes text[] not null default '{}',
  pricing_snapshot jsonb not null,
  confirmed_pricing_snapshot jsonb,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  payment_due_at timestamptz not null,
  requested_by uuid references public.app_users(id),
  confirmed_at timestamptz,
  confirmed_by uuid references public.app_users(id),
  confirmation_source text check (confirmation_source is null or confirmation_source in ('payment_webhook', 'staff_verified_payment')),
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  -- Set when confirmation was blocked (e.g. a discount was revoked after the request); staff must resolve.
  review_reason text,
  crm_deal_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (net_amount = base_amount - discount_amount),
  check (booking_amount <= net_amount)
);
create index bookings_org_status_idx on public.bookings (organization_id, status, created_at desc);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_employee_idx on public.bookings (credited_employee_id);

-- One row per plot in a (possibly multi-plot) booking, with per-plot pricing.
create table public.booking_plots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  plot_id uuid not null references public.plots(id),
  reservation_id uuid references public.reservations(id),
  plot_number text not null,
  area_sq_yards numeric(12,2) not null check (area_sq_yards > 0),
  price_per_sq_yard numeric(14,2) not null check (price_per_sq_yard >= 0),
  base_amount numeric(16,2) not null check (base_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  net_amount numeric(16,2) not null check (net_amount >= 0),
  -- Mirrors whether the parent booking is live (payment_pending/confirmed/completed); maintained by trigger.
  is_live boolean not null default true,
  created_at timestamptz not null default now(),
  unique (booking_id, plot_id),
  check (net_amount = base_amount - discount_amount)
);
-- Concurrency guard: at most ONE live booking per plot, across single- and multi-plot bookings.
create unique index booking_plots_one_live_per_plot on public.booking_plots (plot_id) where is_live;
create index booking_plots_booking_idx on public.booking_plots (booking_id);

create table public.booking_attribution_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_employee_id uuid references public.employees(id),
  to_employee_id uuid references public.employees(id),
  reason text not null check (length(trim(reason)) >= 5),
  changed_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now()
);
create index booking_attribution_changes_booking_idx on public.booking_attribution_changes (booking_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Discounts
-- ---------------------------------------------------------------------------
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  code text check (code is null or code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  value_type text not null check (value_type in ('fixed_amount', 'percentage')),
  category text not null default 'general' check (category in ('general', 'coupon', 'venture', 'plot', 'promotional', 'campaign', 'customer')),
  value numeric(14,2) not null check (value > 0),
  max_discount_amount numeric(16,2) check (max_discount_amount is null or max_discount_amount > 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  applicable_venture_ids uuid[] not null default '{}',
  applicable_plot_ids uuid[] not null default '{}',
  customer_id uuid references public.customers(id) on delete cascade,
  campaign_name text,
  usage_limit_total integer check (usage_limit_total is null or usage_limit_total > 0),
  usage_limit_per_customer integer check (usage_limit_per_customer is null or usage_limit_per_customer > 0),
  stackable boolean not null default false,
  requires_approval boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'paused', 'rejected', 'archived')),
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value_type <> 'percentage' or value <= 100),
  check (expires_at is null or expires_at > starts_at),
  check (category <> 'coupon' or code is not null),
  check (category <> 'customer' or customer_id is not null),
  check (category <> 'venture' or cardinality(applicable_venture_ids) > 0),
  check (category <> 'plot' or cardinality(applicable_plot_ids) > 0),
  check (category <> 'promotional' or expires_at is not null)
);
create unique index discounts_org_code_key on public.discounts (organization_id, upper(code)) where code is not null;
create index discounts_org_status_idx on public.discounts (organization_id, status);

create table public.discount_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  discount_id uuid not null references public.discounts(id) on delete cascade,
  action text not null check (action in ('submitted', 'approved', 'rejected', 'paused', 'reactivated', 'archived')),
  actor_user_id uuid references public.app_users(id),
  note text,
  created_at timestamptz not null default now()
);
create index discount_approvals_discount_idx on public.discount_approvals (discount_id, created_at desc);

create table public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  discount_id uuid not null references public.discounts(id),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  amount numeric(16,2) not null check (amount >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discount_id, booking_id)
);
create index discount_redemptions_discount_idx on public.discount_redemptions (discount_id, status);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id),
  customer_id uuid not null references public.customers(id),
  provider text not null check (provider in ('mock', 'offline', 'razorpay', 'stripe')),
  provider_reference text not null,
  purpose text not null default 'booking_amount' check (purpose in ('booking_amount', 'installment', 'balance')),
  amount numeric(16,2) not null check (amount > 0),
  currency text not null default 'INR',
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'refunded')),
  is_simulated boolean not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  verified_at timestamptz,
  verified_by uuid references public.app_users(id),
  failure_reason text,
  last_event jsonb,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference),
  unique (organization_id, idempotency_key)
);
create index payment_transactions_booking_idx on public.payment_transactions (booking_id, status);

-- ---------------------------------------------------------------------------
-- Integration (UNIKLIFE.AI) — connections, inbound webhooks, outbox
-- ---------------------------------------------------------------------------
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'uniklife' check (provider in ('uniklife')),
  name text not null default 'UNIKLIFE.AI',
  mode text not null default 'mock' check (mode in ('mock', 'live')),
  is_enabled boolean not null default true,
  destination_url text,
  auth_type text not null default 'hmac' check (auth_type in ('hmac', 'bearer')),
  -- Secrets are NEVER stored in the database: these columns hold environment variable NAMES.
  outbound_secret_env text,
  inbound_secret_env text,
  event_mappings jsonb not null default '{}',
  live_verified boolean not null default false,
  live_verified_by uuid references public.app_users(id),
  live_verified_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  check (mode <> 'live' or live_verified)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  source text not null check (source in ('uniklife', 'payment', 'test')),
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  status text not null default 'received' check (status in ('received', 'queued', 'processed', 'rejected', 'failed', 'ignored')),
  error text,
  attempts integer not null default 0,
  duplicate_count integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, external_event_id)
);
create index webhook_events_org_idx on public.webhook_events (organization_id, received_at desc);
create index webhook_events_status_idx on public.webhook_events (status);

create table public.outbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'dead_letter', 'skipped')),
  attempts integer not null default 0,
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  last_response_status integer,
  last_response_excerpt text,      -- sanitized, truncated response body
  external_reference text,         -- reference returned by the destination, if any
  -- Loop prevention: events caused by an inbound webhook are never echoed back to their source.
  caused_by_webhook_event_id uuid,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbound_events_due_idx on public.outbound_events (status, next_attempt_at);
create index outbound_events_org_idx on public.outbound_events (organization_id, created_at desc);

create table public.outbound_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbound_event_id uuid not null references public.outbound_events(id) on delete cascade,
  attempt_no integer not null,
  success boolean not null,
  response_status integer,
  error text,
  duration_ms integer,
  connector_mode text not null,
  created_at timestamptz not null default now()
);
create index outbound_delivery_attempts_event_idx on public.outbound_delivery_attempts (outbound_event_id, attempt_no);

-- What the MOCK UNIKLIFE.AI connector "received". Never touches the real CRM.
create table public.mock_uniklife_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null unique,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- No cascading actions: the log is append-only, so referenced orgs/users are suspended, never deleted.
  organization_id uuid references public.organizations(id),
  actor_user_id uuid references public.app_users(id),
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'webhook')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}',
  ip_address text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'app_users', 'organization_members', 'employees', 'ventures', 'plots', 'plot_geometry',
    'customers', 'enquiries', 'reservations', 'bookings', 'discounts', 'discount_redemptions',
    'payment_transactions', 'integration_connections', 'outbound_events'
  ] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end
$$;
