// Collapsible sidebar sections; collapsed ones are remembered in settings.sidebarCollapsed.
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";

export function useCollapsed(id: string): [boolean, () => void] {
  const collapsed = useApp((s) => s.settings.sidebarCollapsed.includes(id));
  const toggle = () => {
    const cur = store.get().settings.sidebarCollapsed;
    void A.updateSettings({ sidebarCollapsed: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }).catch(A.reportError);
  };
  return [collapsed, toggle];
}

/** A collapsible sidebar section: a quiet header (eyebrow + chevron) and optional header actions. */
export function SideSection(p: { id: string; title: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsed(p.id);
  return (
    <section className={`side-section ${p.className ?? ""} ${collapsed ? "collapsed" : ""}`} aria-label={p.title}>
      <div className="side-head">
        <button className="side-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <span className="eyebrow">{p.title}</span>
          <ChevronDown size={12} className={`ftp-chev ${collapsed ? "closed" : ""}`} />
        </button>
        {!collapsed && p.actions}
      </div>
      {!collapsed && p.children}
    </section>
  );
}

