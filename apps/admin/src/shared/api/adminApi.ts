// Admin-only endpoints (users + roles). These live here rather than in @iw/core because only the
// control plane uses them — they're built on the shared, cookie-credentialed `authApi` helper, which
// targets the dedicated auth service (auth.isaacwallace.dev).

import { authApi, type SessionUser } from "@iw/core";

export interface Role {
  name: string;
  system: boolean;
}

export function listUsers(): Promise<SessionUser[]> {
  return authApi<SessionUser[]>("/auth/users");
}

export function listRoles(): Promise<Role[]> {
  return authApi<Role[]>("/auth/roles");
}

export function createRole(name: string): Promise<Role> {
  return authApi<Role>("/auth/roles", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteRole(name: string): Promise<void> {
  return authApi(`/auth/roles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  }).then(() => undefined);
}

export function setUserRole(
  id: string,
  role: string,
  assigned: boolean,
): Promise<SessionUser> {
  return authApi<SessionUser>(`/auth/users/${id}/roles`, {
    method: "POST",
    body: JSON.stringify({ role, assigned }),
  });
}
