"use client";

import { useEffect, useId, useRef, useState } from "react";

/** D1 · A dropdown menu: opens from its button, arrow keys move, Escape or a click outside closes and returns focus. */
export function Menu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const outside = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }
  function onKey(e: React.KeyboardEvent) {
    const all = [...(wrap.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="ui-menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={button} type="button" className="ui-btn ui-btn--secondary" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="ui-menu" role="menu" id={id}>
          {items.map((it) => (
            <li key={it.label} role="none">
              <button type="button" role="menuitem" className={`ui-menu__item${it.danger ? " ui-menu__item--danger" : ""}`} disabled={it.disabled}
                onClick={() => { it.onSelect(); close(); }}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
