"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** D1 · Tabs with the ARIA tabs pattern: arrow keys, Home and End move between tabs. */
export function Tabs({ tabs, label }: { tabs: { key: string; label: string; content: ReactNode; disabled?: boolean }[]; label: string }) {
  const id = useId();
  const [active, setActive] = useState(tabs.find((t) => !t.disabled)?.key ?? tabs[0]?.key);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);
  // D3: a sliding indicator under the active tab (transform only; it jumps with reduced motion).
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[active ?? ""], host = list.current;
    if (!el || !host) return;
    const measure = () => setBar({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [active]);

  function onKey(e: React.KeyboardEvent, key: string) {
    const i = enabled.findIndex((t) => t.key === key);
    const next = e.key === "ArrowRight" ? enabled[(i + 1) % enabled.length] : e.key === "ArrowLeft" ? enabled[(i - 1 + enabled.length) % enabled.length]
      : e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[enabled.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    setActive(next.key);
    refs.current[next.key]?.focus();
  }

  return (
    <div>
      <div ref={list} className={`ui-tabs${bar ? " has-indicator" : ""}`} role="tablist" aria-label={label}>
        {bar && <span className="ui-tabs__indicator" aria-hidden="true" style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />}
        {tabs.map((t) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" role="tab" className="ui-tab" id={`${id}-${t.key}-tab`}
            aria-selected={active === t.key} aria-controls={`${id}-${t.key}-panel`} tabIndex={active === t.key ? 0 : -1} disabled={t.disabled}
            onClick={() => setActive(t.key)} onKeyDown={(e) => onKey(e, t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" className="ui-tabpanel" id={`${id}-${t.key}-panel`} aria-labelledby={`${id}-${t.key}-tab`} hidden={active !== t.key} tabIndex={0}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
