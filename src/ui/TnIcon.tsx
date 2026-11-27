// A TaskNotes status / priority icon (v0.12). TaskNotes stores any Lucide name ("lucide-badge-check"); the
// curated set renders at once, anything else comes from a lazily loaded chunk with every Lucide icon, and
// unknown names fall back to a circle.
import { useEffect, useState } from "react";
import { Circle, type LucideIcon } from "lucide-react";
import { Icon, iconExists } from "./icons";

let all: Record<string, LucideIcon> | null = null;
let loading: Promise<void> | null = null;
const pascal = (n: string) => n.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

export function TnIcon({ name, size = 12, color, className }: { name: string | null | undefined; size?: number; color?: string | null; className?: string }) {
  const n = name?.replace(/^lucide-/, "") ?? null;
  const curated = !!n && iconExists(n);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!n || curated || all) return;
    let alive = true;
    loading ??= import("./allIcons").then((m) => void (all = m.icons as Record<string, LucideIcon>));
    void loading.then(() => alive && setTick((x) => x + 1));
    return () => void (alive = false);
  }, [n, curated]);
  const style = color ? { color } : undefined;
  const Dyn = n && !curated && all ? all[pascal(n)] : undefined;
  return (
    <span className={className} style={style}>
      {curated ? <Icon name={n} size={size} /> : Dyn ? <Dyn size={size} /> : <Circle size={size} />}
    </span>
  );
}
