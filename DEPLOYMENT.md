# Deployment — the portfolio network

One deployment standard for every public site in the network. It reuses the platform the homelab
already runs, so there is nothing new to operate.

## The standard

```
  repo (Dockerfile + CI)                 homelab k3s cluster
  ─────────────────────                  ───────────────────────────────
  git push ─▶ GitHub Actions ─▶ GHCR ─▶ ArgoCD ─▶ Deployment ─▶ Service
                (build image)   (image)  (GitOps)                   │
                                                                    ▼
                                              Cloudflare Tunnel (cloudflared, in-cluster)
                                                                    │
                                                                    ▼
                                                    https://<name>.isaacwallace.dev
```

Every app, regardless of lab, follows the same five rules:

1. **Containerised.** A `Dockerfile` at the app root produces one image.
2. **Published to GHCR** by the repo's own `publish.yml` workflow → `ghcr.io/isaacwallace123/<app>`.
3. **Described to ArgoCD** by a one-file descriptor in `homelab-k8s/argocd-apps/apps/portfolio/`.
   The homelab ApplicationSet auto-discovers it — no cluster access needed to add an app.
4. **Manifests live in the app's repo** under `deploy/k8s/` (the descriptor's `repoURL` points
   there). For the portfolio network that repo is this monorepo — the main site, API, admin, auth,
   **and the cyberlab website** (`deploy/k8s/cyberlab.yaml`, its own `cyberlab` namespace) are all
   reconciled by the single `portfolio` ArgoCD app. The cyberlab *range* infra keeps its own repo.
5. **Exposed through the existing Cloudflare Tunnel**, never a port-forward.

This is the "federated labs, shared platform standards" model from the homelab strategy doc: each
lab keeps its repo, secrets, and boundary; they converge on one *way of shipping*, not one owner.

### What deploys here vs. what does not

Only **stateless, sanitised, public websites** run in the cluster. The cyberlab **range** — Kali,
victims, the SOC, Windows/AD, packet capture, disposable scenario VMs — stays on Proxmox/Terraform
and never enters Kubernetes. The cyberlab *website* reaching the lab does so only over the narrow,
read-only seam already designed for it (`liveSim` today → a scoped read-only Guacamole broker later).

## Per-lab conformance

| Lab | Today | Under the standard |
| --- | --- | --- |
| **portfolio** (main + API + all lab sites) | Docker Compose (local dev) | ✅ `deploy/k8s/` + `publish.yml` — done |
| **cyberlab** (website) | now **in this monorepo** (`apps/cyberlab`) | ✅ built + deployed from here — `deploy/k8s/cyberlab.yaml`, `cyberlab-web` image, its own `cyberlab` namespace |
| **homelab** | already k3s + ArgoCD | it *is* the platform; nothing to migrate |
| **ailab** | Docker Compose ("hopes and dreams") | 🔜 migration path below |

### Bringing ailab in

ailab already has a `compose.yaml` and a `kubernetes/` folder — it's closer than it looks. The path
is exactly what portfolio/cyberlab just did:

