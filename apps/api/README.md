# isaacwallace-api

`api.isaacwallace.dev` — the general application API for the portfolio network **and** the public,
key-authenticated front door to the homelab. Other projects (hosted on the homelab or anywhere else)
integrate through this one surface.

## Auth model

Two lanes share the service:

- **Cookie SSO** — browser calls from the known site origins (identity lives in `apps/auth`).
- **API keys** — machine-to-machine callers. Present the key as `Authorization: Bearer <key>` or in
  the `X-API-Key` header.

**This service is not an auth authority.** It holds no key material. Every presented key is validated
by the **auth service** (`auth.isaacwallace.dev`) over an internal introspection call — auth issues,
stores (hash only), scopes, and revokes keys; this API just asks "is this key valid, and what scopes?"
and enforces the answer. Results are cached briefly (`ApiAuth:CacheSeconds`), which bounds how long a
revoked key keeps working here. Auth unreachable or misconfigured → **fail closed** (deny).

`GET /health` is anonymous. `GET /v1/me` returns the calling key's id, name, and scopes.

### Scopes

| Scope | Grants |
| :--- | :--- |
| `admin` | Satisfies every scope requirement. |
| `runs:read` | Read HomeOps run state (next slice). |
| `runs:write` | Create HomeOps runs (next slice). |

Protect an endpoint with `.RequireApiKey()` (any valid key) or `.RequireScope(ApiScopes.RunsWrite)`.

## Issuing / revoking keys

Keys are managed in the **auth service**, admin-gated (cookie + `admin` role):

```bash
# issue — returns the plaintext ONCE
curl -X POST https://auth.isaacwallace.dev/auth/apikeys -b cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme integration","scopes":["runs:read"],"rateLimitPerMinute":120}'

curl https://auth.isaacwallace.dev/auth/apikeys        -b cookies.txt   # list metadata
curl -X DELETE https://auth.isaacwallace.dev/auth/apikeys/<id> -b cookies.txt   # revoke
```

## Configuration (`ApiAuth`)

| Key | Purpose |
| :--- | :--- |
| `AuthBaseUrl` | Auth service base URL (in-cluster in prod, `http://localhost:5170` in dev). |
| `IntrospectionToken` | Shared secret sent as `X-Internal-Token`; must equal auth's `Auth:IntrospectionToken`. |
| `CacheSeconds` | Introspection result cache TTL (revocation upper bound). |
| `AnonymousRateLimitPerMinute` | Per-IP ceiling for unauthenticated callers. |

Empty `AuthBaseUrl`/`IntrospectionToken` → introspection disabled (fail closed). In production both
come from a Sealed Secret; dev values are in `appsettings.Development.json`.

## Run

```bash
dotnet run                     # http://localhost:5180  (Scalar UI at /scalar in Development)
```
