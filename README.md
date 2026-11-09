# UNIKLIFE 3D Venture

Multi-tenant SaaS for real-estate ventures: an interactive 3D venture viewer with cinematic and live-plot-intelligence modes, multi-plot booking with server-verified payments, discounts, flexible multi-level commissions, a network hierarchy, site-visit GPS trip tracking, notifications, white-label PWA branding, and a UNIKLIFE.AI CRM integration adapter (mock until verified).

> **Demonstration data.** "Sunrise Meadows — DEMO" and every person, approval and payment in the seed are fictional. Payments use a **mock provider** and are labelled **SIMULATED**. The UNIKLIFE.AI connector runs in **mock** mode.

## Quick start (local)

Requirements: Node.js 20.11+ (tested on 24.19), npm. No Docker or Postgres install needed — local development uses **PGlite** (PostgreSQL 18 compiled to WASM) under `.data/`.

```bash
npm install
npm run dev            # http://localhost:3000 — migrates and seeds demo data on first run
```

| URL | What |
| --- | --- |
| http://localhost:3000/login | Sign in (demo accounts are listed on the page in development) |
| http://localhost:3000/ventures | Ventures → open **Sunrise Meadows — DEMO** for the 3D viewer |
| http://demo.localhost:3000 | Same app resolved to the **Demo Ventures** tenant (white-label branding/manifest) |
| http://sample.localhost:3000 | Second tenant **Sample Realty B** (isolation demo) |

`*.localhost` resolves to your machine in Chrome/Edge. Each tenant domain has its own manifest, icons and install identity.

### Demo accounts (password `Demo@12345`, local only)

| Email | Role | Notes |
| --- | --- | --- |
| platform@uniklife.local | Platform administrator | All organizations |
| ceo@demo.local | Org admin, Level 1 (EMP-00118) | Commission plans, settlements, branding |
| priya / kiran / lakshmi @demo.local | Sales managers L2–L4 | Lakshmi sees her whole downline |
| ravi / sneha / vikram @demo.local | Sales executives L5–L7 | Uplines of Anil |
| anil@demo.local | Sales executive L8 (**EMP-00125**) | Seller in the demo bookings |
| deepa@demo.local | L5 in a parallel team | Cannot see Anil's team (privacy demo) |
| venture.manager@demo.local | Venture manager | Operations |
| customer@demo.local | Customer | Customer portal |
| admin@sample-b.local | Org admin of tenant B | Isolation demo |

## Demonstrations

- **3D viewer** (`/ventures/<id>`): opens in **Aerial overview** → *Start Cinematic Tour* (pause / skip / speed / exit; any wheel/drag interrupts) → zoom in and it switches automatically to **Live plot intelligence** (status colours, plot numbers, HELD/SOLD text labels) → zoom out to return. Modes: Aerial, Tour, Top, Live plots, **Hologram**. 2D fallback for devices without WebGL. Live availability via Server-Sent Events.
- **Multi-plot cart**: tap a plot → *Add to cart*; tap another → *Add to cart*… or switch on **Tap to add** to add with one tap. Compare up to 3 plots. *Proceed to booking* re-validates availability on the server.
- **Booking**: hold (with countdown) → discounts (server price preview; try `LAUNCH5`, `FESTIVE50K`; `MONSOON10` is expired) → booking → *Collect advance (simulated)* → mock checkout → the booking is confirmed **only** by the signed server-side webhook.
- **Upline notifications**: book as `anil@demo.local`, then sign in as `vikram@demo.local` → bell shows "Your team member Anil Varma has reserved Plots …".
- **Commissions** (`/commissions/plans`): any number of levels (1–12), ₹ per sq yd **or** % of sale value, plans scoped by venture and property type; edit = new version; simulator; approvals; weekly/monthly settlements with XLSX and finance reconciliation.
- **Network** (`/network`): own downline tree only.
- **Site-visit trip tracking** (`/site-visits` → *Track trip*; team view `/site-visits/tracking`): consent → GPS while the page is open → geofence auto-arrival → stage times (start, arrival, visit, completion, leave, return).
- **Themes**: 12 brand themes (Settings → Branding) × Light / Dark / Night / System (header switcher). Per-venture viewer & theme settings: Edit venture → Presentation.
- **PWA**: install prompt (Android/desktop Chrome) or Add-to-Home-Screen instructions (iOS Safari); offline fallback page.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (PGlite, auto-migrate + demo seed) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Vitest unit + integration tests (in-memory Postgres per file) |
| `npm run test:e2e` | Playwright browser tests (desktop + mobile) against a running app |
| `npm run db:reset` | Recreate the local database (stop `npm run dev` first) |
| `npm run outbox:process` | Deliver pending integration events once |
| `npm run assets:sample-glb` | Regenerate `public/samples/demo-venture.glb` |

## Documentation

- [docs/STATUS.md](docs/STATUS.md) — what is complete, mocked, untested or blocked
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase + Vercel + GoDaddy CNAME
- [docs/INTEGRATION.md](docs/INTEGRATION.md) — UNIKLIFE.AI adapter, events, webhook signatures
- [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md)
- [docs/DEV_CONVENTIONS.md](docs/DEV_CONVENTIONS.md) — code layout and rules
