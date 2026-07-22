"use client";

import { useCallback, useEffect, useState } from "react";
import { getMe, type SessionUser } from "@iw/core";
import {
  listRoles,
  listUsers,
  setUserRole,
  type Role,
} from "@/shared/api/adminApi";

export default function UsersManager() {
  const [users, setUsers] = useState<SessionUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [meId, setMeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([listUsers(), listRoles(), getMe()])
      .then(([u, r, me]) => {
        setUsers(u);
        setRoles(r);
        setMeId(me?.id ?? "");
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load."),
      );
  }, []);

  useEffect(() => load(), [load]);

  const toggle = async (user: SessionUser, role: string) => {
    const key = `${user.id}:${role}`;
    setPending(key);
    setError(null);
    try {
      const updated = await setUserRole(
        user.id,
        role,
        !user.roles.includes(role),
      );
      setUsers(
        (prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setPending(null);
    }
  };

  if (users === null && !error) return <Skeleton />;

  return (
    <div className="rounded-xl border border-line bg-panel">
      {error && (
        <p
          role="alert"
          className="m-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-5 py-3 font-mono text-[10px] tracking-[0.16em] text-ink-dim uppercase">
                User
              </th>
              <th className="px-5 py-3 font-mono text-[10px] tracking-[0.16em] text-ink-dim uppercase">
                Roles
              </th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr
                key={u.id}
                className="border-b border-line-soft last:border-0"
              >
                <td className="px-5 py-3.5 align-top">
                  <div className="font-medium">
                    {u.displayName}
                    {u.id === meId && (
                      <span className="ml-2 text-xs font-normal text-ink-dim">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-ink-dim">
                    {u.email || "—"}
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r) => {
                      const on = u.roles.includes(r.name);
                      const key = `${u.id}:${r.name}`;
                      const lockSelf =
                        r.name === "admin" && u.id === meId && on;
                      return (
                        <button
                          key={r.name}
                          onClick={() => toggle(u, r.name)}
                          disabled={pending === key || lockSelf}
                          title={
                            lockSelf
                              ? "You can't remove your own admin role"
                              : on
                                ? `Remove ${r.name}`
                                : `Grant ${r.name}`
                          }
                          className={[
                            "cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            on
                              ? "border-accent/45 bg-accent/15 font-semibold text-accent-bright"
                              : "border-line text-ink-dim hover:border-line-soft hover:text-ink",
                          ].join(" ")}
                        >
                          {on ? "✓ " : "+ "}
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-panel-2" />
        ))}
      </div>
    </div>
  );
}
