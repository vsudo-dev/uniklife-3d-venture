import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "./types";
import { hashPassword } from "@/lib/auth/password";
import { generateDemoLayout } from "@/lib/demo/layout-generator";
import { DEFAULT_LEVELS, defaultLevelLabel } from "@/lib/commissions/engine";

/**
 * DEMONSTRATION data for local development only. The venture, people and
 * approvals here are fictional and clearly labelled — never a real approved venture.
 */
export const DEMO_PASSWORD = "Demo@12345";

export const DEMO_USERS = {
  platform: "platform@uniklife.local",
  ceo: "ceo@demo.local",
  ventureManager: "venture.manager@demo.local",
  customer: "customer@demo.local",
  orgBAdmin: "admin@sample-b.local",
};

const LADDER = [
  { level: 1, name: "Arjun Rao", email: "ceo@demo.local", designation: "Chief Executive Officer", role: "org_admin" },
  { level: 2, name: "Priya Sharma", email: "priya@demo.local", designation: "Director of Sales", role: "sales_manager" },
  { level: 3, name: "Kiran Kumar", email: "kiran@demo.local", designation: "Regional Sales Head", role: "sales_manager" },
  { level: 4, name: "Lakshmi Devi", email: "lakshmi@demo.local", designation: "Senior Sales Manager", role: "sales_manager" },
  { level: 5, name: "Ravi Teja", email: "ravi@demo.local", designation: "Sales Manager", role: "sales_executive" },
  { level: 6, name: "Sneha Reddy", email: "sneha@demo.local", designation: "Team Lead", role: "sales_executive" },
  { level: 7, name: "Vikram Singh", email: "vikram@demo.local", designation: "Senior Sales Executive", role: "sales_executive" },
  { level: 8, name: "Anil Varma", email: "anil@demo.local", designation: "Sales Executive", role: "sales_executive" },
] as const;

export async function seedIfEmpty(db: Database): Promise<boolean> {
  const [row] = await db.query<{ n: number }>("select count(*)::int as n from organizations");
  if (row && row.n > 0) return false;
  await seedDemo(db);
  // Local demo databases also get sample GPS trips (Hyderabad → Zaheerabad venture).
  const { seedTrackingSamples } = await import("@/lib/demo/tracking-samples");
  await db.transaction((q) => seedTrackingSamples(q));
  return true;
}

async function insertUser(q: Queryable, email: string, fullName: string, passwordHash: string, opts: { platform?: boolean; phone?: string } = {}) {
  const [u] = await q.query<{ id: string }>(
    "insert into app_users (email, full_name, phone, password_hash, is_platform_admin) values ($1,$2,$3,$4,$5) returning id",
    [email, fullName, opts.phone ?? null, passwordHash, opts.platform ?? false],
  );
  return u.id;
}

