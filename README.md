# portfolio — isaacwallace.dev

The platform repo for the isaacwallace.dev portfolio network: the main site **and** the shared
backend every subdomain uses.

## The network

| Site | Repo | What it is |
| --- | --- | --- |
| `isaacwallace.dev` | **this repo** (`apps/web`) | Main portfolio — the hub that links the labs |
| `api.isaacwallace.dev` | **this repo** (`apps/api`) | Shared API: auth/SSO for every subdomain |
| `auth.isaacwallace.dev` | **this repo** (`apps/auth`) | Identity service — server-rendered sign-in (`/login`) + OAuth + the SSO cookie for the network |
| `admin.isaacwallace.dev` | **this repo** (`apps/admin`) | Control plane — users, roles, and (planned) servers/projects/cyberlab/AI |
| `cyberlab.isaacwallace.dev` | `cyberlab` repo (`web/`) | Cybersecurity portfolio — cyber range case studies + live view |
| `homelab.isaacwallace.dev` | `homelab` repo | DevOps portfolio (planned) |
| `ailab.isaacwallace.dev` | `ailab` repo | AI portfolio (planned) |

**Why the backend lives here:** the API is shared infrastructure, not a lab. The portfolio repo is
the platform repo — main site + API deploy together, and each lab repo stays a self-contained
frontend that talks to `api.isaacwallace.dev`.

## Stack decisions (and why)

- **API: ASP.NET Core (.NET) minimal API + ASP.NET Identity + EF Core (SQLite → Postgres-ready).**
  Chosen over NestJS (would make the whole stack one language; little differentiation) and Rust
  (impressive but means hand-rolling auth primitives Identity ships hardened). .NET is broadly
  respected, fast, and makes the portfolio polyglot. Currently `net9.0`; bump `<TargetFramework>` to
  `net10.0` (LTS) when the SDK is installed.
- **Frontends: Next.js 15 + React 19 + TypeScript + Tailwind v4.** Consistent across sites; best
  SSG/SSR story. Each site keeps its **own visual identity** off shared token architecture (main =
  light editorial, cyberlab = dark ops-console, admin = graphite control-plane).
- **Auth: delegated (OAuth), no passwords stored.** Identity is proven by Google/GitHub; the API
  stores only emails, external-login links, and role assignments — **never a credential**, so a DB
  breach exposes nothing to crack. On top sits one session cookie on `.isaacwallace.dev`
  (`HttpOnly; Secure; SameSite=Lax`), so signing in on any site signs you in on all of them — real
  SSO, no token juggling. Subdomains are *same-site*, so SameSite=Lax allows the labs while blocking
  third parties. CORS is restricted to known origins with credentials.

## Auth flow

```
browser ──GET /auth/login/google?returnUrl=…──▶ api ──▶ Google ──▶ api /auth/complete
        ◀── Set-Cookie: iw_session; Domain=.isaacwallace.dev; HttpOnly; Secure; SameSite=Lax ──
        ──▶ redirect back to returnUrl
browser ──GET /auth/me (cookie auto-sent from ANY *.isaacwallace.dev page)──▶ api
        ◀── { id, email, displayName, roles } ──
```

Endpoints: `GET /auth/providers`, `GET /auth/login/{provider}`, `GET /auth/complete`,
`POST /auth/logout`, `GET /auth/me`, `GET /health`; admin-only: `GET /auth/users`,
`GET|POST /auth/roles`, `DELETE /auth/roles/{name}`, `POST /auth/users/{id}/roles`. Emails in
`Auth:AdminEmails` get the `admin` role (seeded at startup + applied on every sign-in); admins can
then create roles and assign them to anyone from the admin console.

**Where the UI lives:** the sign-in page is **server-rendered by the auth service itself**
(`apps/auth`, a Razor page at `auth.isaacwallace.dev/login`) — no separate frontend. Account settings
live in each site's own modal against `/auth/*`; every other site — including the main portfolio — is
a pure consumer that reads `/auth/me` and links to `/login`, with no login code of its own. `admin` is a
protected system role (can't be deleted; you can't remove it from yourself); the admin console at
`admin.isaacwallace.dev` manages users/roles and is additionally gated by Cloudflare Access in
production (see DEPLOYMENT.md).

**Local dev:** cookies ignore ports, so everything runs on `localhost` and SSO just works —
auth service + sign-in `:5170`, api `:5180`, main `:3000`, cyberlab `:3001`, admin `:3004`
(homelab `:3002`, ailab `:3003` reserved).
OAuth is optional locally: a Development-only `POST /auth/dev-login` (email, no provider, no password)
keeps the loop fast and is never mapped outside Development. To exercise real OAuth locally, fill the
`*_CLIENT_ID/SECRET` values in `.env`.

Each site integrates with a small copied `src/lib/auth.ts` — the auth surface is a handful of fetch
calls; not worth an npm package yet.

## Run

Two ways to run the network; both are driven by the `Makefile` and configured by `.env`
(copy `.env.example` — every value has a working default).

**Everything in Docker** — Postgres + API + both sites, one command:

```bash
make up      # portfolio :3000 · cyberlab :3001 · auth :5170 · api :5180 · postgres :5432
make logs    # follow logs (make logs s=auth-service for one service)
make down    # stop (keeps the db volume); make fresh also wipes the db
```

**Hybrid, for day-to-day coding** — database in Docker, apps native for fast hot reload
(Next.js HMR through Windows bind mounts is slow, so containers are for the full-stack
run, not for editing):

```bash
make dev-db            # Postgres only
make dev-auth-service  # dotnet watch :5170 against docker Postgres (own terminal)
make dev-api           # dotnet watch :5180 (general app API stub)   (own terminal)
make dev-web           # next dev :3000                              (own terminal)
make dev-cyberlab      # next dev :3001                              (own terminal)
```

`make check` typechecks and builds all three apps. The API uses Postgres whenever
`ConnectionStrings__Postgres` is set (compose and `dev-api` set it) and falls back to SQLite when
run bare with `dotnet run`.

## Quality bar

- `make test` — API integration tests (xunit + `WebApplicationFactory`, real cookies against a
  throwaway SQLite db) and cyberlab's vitest suite for the recording adapter + live engine.
- `make lint` / `make fmt` — ESLint 9 (flat config, `next/core-web-vitals`) and Prettier with the
  Tailwind class sorter in both web apps.
- `make smoke` — curls the running stack. All containers have healthchecks; `docker compose ps`
  shows `(healthy)` when the stack is actually up, not just started.
- CI (`.github/workflows/ci.yml`): API tests, web lint/format/typecheck/build, and Docker image
  builds on every push/PR. The cyberlab repo has the same for `web/` (`web-ci.yml`).
- Auth service extras: interactive docs at `http://localhost:5170/scalar` (dev only), manual requests
  in `apps/auth/auth.http`, and fixed-window rate limiting on the sign-in entry points
  (`/auth/dev-login`, 10/min per IP; `/auth/me` and the OAuth redirect dance are unthrottled).

## Deploy (Cloudflare)

- DNS: `A`/`CNAME` for apex + `CNAME` for `api`, `cyberlab`, `homelab`, `ailab` — all proxied.
  Served from the lab via a **cloudflared tunnel** (one tunnel, per-hostname ingress rules) so
  nothing is port-forwarded.
- API prod config (`appsettings.Production.json`): `Auth:CookieDomain = .isaacwallace.dev`;
  HTTPS is terminated by Cloudflare, cookie is `Secure`.
- Next.js sites run as Node servers (`next start`) — the live/queue routes need a server runtime.
- Swap SQLite → Postgres by changing the EF provider + connection string when accounts matter.
