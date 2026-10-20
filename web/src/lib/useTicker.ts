import { useEffect, useState } from "react";

/** Re-renders the caller every `intervalMs` while `active`, so durations of running items keep counting. */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return tick;
}
