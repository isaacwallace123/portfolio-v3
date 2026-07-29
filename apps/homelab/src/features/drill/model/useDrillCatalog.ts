"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDrills, type DrillCatalogEntry } from "@/shared/api/live-client";

/**
 * The catalog and its solve statistics, from the API rather than a second copy in the bundle: the
 * averages are something only the server can know, and a hardcoded list here would go stale every
 * time a drill is added.
 */
export function useDrillCatalog(refreshKey: unknown) {
  const [drills, setDrills] = useState<DrillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    fetchDrills()
      .then((c) => alive && setDrills(c.drills))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Reloaded when a drill resolves, so the number this run just moved is the number shown next.
  useEffect(load, [load, refreshKey]);

  return { drills, loading };
}
