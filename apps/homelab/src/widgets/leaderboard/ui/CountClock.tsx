"use client";

import { clock } from "@/shared/lib/format";
import { useCountUp } from "../model/useCountUp";

/** A recorded time that counts up to itself on mount. */
export function CountClock({ ms }: { ms: number }) {
  return <>{clock(useCountUp(ms))}</>;
}
