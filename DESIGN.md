# Design language — the portfolio network

One design **language**, three (four) **identities**. Every site implements the same contract —
spacing, radius, type, borders/shadows, motion, primitive shapes — through its own palette. A card
on cyberlab and a card on the main site are the *same component* wearing different colours.

The contract lives in each app's `globals.css` as CSS custom properties with **identical names and
values** (the shared scales) plus a **per-app palette** feeding them. Tailwind v4 reads them via
`@theme inline`, so utilities like `rounded-lg`, `bg-surface`, `shadow-(--shadow-2)` resolve
per-app automatically.

## Who's who

| App | Identity | Ground | Accent |
| --- | --- | --- | --- |
| `apps/web` (isaacwallace.dev) | light editorial, "enterprise, alive" | paper `#faf9f6` | indigo `#3b5bdb` |
| `cyberlab/web` | dark ops console / SOC | `#070b10` | actor roles (rose/cyan/amber…), live accent follows the actor |
| `apps/auth` | light editorial — mirrors the main site (the neutral identity layer) | paper `#faf9f6` | indigo `#3b5bdb` |
| `apps/admin` | graphite mission control | `#0a0c10` | signal violet `#7c6cff` |

## The shared contract (identical in every globals.css)

### Surfaces — portable aliases

Primitives never reference app-specific palette names. Each app maps its palette onto:

```css
--surface     /* card/panel ground        (web: white card, cyberlab: panel) */
--surface-2   /* raised/secondary surface (web: paper-2,   cyberlab: panel-2) */
--line        /* hairline borders — already universal */
--ink / --ink-mid / --ink-dim   /* text hierarchy — already universal */
--accent      /* THE app accent — already universal */
```

### Radius scale

```css
--radius: 12px;
--radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 12px;  --radius-xl: 18px;
```

Cards/panels use `lg`, controls (buttons, inputs) use `md`, chips/tags `sm`, hero/stage `xl`.

### Control scale

```css
--ctl-sm: 32px;  --ctl: 40px;  --ctl-lg: 44px;   /* heights for buttons & inputs */
```

### Fonts (per-app, via `next/font/google`, self-hosted at build)

Each app declares its faces in its root layout and exposes them as CSS variables the
palette's `--sans`/`--display`/`--mono` consume:

| App | Sans / UI | Display | Mono |
| --- | --- | --- | --- |
| `apps/web` | Inter (`--font-inter`) | Fraunces (`--font-fraunces`) | system mono |
| `cyberlab/web` | Space Grotesk (`--font-grotesk`) | — (sans) | JetBrains Mono (`--font-jetbrains`) |
| `apps/auth` | Inter (`--font-inter`) | — | system mono |

`next/font` fetches at build time and self-hosts the woff2 — no runtime request to Google,
CSP-safe. It fails the build if the font can't be fetched, so a green build proves the wiring.

### Type scale

Body type is per-app (editorial vs console) but the *display steps* are shared:

```css
--fs-hero:  clamp(32px, 5.6vw, 60px);   /* one per page, max */
--fs-h1:    clamp(22px, 3.2vw, 32px);
--fs-h2:    clamp(19px, 2.4vw, 24px);
--fs-body:  15px;
--fs-small: 13px;
--fs-micro: 11px;                        /* mono eyebrows/labels */
```

Eyebrow/kicker: 700, mono, 10–11px, letter-spacing 0.2em+, uppercase, `--ink-dim`. Every app has it.

### Elevation

Same geometry everywhere; the shadow *colour* is the app's ground:

```css
--shadow-1  /* resting card:   0 1px 2px, faint */
--shadow-2  /* hover/raised:   0 18px 40px -18px */
--shadow-3  /* overlay/modal:  0 24px 60px -20px + 0 8px 24px -12px */
```

### Focus

Visible everywhere, identical shape: `outline-none` + 2px ring in the app accent at ~50% alpha,
ring-offset on filled controls. Tailwind: `focus-visible:ring-2 focus-visible:ring-accent/50`.

## Motion system

A small named vocabulary. **Nothing animates outside it.**

