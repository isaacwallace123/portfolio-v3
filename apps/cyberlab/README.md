# cyberlab-web

The public application for **cyberlab.isaacwallace.dev** — a self-hosted cyber range. Three jobs:

1. **Explain the project** — what the range is and why it exists.
2. **Case studies** — recorded attack-and-defend scenarios, replayed step by step with every command
   and detection explained.
3. **Live** — a read-only, non-interactive view of scenarios running now, with a queue.

Next.js 15 (App Router) + React 19 + TypeScript. This scaffold ships with a hand-authored CSS design
system; the **intended production stack adds Tailwind v4 + shadcn/ui** — see `FABLE-BRIEF.md`, which
is the brief for that work.

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## What's built

```
src/
  app/
    layout.tsx              root layout + nav + footer
    page.tsx                home — what it is / why / featured case studies
    globals.css             design system (ops-console tokens, dark, single-theme)
    scenarios/page.tsx      case-study gallery
    scenarios/[id]/page.tsx case-study detail — renders <ScenarioPlayer/> + purpose (SSG)
    live/page.tsx           live view (force-dynamic)
    api/live/route.ts       GET live state
    api/live/queue/route.ts POST enqueue a scenario
  components/
    Nav.tsx                 top nav (client, active-route aware)
    CaseStudyCard.tsx       gallery card (server)
    ScenarioPlayer.tsx      the replay engine (client): terminals type themselves, steps panel, scrub
    ScenarioPlayer.module.css
    LiveView.tsx            live VM screen + activity feed + queue (client, polls /api/live)
    LiveView.module.css
  lib/
    types.ts                CaseStudy, Step, Terminal, LiveState, … (the domain contract)
    recording.ts            cyberlab-recording/1  ->  CaseStudy adapter
    scenarios.ts            case-study registry (scripted + captured)
    liveSim.ts              simulated "always running" live engine
  content/
    scenarios/*.json        hand-authored case studies (CaseStudy shape)
    recordings/*.recording.json  real captures (cyberlab-recording/1)
```

## Architecture notes

**The data contract is the point.** Everything downstream — gallery, player, live view — speaks the
`CaseStudy` and `LiveState` types in `lib/types.ts`. Case studies come from two sources that converge
on one shape: hand-authored scripts (`content/scenarios/`) and **real captures** run through
`recordingToCaseStudy` (`lib/recording.ts`). The recording format, `cyberlab-recording/1`, is produced
by the lab tooling (`../tools/scenario-player/player.py --record` / `orchestrate.py --record`) and
specified in `../schemas/recording.schema.json`. `content/recordings/example-local-recon.recording.json`
is a genuine capture, included to prove the pipeline end to end.

**The live view is simulated — for now, behind a stable seam.** `lib/liveSim.ts` derives a plausible
"always running" session from the wall clock so `/live` genuinely moves. The API routes and the
`LiveState` shape are the contract; when the real backend exists, **only `lib/liveSim.ts` changes** —
swap the clock math for the orchestrator's session state and a read-only Guacamole stream URL, set
`streamMode: "guacamole"`, and the page + types stay put.

**Security posture (see `../docs/portfolio-subdomains.md`).** Public views are read-only and sanitized.
The live VM view must be **non-interactive** and reach only the disposable scenario segment — never
management, the SOC, Proxmox, or the real Kali. The queue is a request that a future orchestrator
drains (clone disposable VMs → run → teardown); it is not direct lab control. The public app must never
expose Kali/SSH/Wazuh-admin/Proxmox. Keep the public content static; run the live/admin routes as
server routes behind auth and a private tunnel to the lab.

## Deploy

Not a static export — the live/admin routes need the Node server runtime (they broker sanitized data
and, later, scoped read-only Guacamole tokens). Deploy as a Node server behind a private tunnel
(Cloudflare/Tailscale) to the lab. Public content is still statically generated / CDN-friendly.
