# Brief: build the cyberlab web app

_Paste this into a fresh Claude Code (Fable 5) session opened in the `cyberlab` repo. It is
self-contained — everything needed is here or in the linked files._

---

You are building the public website for **cyberlab.isaacwallace.dev**. Work in `web/`. A working
scaffold already exists there (Next.js 15 App Router + React 19 + TypeScript). Your job is to take it
to a polished, production-quality app, restyled with the stack below. **Keep the data/engine layers;
rebuild the styling.** Read `web/README.md` first — it maps every file.

## What cyberlab is (context you need)

A self-hosted **cyber range** on Proxmox: real Kali attackers, Windows/Ubuntu victims, and a Wazuh
SOC on isolated networks, provisioned as code (Terraform/Ansible/Packer). Scenarios run as a
**two-phase** system:

- **Phase 1 (capture):** a scenario runs on real VMs and every action of every actor is recorded to
  a `cyberlab-recording/1` JSON (spec: `schemas/recording.schema.json`; producer:
  `tools/scenario-player/`). Actors have roles: **attacker** (black hat), **responder** (white hat /
  SOC), **hardener** (red hat), **victim**.
- **Phase 2 (replay):** those recordings become **case studies** — replayed step by step with each
  command and detection explained. There's a working vanilla-HTML prototype of this replay at
  `tools/scenario-player/web/theater.html` — open it to see the intended feel (terminals typing
  themselves, a steps panel, role-coded actors).

## What the website must do

1. **Explain the project + its purpose** — what the range is, why it exists. (Home page.)
2. **Case studies** — a gallery of recorded scenarios; each opens to a **step-by-step replay** with
   terminals that type themselves and an explanation panel. Both scripted demos and real captures.
3. **Live** — a **read-only, non-interactive** view of scenarios running _now_. The range runs
   scenarios continuously; show the live VM screen (the currently-acting terminal), a live activity
   feed of what's happening, and let a visitor **queue** a scenario to run next.

## Tech stack (required)

- **Next.js 15 App Router + React 19 + TypeScript** (already scaffolded).
- **Tailwind CSS v4 + shadcn/ui** — this is the main change from the current scaffold, which uses
  hand-authored CSS. Set up Tailwind v4 (`@tailwindcss/postcss`, `@import "tailwindcss"` in globals,
  `@theme` tokens) and shadcn/ui (`components.json`, `lib/utils` `cn()`, Radix-based primitives).
  Use shadcn for **chrome** — Button, Card, Badge, Select, Tabs, Sonner (toasts), etc.
- Keep **the two bespoke visual engines in scoped CSS**, not Tailwind utility soup: the
  `ScenarioPlayer` stage (absolutely-positioned terminals, char-by-char typewriter, `color-mix` role
  theming) and the live VM screen. Their _logic_ in `components/ScenarioPlayer.tsx` and
  `components/LiveView.tsx` is solid — reuse it; retheme from shared CSS variables.

## Design direction — cyberlab's OWN identity

This is a **separate subdomain from the main portfolio** and gets its own distinctive look — **do not
adopt the default shadcn/zinc appearance**, and don't mirror any other project's theme. The
established direction (keep and refine it): a dark **operations-console** world — the page reads as a
screen. The three actor roles carry the colour story and should stay first-class:

- attacker = hostile rose `#ff5d7d`, responder = cool cyan `#45c9dd`, hardener = defensive amber
  `#f5a524`, victim = muted violet `#b79cff`. One live **accent shifts to whoever is acting**.
- Deliberate **single dark theme** (an ops room is dark) — make that a choice, not an omission.
- Theme shadcn's CSS variables (`--background`, `--card`, `--primary`, `--border`, …) to this palette
  so the components inherit the identity. Take real design care: a strong hero, considered type scale,
  motion used with intent (the terminals typing is the signature moment). You have latitude here —
  make it genuinely distinctive, not templated.

## What to preserve (do not rewrite)

- `src/lib/*` — `types.ts` (the `CaseStudy` / `LiveState` contract), `recording.ts` (the
  `cyberlab-recording/1 → CaseStudy` adapter), `scenarios.ts` (registry), `liveSim.ts` (simulated
  live engine). These are the domain layer.
- `src/content/*` — case-study JSON + the real capture `example-local-recon.recording.json`.
- `src/app/api/live/*` — the live + queue endpoints and their `LiveState` response shape.
- The **engine logic** inside `ScenarioPlayer.tsx` / `LiveView.tsx` (typewriter, scrub, polling).

## Architecture rules (important)

- **The live view is simulated behind a stable seam.** `lib/liveSim.ts` fakes an "always running"
  session from the clock so `/live` moves today. When the real backend exists, _only that file
  changes_ — the `LiveState` shape and API routes are the contract. Do not hardcode live data into
  components.
- **Live must stay read-only + non-interactive**, reaching only the disposable scenario segment.
  Never expose Kali/SSH/Wazuh-admin/Proxmox/management. See `docs/portfolio-subdomains.md` and
  `docs/security-boundaries.md`. The queue is a _request_ a future orchestrator drains
  (clone disposables → run → teardown), not direct lab control. Real live streaming will be
  **read-only Apache Guacamole** (repo already has `ansible/roles/guacamole/`), brokered by a narrow
  server route issuing short-lived scoped tokens — build the `/live` UI so that drops in.
- Not a static export: keep public content static/SSG, run live/admin as server routes.

## Definition of done

- Tailwind v4 + shadcn/ui set up; UI restyled to the cyberlab ops-console identity (both chrome and
  the bespoke widgets consistent via shared tokens).
- Home, case-study gallery, case-study detail (with the replay player), and live (VM screen + activity
  feed + queue) all polished and responsive.
- `npm run build` and `npm run typecheck` pass. Verify the replay actually animates and `/live` polls
  and moves; queue a scenario and confirm the feedback path.
- Accessible: keyboard focus states, `prefers-reduced-motion` respected, real labels.

Start by reading `web/README.md` and skimming `web/src/lib/types.ts`, then set up Tailwind + shadcn,
then restyle page by page. Ask me before changing the `CaseStudy`/`LiveState` contracts or the
recording format.
