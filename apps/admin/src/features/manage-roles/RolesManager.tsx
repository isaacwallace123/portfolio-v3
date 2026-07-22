"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createRole,
  deleteRole,
  listRoles,
  type Role,
} from "@/shared/api/adminApi";

export default function RolesManager() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listRoles()
      .then(setRoles)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load roles."),
      );
  }, []);

  useEffect(() => load(), [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createRole(name.trim());
      setRoles((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create role.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (role: Role) => {
    setError(null);
    try {
      await deleteRole(role.name);
      setRoles((prev) => prev?.filter((r) => r.name !== role.name) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete role.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={add}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-panel p-5"
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          New role
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. editor, operator, viewer"
            pattern="[a-z][a-z0-9-]{1,30}"
            title="lowercase letters, digits, dashes; 2–31 chars; starts with a letter"
            required
            className="h-10 w-full min-w-48 rounded-md border border-line bg-panel-2 px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-10 cursor-pointer rounded-md bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create role"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="rounded-xl border border-line bg-panel">
        <ul className="divide-y divide-line-soft">
          {roles?.map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-5 py-3.5">
              <span className="font-mono text-sm text-ink">{r.name}</span>
              {r.system && (
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-accent uppercase">
                  system
                </span>
              )}
              {!r.system && (
                <button
                  onClick={() => remove(r)}
                  className="ml-auto cursor-pointer rounded-md border border-line px-2.5 py-1 font-mono text-[11px] text-ink-dim transition-colors hover:border-danger/50 hover:text-danger"
                >
                  delete
                </button>
              )}
            </li>
          ))}
          {roles?.length === 0 && (
            <li className="px-5 py-4 text-sm text-ink-dim">No roles yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
