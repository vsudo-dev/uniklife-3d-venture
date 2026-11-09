-- Row Level Security — defense in depth.
--
-- The application server talks to Postgres as the table owner and enforces
-- permissions in its service layer (src/lib/auth). These policies protect the
-- data if a Supabase client (anon / authenticated JWT) ever queries tables directly:
--   * anon: no access to anything.
--   * authenticated: READ-ONLY, limited to the user's organization(s);
--     customers see only their own records; staff outside the admin role see only
--     their own network (themselves + descendants) for people, bookings & commissions.
--   * All writes go through the server.

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select u.is_platform_admin from public.app_users u where u.id = public.request_user_id() and u.status = 'active'),
    false)
$$;

create or replace function public.member_role(org uuid) returns text
language sql stable security definer set search_path = public
as $$
  select m.role
    from public.organization_members m
    join public.app_users u on u.id = m.user_id and u.status = 'active'
   where m.organization_id = org and m.user_id = public.request_user_id() and m.status = 'active'
$$;

create or replace function public.has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_platform_admin() or coalesce(public.member_role(org) = any(roles), false)
$$;

create or replace function public.is_org_staff(org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_org_role(org, array['org_admin', 'venture_manager', 'sales_manager', 'sales_executive'])
$$;

create or replace function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_org_role(org, array['org_admin'])
$$;

create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_platform_admin() or public.member_role(org) is not null
$$;

create or replace function public.owns_customer(cust uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.customers c where c.id = cust and c.user_id = public.request_user_id())
$$;

-- The requesting user's employee record in an organization plus all descendants.
create or replace function public.my_network_employee_ids(org uuid) returns setof uuid
language sql stable security definer set search_path = public
as $$
  with recursive tree(id, depth) as (
    select e.id, 0 from public.employees e
     where e.organization_id = org and e.user_id = public.request_user_id()
    union all
    select e.id, t.depth + 1 from public.employees e join tree t on e.reporting_manager_id = t.id
     where t.depth < 64
  )
  select id from tree
$$;

create or replace function public.in_my_network(org uuid, emp uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select emp is not null and (public.is_org_admin(org) or emp in (select public.my_network_employee_ids(org)))
$$;

-- Enable RLS on every table.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'app_users', 'organization_members', 'employees', 'ventures', 'venture_assets', 'venture_assignments',
    'venture_phases', 'venture_features', 'plots', 'plot_geometry', 'plot_prices', 'plot_status_history',
    'customers', 'enquiries', 'reservations', 'bookings', 'booking_plots', 'booking_attribution_changes',
    'discounts', 'discount_approvals', 'discount_redemptions', 'payment_transactions',
    'integration_connections', 'webhook_events', 'outbound_events', 'outbound_delivery_attempts',
    'mock_uniklife_records', 'audit_logs', 'organization_domains', 'commission_plans', 'commission_plan_levels',
    'commission_plan_approvals', 'commission_settlements', 'commission_entries', 'finance_reconciliations',
    'site_visits', 'notifications', 'notification_preferences', 'follow_up_reminders', 'push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Read grants for authenticated; RLS decides which rows. No write grants.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke all on all tables in schema public from anon;
do $$
begin
  if to_regclass('public._app_migrations') is not null then
    execute 'revoke all on public._app_migrations from authenticated';
  end if;
end
$$;
-- Credentials never leave the server, even to the row's owner. (A column-level
-- REVOKE does not override a table-level GRANT, so grant explicit columns instead.)
revoke select on public.app_users from authenticated;
grant select (id, email, full_name, phone, auth_provider, is_platform_admin, status, last_login_at, created_at, updated_at)
  on public.app_users to authenticated;
revoke select on public.push_subscriptions from authenticated;
grant select (id, organization_id, user_id, created_at) on public.push_subscriptions to authenticated;

-- Organizations & membership
create policy organizations_read on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy organization_domains_read on public.organization_domains for select to authenticated
  using (public.is_org_admin(organization_id));

create policy app_users_read on public.app_users for select to authenticated
  using (
    id = public.request_user_id()
    or public.is_platform_admin()
    or exists (select 1 from public.organization_members m where m.user_id = app_users.id and public.is_org_admin(m.organization_id))
  );

create policy organization_members_read on public.organization_members for select to authenticated
  using (user_id = public.request_user_id() or public.is_org_admin(organization_id));

-- Employees: admins see the directory; everyone else only their own network.
create policy employees_read on public.employees for select to authenticated
  using (public.in_my_network(organization_id, id));

create policy venture_assignments_read on public.venture_assignments for select to authenticated
  using (public.in_my_network(organization_id, employee_id));

-- Venture catalogue: staff see everything in their org; customers see published ventures of their org.
create policy ventures_read on public.ventures for select to authenticated
  using (public.is_org_staff(organization_id) or (is_published and public.is_org_member(organization_id)));

create policy venture_assets_read on public.venture_assets for select to authenticated
  using (
    public.is_org_staff(organization_id)
    or (kind in ('image', 'layout_pdf', 'model_glb')
        and exists (select 1 from public.ventures v where v.id = venture_id and v.is_published)
        and public.is_org_member(organization_id))
  );

create policy venture_phases_read on public.venture_phases for select to authenticated
  using (public.is_org_staff(organization_id)
         or (public.is_org_member(organization_id) and exists (select 1 from public.ventures v where v.id = venture_id and v.is_published)));

create policy venture_features_read on public.venture_features for select to authenticated
  using (public.is_org_staff(organization_id)
         or (public.is_org_member(organization_id) and exists (select 1 from public.ventures v where v.id = venture_id and v.is_published)));

create policy plots_read on public.plots for select to authenticated
  using (public.is_org_staff(organization_id)
         or (public.is_org_member(organization_id) and exists (select 1 from public.ventures v where v.id = venture_id and v.is_published)));

create policy plot_geometry_read on public.plot_geometry for select to authenticated
  using (public.is_org_staff(organization_id)
         or (public.is_org_member(organization_id) and exists (select 1 from public.ventures v where v.id = venture_id and v.is_published)));

create policy plot_prices_read on public.plot_prices for select to authenticated
  using (public.is_org_staff(organization_id));

create policy plot_status_history_read on public.plot_status_history for select to authenticated
  using (public.is_org_staff(organization_id));

-- Customer records: admins/venture & sales managers, the owning customer.
create policy customers_read on public.customers for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'venture_manager', 'sales_manager']) or user_id = public.request_user_id());

