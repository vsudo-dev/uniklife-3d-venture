-- Integrity guards: cross-organization consistency, booking state machine,
-- immutable confirmed pricing, attribution locking, hierarchy cycles and an
-- append-only audit log.

-- ---------------------------------------------------------------------------
-- Composite foreign keys guarantee child rows belong to the same organization
-- as their parents (a plot can never point at another tenant's venture, etc).
-- ---------------------------------------------------------------------------
alter table public.ventures add constraint ventures_org_id_key unique (organization_id, id);
alter table public.plots add constraint plots_org_id_key unique (organization_id, id);
alter table public.customers add constraint customers_org_id_key unique (organization_id, id);
alter table public.bookings add constraint bookings_org_id_key unique (organization_id, id);
alter table public.discounts add constraint discounts_org_id_key unique (organization_id, id);
alter table public.reservations add constraint reservations_org_id_key unique (organization_id, id);
alter table public.employees add constraint employees_org_id_key unique (organization_id, id);

alter table public.employees
  add constraint employees_manager_same_org foreign key (organization_id, reporting_manager_id) references public.employees (organization_id, id);
alter table public.venture_assignments
  add constraint venture_assignments_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade,
  add constraint venture_assignments_employee_same_org foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade;
alter table public.plots
  add constraint plots_venture_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id);
alter table public.plot_geometry
  add constraint plot_geometry_plot_same_org foreign key (organization_id, plot_id) references public.plots (organization_id, id) on delete cascade;
alter table public.venture_assets
  add constraint venture_assets_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade;
alter table public.venture_phases
  add constraint venture_phases_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade;
alter table public.venture_features
  add constraint venture_features_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade;
alter table public.enquiries
  add constraint enquiries_venture_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id) on delete cascade,
  add constraint enquiries_employee_same_org foreign key (organization_id, assigned_employee_id) references public.employees (organization_id, id);
alter table public.reservations
  add constraint reservations_plot_same_org foreign key (organization_id, plot_id) references public.plots (organization_id, id),
  add constraint reservations_customer_same_org foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  add constraint reservations_employee_same_org foreign key (organization_id, credited_employee_id) references public.employees (organization_id, id);
alter table public.bookings
  add constraint bookings_venture_same_org foreign key (organization_id, venture_id) references public.ventures (organization_id, id),
  add constraint bookings_customer_same_org foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  add constraint bookings_employee_same_org foreign key (organization_id, credited_employee_id) references public.employees (organization_id, id);
alter table public.booking_plots
  add constraint booking_plots_booking_same_org foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade,
  add constraint booking_plots_plot_same_org foreign key (organization_id, plot_id) references public.plots (organization_id, id),
  add constraint booking_plots_reservation_same_org foreign key (organization_id, reservation_id) references public.reservations (organization_id, id);
alter table public.booking_attribution_changes
  add constraint booking_attribution_changes_same_org foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade;
alter table public.payment_transactions
  add constraint payment_transactions_booking_same_org foreign key (organization_id, booking_id) references public.bookings (organization_id, id),
  add constraint payment_transactions_customer_same_org foreign key (organization_id, customer_id) references public.customers (organization_id, id);
alter table public.discount_redemptions
  add constraint discount_redemptions_booking_same_org foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade,
  add constraint discount_redemptions_discount_same_org foreign key (organization_id, discount_id) references public.discounts (organization_id, id);

-- ---------------------------------------------------------------------------
-- Reporting hierarchy: no cycles.
-- ---------------------------------------------------------------------------
create or replace function public.guard_employee_hierarchy() returns trigger
language plpgsql
as $$
begin
  if new.reporting_manager_id is not null then
    if exists (
      with recursive chain(id, depth) as (
        select e.reporting_manager_id, 1 from public.employees e where e.id = new.reporting_manager_id
        union all
        select e.reporting_manager_id, c.depth + 1
          from public.employees e join chain c on e.id = c.id
         where c.id is not null and c.depth < 64
      )
      select 1 from chain where id = new.id
    ) or new.reporting_manager_id = new.id then
      raise exception 'reporting hierarchy cycle detected for employee %', new.employee_code using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

create trigger employees_hierarchy_guard before insert or update of reporting_manager_id on public.employees
  for each row execute function public.guard_employee_hierarchy();