1. Keep `compose.yaml` for local dev (it stays the fast inner loop for every lab).
2. Add a `Dockerfile` per service that doesn't have one (the Python services already build in compose).
3. Add `ailab/.github/workflows/publish.yml` pushing each service image to GHCR.
4. Add `ailab/deploy/k8s/` manifests (namespace `ailab`, Deployments/Services; its Postgres becomes
   a Longhorn StatefulSet exactly like portfolio's).
5. Add an `ailab` AppProject to `homelab-k8s/categories/projects.yaml` and descriptors under
   `argocd-apps/apps/portfolio/` (or a new `apps/ailab/` folder).
6. Add the `ailab.isaacwallace.dev` public hostname to the tunnel.

The GPU/model workloads can stay on their own VM and be reached the same way the cyberlab range is —
the *dashboard* is the public container, the heavy compute is external.

## First-time bootstrap (once per app)

Everything below is a one-time setup; after it, `git push` is the entire deploy.

### 1. Seal the API's secret

The API needs the Postgres password. Plaintext never touches git — Sealed Secrets encrypts it against
the cluster's public key, and only the in-cluster controller can decrypt it.

```bash
cd portfolio/deploy/secrets
cp portfolio-secrets.example.yaml portfolio-secrets.yaml     # edit: set a strong password (same in both fields)
kubeseal --format yaml --controller-namespace kube-system \
  < portfolio-secrets.yaml > ../k8s/sealed-secret.yaml       # commit ONLY this sealed output
git add ../k8s/sealed-secret.yaml && git commit -m "portfolio: sealed db secret"
```

`deploy/secrets/*.yaml` is gitignored (except the example), so the plaintext can't be committed by
accident. cyberlab's website needs no secret — it holds nothing sensitive.

### 2. Point the tunnel at the services

The homelab's `cloudflared` runs in-cluster with a **dashboard-managed** tunnel (token auth), so
public hostnames are added in the Cloudflare Zero Trust dashboard (Networks → Tunnels → your tunnel
→ Public Hostnames). Adding a hostname auto-creates its DNS record. Add:

| Public hostname | Path | Service (in-cluster URL) |
| --- | --- | --- |
| `isaacwallace.dev` | | `http://web.portfolio.svc.cluster.local:80` |
| `www.isaacwallace.dev` | | `http://web.portfolio.svc.cluster.local:80` |
| `auth.isaacwallace.dev` | `/auth/*` | `http://auth-service.portfolio.svc.cluster.local:80` |
| `auth.isaacwallace.dev` | `/signin-*` | `http://auth-service.portfolio.svc.cluster.local:80` |
| `auth.isaacwallace.dev` | *(default)* | `http://auth.portfolio.svc.cluster.local:80` |
| `api.isaacwallace.dev` | | `http://api.portfolio.svc.cluster.local:80` |
| `admin.isaacwallace.dev` | | `http://admin.portfolio.svc.cluster.local:80` |
| `cyberlab.isaacwallace.dev` | | `http://cyberlab-web.cyberlab.svc.cluster.local:80` |

**The auth domain is path-routed.** `auth.isaacwallace.dev` is the single public face of identity: the
dedicated auth service (`apps/auth-service`, its own image) handles the API (`/auth/*`) and the OAuth
callbacks (`/signin-google`, `/signin-github`), while the Next portal (`apps/auth`) serves the sign-in
UI on the same host. In the Cloudflare dashboard, public-hostname rules are evaluated top-down, so add
the two `auth.isaacwallace.dev` **path** rules (→ `auth-service`) *above* the catch-all
`auth.isaacwallace.dev` rule (→ `auth`). Because the SSO cookie is scoped to `.isaacwallace.dev`, every
other site keeps working unchanged. `api.isaacwallace.dev` now serves the general-API stub (no auth).

The OAuth provider **callback URLs** are therefore on the auth domain — register
`https://auth.isaacwallace.dev/signin-google` and `https://auth.isaacwallace.dev/signin-github` (plus
the `http://localhost:5170/...` variants for local dev).

### Lock down the admin console at the edge (Cloudflare Access)

`admin.isaacwallace.dev` is the control plane, so gate it *before* the app even loads with
Cloudflare Access (Zero Trust → Access → Applications):

1. Add a **self-hosted application** for `admin.isaacwallace.dev`.
2. One **Allow** policy: *Emails* → your admin email(s) — the same addresses in `Auth:AdminEmails`.
   (Cloudflare will send a one-time PIN or use Google login.)
3. Everything else is blocked at Cloudflare — the public never reaches the container.

This is defence-in-depth, not the only guard: the app still checks the `admin` role client-side, and
every admin API call is authorised server-side with `[Authorize(Roles="admin")]`. Access just means a
stranger can't even fetch the page. The API's admin endpoints stay on `api.isaacwallace.dev` (not
behind Access, since the sites call them) but are role-protected and CORS-limited to known origins.

Cloudflare terminates TLS at the edge; the in-cluster hop is HTTP. The API already handles this
correctly — it forces the session cookie `Secure` in Production and honours `X-Forwarded-Proto`
from cloudflared. TLS mode in Cloudflare should be **Full**.

### 3. Let ArgoCD sync

Once the descriptors and `projects.yaml` change are on `homelab-k8s` `main`, the root app renders the
`portfolio` AppProject and the two Applications, creates the `portfolio` and `cyberlab` namespaces,
and syncs. Watch it: `kubectl -n argocd get applications` or the ArgoCD UI at `https://192.168.0.203`.

## Ongoing rollout

Manifests reference `:latest`. A `git push` rebuilds and repushes the image, but Kubernetes won't
pull a re-tagged `:latest` on its own. Pick one rollout trigger:

- **ArgoCD Image Updater** (already installed in the homelab): add these annotations to the generated
  Application (via the ApplicationSet template or a per-app patch) and it writes new digests back to
  git and rolls them out:
  ```
  argocd-image-updater.argoproj.io/image-list: web=ghcr.io/isaacwallace123/portfolio-web
  argocd-image-updater.argoproj.io/web.update-strategy: digest
  ```
- **Immutable tags** (simplest, fully GitOps): push a `vX.Y.Z` tag; `publish.yml` builds
  `:vX.Y.Z`; bump the image tag in `deploy/k8s/*.yaml` and commit. ArgoCD sees the manifest change
  and rolls out. No extra controller, fully auditable in git history.

Start with immutable tags; turn on Image Updater once you want hands-off `main` deploys.

## Local dev is unchanged

None of this replaces the local loop. `make up` / `make dev-*` in the portfolio repo still run the
whole network on your machine against Docker Compose. Compose is the inner loop; k3s is production.
The Dockerfiles are shared between them, so what you run locally is what ships.