export async function seedDemo(db: Database): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production");
  }
  // On any non-local database a private password must be supplied (the default one is public in the README).
  const password = process.env.DEMO_SEED_PASSWORD || DEMO_PASSWORD;
  if (process.env.ALLOW_DEMO_SEED === "true" && password === DEMO_PASSWORD) {
    throw new Error("Set DEMO_SEED_PASSWORD (a private password) before seeding demo data on a hosted database");
  }
  const hash = await hashPassword(password);
  await db.transaction(async (q) => {
    const platformId = await insertUser(q, DEMO_USERS.platform, "Platform Administrator", hash, { platform: true });

    // ---------------- Organization A (white-label demo) ----------------
    const [org] = await q.query<{ id: string }>(
      `insert into organizations (name, slug, contact_email, contact_phone, app_name, short_name, theme, website, next_employee_number)
       values ('Demo Ventures (Sample Org)', 'demo-ventures', 'sales@demo.local', '+91 90000 00000', 'Demo Ventures', 'DemoVent', 'royal', 'https://example.com', 118)
       returning id`,
    );
    const orgId = org.id;
    await q.query("insert into organization_domains (organization_id, domain, is_primary, verified) values ($1, 'demo.localhost:3000', true, true)", [orgId]);

    // Employees on the 8-level ladder (EMP-00118 … EMP-00125), each reporting to the previous.
    let managerId: string | null = null;
    const employeeIds: string[] = [];
    const userIds: string[] = [];
    for (const p of LADDER) {
      const uid = await insertUser(q, p.email, p.name, hash, { phone: `+91 98${String(p.level).padStart(2, "0")}0 0000${p.level}` });
      await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,$3)", [orgId, uid, p.role]);
      const [{ code }] = await q.query<{ code: string }>(
        `update organizations set next_employee_number = next_employee_number + 1 where id = $1
         returning employee_code_prefix || '-' || lpad((next_employee_number - 1)::text, 5, '0') as code`,
        [orgId],
      );
      const [e]: { id: string }[] = await q.query<{ id: string }>(
        `insert into employees (organization_id, employee_code, user_id, full_name, mobile, email, designation, commission_level, reporting_manager_id, joining_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, current_date - ($8 * 40))
         returning id`,
        [orgId, code, uid, p.name, `+91 98${String(p.level).padStart(2, "0")}0 0000${p.level}`, p.email, p.designation, p.level, managerId],
      );
      employeeIds.push(e.id);
      userIds.push(uid);
      managerId = e.id;
    }
    // A parallel team member (reports to Lakshmi, L4) — used to demonstrate network privacy.
    const deepaUser = await insertUser(q, "deepa@demo.local", "Deepa Nair", hash, { phone: "+91 98500 11111" });
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'sales_executive')", [orgId, deepaUser]);
    const [{ code: deepaCode }] = await q.query<{ code: string }>(
      `update organizations set next_employee_number = next_employee_number + 1 where id = $1
       returning employee_code_prefix || '-' || lpad((next_employee_number - 1)::text, 5, '0') as code`,
      [orgId],
    );
    const [deepa] = await q.query<{ id: string }>(
      `insert into employees (organization_id, employee_code, user_id, full_name, mobile, email, designation, commission_level, reporting_manager_id, joining_date)
       values ($1,$2,$3,'Deepa Nair','+91 98500 11111','deepa@demo.local','Sales Manager',5,$4, current_date - 120) returning id`,
      [orgId, deepaCode, deepaUser, employeeIds[3]],
    );

    // Venture manager (operations; not on the commission ladder).
    const vmUser = await insertUser(q, DEMO_USERS.ventureManager, "Suresh Babu", hash);
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'venture_manager')", [orgId, vmUser]);
    const [{ code: vmCode }] = await q.query<{ code: string }>(
      `update organizations set next_employee_number = next_employee_number + 1 where id = $1
       returning employee_code_prefix || '-' || lpad((next_employee_number - 1)::text, 5, '0') as code`,
      [orgId],
    );
    const [vm] = await q.query<{ id: string }>(
      `insert into employees (organization_id, employee_code, user_id, full_name, email, designation, reporting_manager_id, commission_eligible)
       values ($1,$2,$3,'Suresh Babu',$4,'Venture Manager',$5,false) returning id`,
      [orgId, vmCode, vmUser, DEMO_USERS.ventureManager, employeeIds[0]],
    );

    // Customer account
    const custUser = await insertUser(q, DEMO_USERS.customer, "Demo Customer", hash, { phone: "+919876500000" });
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'customer')", [orgId, custUser]);
    const [customer] = await q.query<{ id: string }>(
      "insert into customers (organization_id, user_id, full_name, email, phone) values ($1,$2,'Demo Customer',$3,'+919876500000') returning id",
      [orgId, custUser, DEMO_USERS.customer],
    );
    const [walkIn] = await q.query<{ id: string }>(
      "insert into customers (organization_id, full_name, email, phone) values ($1,'Sample Buyer (Demo)','buyer@example.com','+919876511111') returning id",
      [orgId],
    );

    // ---------------- Demonstration venture ----------------
    const [venture] = await q.query<{ id: string }>(
      `insert into ventures (organization_id, name, code, slug, description, location_text, city, state, survey_numbers,
                             approval_authority, approval_reference, total_land_area, land_area_unit, declared_total_plots,
                             roads_description, amenities, launch_date, status, is_published, is_demo, created_by)
       values ($1, 'Sunrise Meadows — DEMO', 'SUNRISE-DEMO', 'sunrise-meadows-demo',
               'DEMONSTRATION VENTURE with sample plots for product evaluation. Not a real or legally approved layout.',
               'Sample location (demonstration only)', 'Hyderabad', 'Telangana', 'Sy. No. DEMO-000 (sample)',
               'Not applicable — demonstration', 'DEMO-NOT-APPROVED', 6.5, 'acres', 80,
               '60 ft main road, 40 ft internal roads (sample)', array['Clubhouse','Central park','Underground drainage','Street lighting'],
               current_date - 30, 'launched', true, true, $2)
       returning id`,
      [orgId, userIds[0]],
    );
    const ventureId = venture.id;
    // Sample geofence centre (illustrative coordinates, not a real venture site).
    await q.query("update ventures set latitude = 17.385000, longitude = 78.486700, geofence_radius_m = 300 where id = $1", [ventureId]);
    for (const id of [...employeeIds, deepa.id, vm.id]) {
      await q.query("insert into venture_assignments (organization_id, venture_id, employee_id) values ($1,$2,$3)", [orgId, ventureId, id]);
    }

    const layout = generateDemoLayout();
    const phaseIds = new Map<string, string>();
    for (const [i, code] of ["A", "B", "C", "D"].entries()) {
      const [ph] = await q.query<{ id: string }>(
        "insert into venture_phases (organization_id, venture_id, name, code, sort_order) values ($1,$2,$3,$4,$5) returning id",
        [orgId, ventureId, `Block ${code}`, code, i],
      );
      phaseIds.set(code, ph.id);
    }
    const plotIdByNumber = new Map<string, string>();
    for (const p of layout.plots) {
      const premium = p.isCorner ? 1500 : 0;
      const eastWest = p.facing === "E" ? 1000 : 0;
      const price = 18000 + premium + eastWest + (p.phaseCode === "C" || p.phaseCode === "D" ? 500 : 0);
      const [plot] = await q.query<{ id: string }>(
        `insert into plots (organization_id, venture_id, phase_id, plot_number, area_sq_yards, length_ft, width_ft, dimensions_text,
                            facing, road_width_ft, is_corner, base_price_per_sq_yard)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [orgId, ventureId, phaseIds.get(p.phaseCode), p.plotNumber, p.areaSqYards, p.lengthFt, p.widthFt, `${p.widthFt} ft × ${p.lengthFt} ft`,
          p.facing, p.roadWidthFt, p.isCorner, price],
      );
      plotIdByNumber.set(p.plotNumber, plot.id);
      await q.query(
        `insert into plot_geometry (organization_id, venture_id, plot_id, mesh_id, polygon, centroid_x, centroid_y, source)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,'generated')`,
        [orgId, ventureId, plot.id, p.meshId, JSON.stringify(p.polygon), p.centroid[0], p.centroid[1]],
      );
      await q.query("insert into plot_prices (organization_id, plot_id, price_per_sq_yard, reason, created_by) values ($1,$2,$3,'Launch price (demo)',$4)",
        [orgId, plot.id, price, userIds[0]]);
    }
    for (const f of layout.features) {
      await q.query(
        "insert into venture_features (organization_id, venture_id, kind, name, polygon) values ($1,$2,$3,$4,$5::jsonb)",
        [orgId, ventureId, f.kind, f.name, JSON.stringify(f.polygon)],
      );
    }
    // Blocked plots (e.g. held back by management)
    await q.query(
      "update plots set status = 'blocked', blocked_reason = 'Held back by management (demo)' where venture_id = $1 and plot_number = any($2::text[])",
      [ventureId, ["39", "40"]],
    );

    // ---------------- Commission plans (approved) ----------------
    // v1: organization-wide, any property type, 8 levels, ₹ per sq yd.
    // v2: organization-wide, villa plots only, 5 levels, % of the sale value.
    const demoPlans = [
      {
        version: 1, name: "Standard 8-level plan (demo)", levelCount: 8, basis: "per_sq_yard", propertyType: "any",
        notes: "Proposed default per-sq-yd rates. Level 8 (seventh line) is administrator-configurable.",
        levels: DEFAULT_LEVELS.map((l) => ({ level: l.level, label: l.label, rate: l.rate })),
      },
      {
        version: 2, name: "Villa plots — 5 levels, % of sale value (demo)", levelCount: 5, basis: "percentage", propertyType: "villa_plot",
        notes: "Villa / plot-with-construction sales are paid as a percentage of the booking's net sale value.",
        levels: [2.0, 1.5, 1.0, 0.75, 0.5].map((rate, i) => ({ level: i + 1, label: defaultLevelLabel(i + 1), rate })),
      },
    ] as const;
    for (const dp of demoPlans) {
      const [plan] = await q.query<{ id: string }>(
        `insert into commission_plans (organization_id, name, version, calculation_method, pay_selling_employee, ceo_separate_entitlement,
                                       max_payable_levels, level_count, basis, property_type, venture_ids, notes, created_by)
         values ($1, $2, $3, 'differential', true, false, $4, $4, $5, $6, '{}', $7, $8) returning id`,
        [orgId, dp.name, dp.version, dp.levelCount, dp.basis, dp.propertyType, dp.notes, userIds[0]],
      );
      for (const l of dp.levels) {
        await q.query(
          "insert into commission_plan_levels (organization_id, plan_id, level, label, rate_per_sq_yard, rate_percent, is_eligible) values ($1,$2,$3,$4,$5,$6,true)",
          [orgId, plan.id, l.level, l.label, dp.basis === "per_sq_yard" ? l.rate : 0, dp.basis === "percentage" ? l.rate : null],
        );
      }
      await q.query("update commission_plans set status = 'pending_approval', submitted_by = $2, submitted_at = now() - interval '40 days' where id = $1", [plan.id, userIds[0]]);
      await q.query(
        "update commission_plans set status = 'active', approved_by = $2, approved_at = now() - interval '39 days', effective_from = now() - interval '39 days' where id = $1",
        [plan.id, platformId],
      );
      await q.query(
        `insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note, created_at) values
           ($1,$2,'created',$3,null, now() - interval '41 days'),
           ($1,$2,'submitted',$3,'Initial plan', now() - interval '40 days'),
           ($1,$2,'approved',$4,'Approved for demo', now() - interval '39 days')`,
        [orgId, plan.id, userIds[0], platformId],
      );
    }

    // ---------------- Discounts ----------------
    await q.query(
      `insert into discounts (organization_id, name, code, value_type, category, value, max_discount_amount, starts_at, expires_at,
                              applicable_venture_ids, status, approved_by, approved_at, created_by, requires_approval, usage_limit_total)
       values
       ($1,'Launch offer 5%','LAUNCH5','percentage','coupon',5,150000, now() - interval '10 days', now() + interval '60 days', array[$2]::uuid[], 'active',$3, now(), $4, false, 100),
       ($1,'Festive ₹50,000 off','FESTIVE50K','fixed_amount','promotional',50000,null, now() - interval '2 days', now() + interval '30 days', '{}', 'active',$3, now(), $4, true, 50),
       ($1,'Expired monsoon offer','MONSOON10','percentage','coupon',10,null, now() - interval '90 days', now() - interval '30 days', '{}', 'active',$3, now(), $4, true, null),
       ($1,'Big-ticket 15% (awaiting approval)','BIG15','percentage','coupon',15,null, now(), now() + interval '90 days', '{}', 'pending_approval', null, null, $5, true, null)`,
      [orgId, ventureId, platformId, userIds[0], userIds[1]],
    );
    await q.query(
      `insert into discounts (organization_id, name, value_type, category, value, applicable_plot_ids, status, approved_by, approved_at, created_by, stackable)
       values ($1,'Corner plot loyalty 1%','percentage','plot',1, $2::uuid[], 'active', $3, now(), $4, true)`,
      [orgId, ["1", "10", "21", "30"].map((n) => plotIdByNumber.get(n)), userIds[0], userIds[0]],
    );
    await q.query(
      `insert into discounts (organization_id, name, code, value_type, category, value, customer_id, status, approved_by, approved_at, created_by, usage_limit_per_customer)
       values ($1,'Demo Customer referral ₹25,000','REFER-DEMO','fixed_amount','customer',25000,$2,'active',$3, now(),$4,1)`,
      [orgId, customer.id, platformId, userIds[0]],
    );

    // ---------------- Integration: mock UNIKLIFE.AI connector ----------------
    await q.query(
      `insert into integration_connections (organization_id, provider, name, mode, is_enabled, auth_type, outbound_secret_env, inbound_secret_env, event_mappings)
       values ($1, 'uniklife', 'UNIKLIFE.AI (mock)', 'mock', true, 'hmac', 'UNIKLIFE_OUTBOUND_SECRET', 'UNIKLIFE_WEBHOOK_SECRET', '{}'::jsonb)`,
      [orgId],
    );

    // ---------------- Demonstration bookings (simulated payments) ----------------
    const seller = employeeIds[7]; // Anil Varma, EMP-00125
    const sellerUser = userIds[7];
    const chainSnapshot = async () => {
      const chain = await q.query<{ id: string; employee_code: string; full_name: string; designation: string; commission_level: number }>(
        `with recursive up(id, depth) as (select $1::uuid, 0 union all select e.reporting_manager_id, up.depth + 1 from employees e join up on e.id = up.id where e.reporting_manager_id is not null)
         select e.id, e.employee_code, e.full_name, e.designation, e.commission_level from up join employees e on e.id = up.id order by up.depth`,
        [seller],
      );
      return {
        captured_at: new Date().toISOString(), created_by_user_id: sellerUser, created_by_name: "Anil Varma",
        seller: { employee_id: chain[0].id, employee_code: chain[0].employee_code, name: chain[0].full_name, designation: chain[0].designation, level: 8 },
        reporting_manager: { employee_id: chain[1].id, employee_code: chain[1].employee_code, name: chain[1].full_name },
        chain: chain.map((m, depth) => ({ depth, employee_id: m.id, employee_code: m.employee_code, name: m.full_name, designation: m.designation, level: m.commission_level, active: true, commission_eligible: true })),
      };
    };
    const demoBooking = async (plotNumbers: string[], cust: string, complete: boolean) => {
      const plots = await q.query<{ id: string; plot_number: string; area_sq_yards: string; base_price_per_sq_yard: string }>(
        "select id, plot_number, area_sq_yards, base_price_per_sq_yard from plots where venture_id = $1 and plot_number = any($2::text[]) order by plot_number",
        [ventureId, plotNumbers],
      );
      const lines = plots.map((p) => {
        const area = Number(p.area_sq_yards);
        const rate = Number(p.base_price_per_sq_yard);
        const base = Math.round(area * rate * 100) / 100;
        return { plotId: p.id, plotNumber: p.plot_number, areaSqYards: area, pricePerSqYard: rate, baseAmount: base, discountAmount: 0, netAmount: base };
      });
      const base = Math.round(lines.reduce((s, l) => s + l.baseAmount, 0) * 100) / 100;
      const area = Math.round(lines.reduce((s, l) => s + l.areaSqYards, 0) * 100) / 100;
      const advance = Math.round(base * 0.1 * 100) / 100;
      const snapshot = {
        version: 2, computedAt: new Date().toISOString(), currency: "INR", ventureId, plots: lines, totalAreaSqYards: area, baseAmount: base,
        discounts: [], discountTotal: 0, cappedByOrganizationLimit: false, netAmount: base, bookingAmountPercent: 10, bookingAmount: advance,
      };
      const group = randomUUID();
      for (const l of lines) {
        await q.query(
          `insert into reservations (organization_id, venture_id, plot_id, customer_id, hold_group_id, created_by, credited_employee_id, status, expires_at, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7,'active', now() + interval '1 day', $8)`,
          [orgId, ventureId, l.plotId, cust, group, sellerUser, seller, `seed-hold-${group}`],
        );
      }
      const [b] = await q.query<{ id: string }>(
        `insert into bookings (organization_id, venture_id, customer_id, hold_group_id, plot_count, total_area_sq_yards, credited_employee_id,
                               attribution_snapshot, base_amount, discount_amount, net_amount, booking_amount, pricing_snapshot, idempotency_key,
                               payment_due_at, requested_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,0,$9,$10,$11::jsonb,$12, now() + interval '1 day', $13, now() - interval '5 days') returning id`,
        [orgId, ventureId, cust, group, lines.length, area, seller, await chainSnapshot(), base, advance, snapshot, `seed-booking-${group}`, sellerUser],
      );
      for (const l of lines) {
        await q.query(
          `insert into booking_plots (organization_id, booking_id, plot_id, plot_number, area_sq_yards, price_per_sq_yard, base_amount, discount_amount, net_amount)
           values ($1,$2,$3,$4,$5,$6,$7,0,$7)`,
          [orgId, b.id, l.plotId, l.plotNumber, l.areaSqYards, l.pricePerSqYard, l.baseAmount],
        );
      }
      await q.query(
        `insert into payment_transactions (organization_id, booking_id, customer_id, provider, provider_reference, amount, status, is_simulated, idempotency_key, verified_at)
         values ($1,$2,$3,'mock',$4,$5,'verified',true,$6, now() - interval '4 days')`,
        [orgId, b.id, cust, `mock_seed_${b.id.slice(0, 8)}`, complete ? base : advance, `seed-pay-${b.id}`],
      );
      await q.query(
        `update bookings set status = 'confirmed', confirmed_at = now() - interval '4 days', confirmation_source = 'payment_webhook',
                confirmed_pricing_snapshot = pricing_snapshot where id = $1`,
        [b.id],
      );
      await q.query("update reservations set status = 'converted' where hold_group_id = $1", [group]);
      if (complete) await q.query("update bookings set status = 'completed', completed_at = now() - interval '2 days' where id = $1", [b.id]);
      await q.query("update plots set status = $2 where id = any($1::uuid[])", [lines.map((l) => l.plotId), complete ? "sold" : "booked"]);
      return b.id;
    };
    await demoBooking(["5", "6"], walkIn.id, false);
    await demoBooking(["12"], walkIn.id, true);

    // ---------------- Organization B (tenant isolation demo) ----------------
    const [orgB] = await q.query<{ id: string }>(
      `insert into organizations (name, slug, contact_email, app_name, short_name, theme)
       values ('Sample Realty B (Demo)', 'sample-realty-b', 'info@sample-b.local', 'Sample Realty', 'SampleB', 'midnight') returning id`,
    );
    await q.query("insert into organization_domains (organization_id, domain, is_primary, verified) values ($1, 'sample.localhost:3000', true, true)", [orgB.id]);
    const bAdmin = await insertUser(q, DEMO_USERS.orgBAdmin, "Org B Administrator", hash);
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'org_admin')", [orgB.id, bAdmin]);
    await q.query(
      `insert into employees (organization_id, employee_code, user_id, full_name, designation, commission_level)
       values ($1,'EMP-00001',$2,'Org B Administrator','Managing Director',1)`,
      [orgB.id, bAdmin],
    );
    await q.query(
      `insert into ventures (organization_id, name, code, slug, status, is_published, is_demo, description)
       values ($1, 'Green Acres — DEMO (Org B)', 'GREEN-DEMO', 'green-acres-demo-b', 'upcoming', true, true, 'Demonstration venture for a second tenant.')`,
      [orgB.id],
    );

    await q.query(
      `insert into audit_logs (organization_id, actor_type, action, entity_type, summary) values
         ($1, 'system', 'seed.demo', 'organization', 'Demonstration data created (not real ventures, people or approvals)'),
         ($2, 'system', 'seed.demo', 'organization', 'Demonstration data created')`,
      [orgId, orgB.id],
    );
  });
}