-- ---------------------------------------------------------------------------
-- Booking state machine + payment-verified confirmation + immutable pricing
-- ---------------------------------------------------------------------------
create or replace function public.guard_booking_update() returns trigger
language plpgsql
as $$
declare
  verified_total numeric;
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'payment_pending' and new.status in ('confirmed', 'cancelled', 'expired')) or
      (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
    ) then
      raise exception 'invalid booking status transition % -> %', old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'confirmed' and old.status = 'payment_pending' then
    if new.confirmed_pricing_snapshot is null or new.confirmation_source is null or new.confirmed_at is null then
      raise exception 'confirmed booking requires a pricing snapshot, confirmation source and timestamp'
        using errcode = 'P0001';
    end if;
    -- A booking can only be confirmed against server-verified payments.
    select coalesce(sum(amount), 0) into verified_total
      from public.payment_transactions
     where booking_id = new.id and status = 'verified';
    if verified_total < new.booking_amount then
      raise exception 'booking % cannot be confirmed: verified payments % < booking amount %',
        new.booking_number, verified_total, new.booking_amount
        using errcode = 'P0001';
    end if;
  end if;

  if old.status in ('confirmed', 'completed') then
    if new.confirmed_pricing_snapshot is distinct from old.confirmed_pricing_snapshot
       or new.pricing_snapshot is distinct from old.pricing_snapshot
       or new.base_amount is distinct from old.base_amount
       or new.discount_amount is distinct from old.discount_amount
       or new.net_amount is distinct from old.net_amount
       or new.booking_amount is distinct from old.booking_amount
       or new.total_area_sq_yards is distinct from old.total_area_sq_yards
       or new.plot_count is distinct from old.plot_count
       or new.discount_codes is distinct from old.discount_codes then
      raise exception 'pricing of a confirmed booking is immutable' using errcode = 'P0001';
    end if;
  end if;

  if new.customer_id is distinct from old.customer_id or new.organization_id is distinct from old.organization_id
     or new.venture_id is distinct from old.venture_id then
    raise exception 'booking customer/venture/organization cannot be changed' using errcode = 'P0001';
  end if;

  -- Attribution cannot change once commissions were approved.
  if old.attribution_locked and (new.credited_employee_id is distinct from old.credited_employee_id
                                 or new.attribution_snapshot is distinct from old.attribution_snapshot) then
    raise exception 'sales attribution is locked because commissions were approved' using errcode = 'P0001';
  end if;
  if old.attribution_locked and not new.attribution_locked then
    raise exception 'attribution lock cannot be removed' using errcode = 'P0001';
  end if;

  return new;
end
$$;

create trigger bookings_guard before update on public.bookings
  for each row execute function public.guard_booking_update();

-- Keep booking_plots.is_live in step with the parent booking status.
create or replace function public.sync_booking_plots_live() returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    update public.booking_plots
       set is_live = new.status in ('payment_pending', 'confirmed', 'completed')
     where booking_id = new.id;
  end if;
  return new;
end
$$;

create trigger bookings_sync_plots after update of status on public.bookings
  for each row execute function public.sync_booking_plots_live();

create or replace function public.guard_booking_plots_update() returns trigger
language plpgsql
as $$
begin
  if new.plot_id is distinct from old.plot_id or new.booking_id is distinct from old.booking_id
     or new.base_amount is distinct from old.base_amount or new.net_amount is distinct from old.net_amount
     or new.discount_amount is distinct from old.discount_amount or new.area_sq_yards is distinct from old.area_sq_yards
     or new.price_per_sq_yard is distinct from old.price_per_sq_yard then
    raise exception 'booking plot lines are immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger booking_plots_guard before update on public.booking_plots
  for each row execute function public.guard_booking_plots_update();

create or replace function public.guard_booking_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'bookings cannot be deleted; cancel them instead' using errcode = 'P0001';
end
$$;

create trigger bookings_guard_delete before delete on public.bookings
  for each row execute function public.guard_booking_delete();

-- Verified payments are final (only a refund transition is allowed).
create or replace function public.guard_payment_update() returns trigger
language plpgsql
as $$
begin
  if old.status = 'verified' and new.status not in ('verified', 'refunded') then
    raise exception 'verified payment cannot move to %', new.status using errcode = 'P0001';
  end if;
  if old.status in ('verified', 'refunded') and (new.amount is distinct from old.amount or new.booking_id is distinct from old.booking_id) then
    raise exception 'amount/booking of a verified payment is immutable' using errcode = 'P0001';
  end if;
  if new.is_simulated is distinct from old.is_simulated then
    raise exception 'is_simulated cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger payment_transactions_guard before update on public.payment_transactions
  for each row execute function public.guard_payment_update();

-- ---------------------------------------------------------------------------
-- Append-only audit log
-- ---------------------------------------------------------------------------
create or replace function public.forbid_audit_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = 'P0001';
end
$$;

create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function public.forbid_audit_mutation();
create trigger audit_logs_no_delete before delete on public.audit_logs
  for each row execute function public.forbid_audit_mutation();