create policy enquiries_read on public.enquiries for select to authenticated
  using (
    public.has_org_role(organization_id, array['org_admin', 'venture_manager'])
    or (assigned_employee_id is null and public.has_org_role(organization_id, array['sales_manager']))
    or public.in_my_network(organization_id, assigned_employee_id)
    or (customer_id is not null and public.owns_customer(customer_id))
  );

-- Bookings & holds: admins, venture managers, the credited network, the creator, the customer.
create policy reservations_read on public.reservations for select to authenticated
  using (
    public.has_org_role(organization_id, array['org_admin', 'venture_manager'])
    or public.in_my_network(organization_id, credited_employee_id)
    or created_by = public.request_user_id()
    or public.owns_customer(customer_id)
  );

create policy bookings_read on public.bookings for select to authenticated
  using (
    public.has_org_role(organization_id, array['org_admin', 'venture_manager'])
    or public.in_my_network(organization_id, credited_employee_id)
    or requested_by = public.request_user_id()
    or public.owns_customer(customer_id)
  );

create policy booking_plots_read on public.booking_plots for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

create policy booking_attribution_changes_read on public.booking_attribution_changes for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'sales_manager']));

create policy payment_transactions_read on public.payment_transactions for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

create policy discount_redemptions_read on public.discount_redemptions for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

-- Discounts are never browsable by customers (codes would leak).
create policy discounts_read on public.discounts for select to authenticated
  using (public.is_org_staff(organization_id));

create policy discount_approvals_read on public.discount_approvals for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'sales_manager', 'venture_manager']));

-- Commission plans (all level rates) are administrator-only: downlines must not see upline rates.
create policy commission_plans_read on public.commission_plans for select to authenticated
  using (public.is_org_admin(organization_id));
create policy commission_plan_levels_read on public.commission_plan_levels for select to authenticated
  using (public.is_org_admin(organization_id));
create policy commission_plan_approvals_read on public.commission_plan_approvals for select to authenticated
  using (public.is_org_admin(organization_id));

-- Commission ledger: own entries and those of descendants — never an upline's.
create policy commission_entries_read on public.commission_entries for select to authenticated
  using (public.in_my_network(organization_id, employee_id));

create policy commission_settlements_read on public.commission_settlements for select to authenticated
  using (public.is_org_admin(organization_id));
create policy finance_reconciliations_read on public.finance_reconciliations for select to authenticated
  using (public.is_org_admin(organization_id));

create policy site_visits_read on public.site_visits for select to authenticated
  using (
    public.has_org_role(organization_id, array['org_admin', 'venture_manager'])
    or public.in_my_network(organization_id, employee_id)
    or created_by = public.request_user_id()
    or (customer_id is not null and public.owns_customer(customer_id))
  );

-- Personal data
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_user_id = public.request_user_id());
create policy notification_preferences_read on public.notification_preferences for select to authenticated
  using (user_id = public.request_user_id());
create policy follow_up_reminders_read on public.follow_up_reminders for select to authenticated
  using (recipient_user_id = public.request_user_id());
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (user_id = public.request_user_id());

-- Integration & audit: administrators only.
create policy integration_connections_read on public.integration_connections for select to authenticated
  using (public.is_org_admin(organization_id));
create policy webhook_events_read on public.webhook_events for select to authenticated
  using (organization_id is not null and public.is_org_admin(organization_id));
create policy outbound_events_read on public.outbound_events for select to authenticated
  using (public.is_org_admin(organization_id));
create policy outbound_delivery_attempts_read on public.outbound_delivery_attempts for select to authenticated
  using (public.is_org_admin(organization_id));
create policy mock_uniklife_records_read on public.mock_uniklife_records for select to authenticated
  using (public.is_org_admin(organization_id));
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, array['org_admin', 'sales_manager']));