### Easings

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);     /* entrances, hovers — fast start, long settle */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);    /* moves, morphs, width/position changes */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* pops with overshoot — menus, presses */
```

### Durations

```css
--dur-fast: 120ms;   /* hover colour/border, active press */
--dur-base: 200ms;   /* menus, chips, small state changes */
--dur-slow: 320ms;   /* modals, card lifts */
--dur-reveal: 640ms; /* scroll-triggered section entrances */
```

### Named entrance patterns

| Name | What | Recipe |
| --- | --- | --- |
| **rise** | sections, cards on scroll | opacity 0→1 + translateY 16px→0, `--dur-reveal` `--ease-out`; stagger children 70ms |
| **pop** | dropdowns, modals, toasts | opacity 0→1 + scale 0.96→1, `--dur-base` `--ease-spring`, transform-origin at the anchor |
| **draw** | rules, underlines, progress | scaleX 0→1, `--dur-reveal` `--ease-out`, origin left |
| **pulse** | live/status indicators | opacity 1→0.3→1, 1.4s ease-in-out infinite (cyberlab's `blip`) |

Implementation: a `.reveal` class holds the hidden pre-state; a ~20-line IntersectionObserver hook
(`useReveal` / `<Reveal>`) adds `.in` when the element enters the viewport. Dropdown/modal use the
`pop` keyframes.

**Scroll-linked layer (apps/web only).** The main portfolio adds Framer Motion (`motion`) for the
premium, Apple-style scroll feel — motion that tracks the wheel continuously, not one-shot toggles:
- `<Hero>` — a scroll dissolve: content lifts + fades and the WebGL constellation parallaxes the
  other way as the hero scrolls out (`useScroll`/`useTransform`).
- `<ScrollReveal>` — maps scroll progress to opacity + rise + scale (+ optional blur) as an element
  crosses the lower viewport; used on section blocks and cards.
- `<Parallax speed>` — drifts a layer at a fraction of scroll speed for depth.
All three honour `useReducedMotion()` (render static). Framer Motion is the second heavy dep after
three.js, and stays confined to apps/web; cyberlab/auth keep the CSS + IntersectionObserver
primitives. Everywhere else, no animation library.

### Reduced motion — non-negotiable

Two switches, both honoured by every animation:

1. `@media (prefers-reduced-motion: reduce)` — the OS setting. Global kill-switch in every app
   (animations/transitions → 0.001ms) **plus** JS checks in anything driven by script (reveal hook
   reveals instantly; the cyberlab player already clamps its typewriter).
2. `html[data-reduce-motion]` — the per-site cosmetic preference (localStorage, set from the
   settings modal). Same CSS kill-switch selector, same JS check via `prefersReducedMotion()` in
   each app's `lib/prefs.ts`.

Everything must remain fully usable with motion off: reveals default to visible, menus still open,
progress still updates.

## Primitive shapes (same silhouette everywhere)

- **Button**: height `--ctl` (lg `--ctl-lg`, sm `--ctl-sm`), radius `md`, semibold 14px, gap 8px;
  filled = accent-tinted fill + accent-tinted border; secondary = `--surface-2` + `--line` border;
  hover shifts colour in `--dur-fast`, press translates 1px down; focus ring standard.
- **Card**: radius `lg`, 1px `--line` border, `--surface` ground, `--shadow-1`; hover (when
  interactive) lifts −3px with `--shadow-2` and an accent-mixed border, `--dur-base`.
- **Input**: height `--ctl`, radius `md`, `--surface-2` ground, 1px `--line`; focus = accent border
  + accent/30 ring.
- **Badge/chip**: mono, uppercase, 10px, radius `sm`, tinted with its subject colour
  (`color-mix(subject 12%, transparent)` bg + 40% border).
- **Account dropdown**: 224px, radius `lg`, `--surface`, `--shadow-3`, `pop` entrance from
  top-right; identity header, then items, `Settings` opens the in-app modal, external links marked ↗.
- **Settings modal**: THE account surface — every app carries its own; there is no separate
  account page anywhere (auth is a pure turnstile). Centered, max-w 620px, radius `xl`,
  `--shadow-3`, `pop`; backdrop `rgba(ground, 0.6)` + blur; Escape/backdrop/✕ close, focus moves
  in and returns on close. **Must render via `createPortal(…, document.body)`** — it opens from
  the navbar, whose `backdrop-blur` is a containing block that would trap `position: fixed`.
  Tabs: Profile (display name → API) · Sign-in & security · Sessions (list + revoke, network-wide)
  · This site (that app's cosmetic prefs, localStorage).

## Settings split (identity + theme vs cosmetics)

- **Shared identity** (display name…) → `POST /auth/profile` via the API. Same value everywhere.
- **Shared theme** (light / dark / system) → the network-wide appearance, below. Also `POST
  /auth/profile` (the `theme` field), *and* a cross-subdomain cookie.
- **Per-subdomain cosmetics** (reduce motion; cyberlab: feed density + default replay speed) →
  `localStorage` on that subdomain only, via that app's `lib/prefs.ts`. Never sent to the API.

## Theme (network-wide light / dark) — the contract

Every app ships **two palettes** over the one shared contract; only the `:root` custom properties
change between them. Each app has a *native* identity (its historical look) and authors the
opposite mode as an override:

| App | Native (`:root`) | Override block |
| --- | --- | --- |
| `apps/web` | light editorial | `:root[data-theme="dark"]` — dark editorial |
| `apps/auth` | light editorial (re-skinned to mirror the main site) | `:root[data-theme="dark"]` |
| `apps/admin` | dark graphite | `:root[data-theme="light"]` — daylight mission control |
| `cyberlab/web` | dark ops console | `:root[data-theme="light"]` — daylight console (terminal widgets stay dark) |

**Mechanism (identical in every app — `lib/theme.ts`, copied like `lib/auth.ts`):**

- The choice is `light | dark | system`, stored in the **`iw_theme` cookie** — `Domain=.isaacwallace.dev`
  in prod (covers every subdomain), a plain `localhost` cookie in dev (ports share it). Not HttpOnly:
  the client reads/writes it. Mirrored to the **account** (`AppUser.ThemePreference`) so it follows
  you to a new device.
- A render-blocking inline script (`THEME_INIT_SCRIPT`, injected into `<head>` by each layout) reads
  the cookie, resolves `system` via `prefers-color-scheme`, and sets `html[data-theme]` to the
  **concrete** `light`/`dark` before first paint — so the CSS only needs `[data-theme="light|dark"]`
  and there is never a flash. `<html suppressHydrationWarning>` covers the attribute React didn't render.
- `PrefsBoot`/`ThemeBoot` re-asserts on mount, keeps `system` live when the OS flips, and calls
  `adoptAccountTheme(user.theme)` after `getMe()` (a new device adopts the account's saved theme).
- Set it from: the **settings modal** Appearance control (`apps/web`, `cyberlab/web` — works
  signed-out too, cookie-only), or a **cycle toggle** in the chrome (`apps/auth` header,
  `apps/admin` Shell header). All call `setThemeChoice()` → cookie + `<html>` + (if signed in) API.

Light overrides also re-tint any body background that used hard-coded ground colours
(`:root[data-theme="light"] body { … }`) and, for cyberlab, swap `--on-primary` so text on the
accent stays legible.

## Repository structure — monorepo + FSD

Everything lives in one repo (`isaacwallace/`), an npm-workspaces monorepo:

- `apps/*` — the four Next sites (`web`, `auth`, `admin`, `cyberlab`) + the .NET `api`.
- `packages/core` (`@iw/core`) — shared cross-app logic: the **session/auth client** and the
  **network-wide theme**. Consumed as TypeScript source via each app's `transpilePackages`, so
  there are no per-app copies of these anymore (edit once). App-specific cosmetics (`prefs.ts`,
  admin's user/role endpoints) stay in the app.
- `packages/ui` (`@iw/ui`) — shared, **token-driven** React components: `ThemeControl`,
  `ThemeToggle`, `SettingsModal`. They carry no palette of their own — they style themselves with
  the design-contract variables (`bg-surface`, `text-ink`, `ring-brand`, `text-danger`…) that every
  app defines, so one component wears each app's colours. Also source via `transpilePackages`; each
  consuming app adds `@source "…/packages/ui/src"` to its `globals.css` so Tailwind generates the
  utilities the shared components use, and defines `--color-brand` (= its accent) + `--color-danger`.
  `SettingsModal` takes a `siteTab` prop — the one genuinely per-subdomain panel (cosmetic prefs).
  `UserMenu` stays per-app on purpose: its trigger *shape* (pill vs mono chip) is identity, not just
  colour.
- Each Next app is organised **Feature-Sliced Design** under `src/`:
  `app/` (Next routing) · `widgets/` (composite blocks: nav, user-menu, settings-modal, hero,
  scenario-player…) · `features/` (a user capability: sign-in, theme, manage-roles…) ·
  `entities/` (domain models, e.g. cyberlab's `entities/scenario`) · `shared/` (`ui/` primitives,
  `lib/` helpers, `boot/` mount-time bootstrap, `api/` app-specific endpoints). Import across
  layers by alias (`@/widgets/…`, `@/shared/ui/…`, `@/entities/…`); never upward.
- Docker: each app builds from the **repo root** context (so the workspace package is in scope),
  installs + builds in one stage (npm nests workspace deps), and Next's `outputFileTracingRoot`
  puts the standalone server at `apps/<app>/server.js`.

## Adding a new lab site

1. Copy the shared blocks of any `globals.css` (scales + motion + reveal/pop utilities + reduced-
   motion guards + the `:root[data-theme]` light/dark palettes) verbatim; swap the `:root` palette
   and map `--surface`/`--surface-2`.
2. Add `"@iw/core": "*"` to the app; wire `transpilePackages` + `outputFileTracingRoot` in
   `next.config.mjs` and the root-context Dockerfile (copy any app's). Session + theme come from
   `@iw/core` — you only author the app's own `shared/lib/prefs.ts`, `shared/boot/PrefsBoot`, and
   its `widgets/` (UserMenu, SettingsModal with a cosmetic section if needed).
3. Use the primitive recipes above; motion only from the named vocabulary; both reduced-motion
   switches wired; light + dark palettes present before shipping.
