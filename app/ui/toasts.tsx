"use client";

import { useCallback, useState } from "react";

export type Toast = { id: number; tone: "info" | "success" | "warning" | "danger"; text: string };

/** D1 · Toasts: announced politely to screen readers, each closable. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => setToasts((t) => [...t.slice(-2), { id: Date.now() + Math.random(), tone, text }]), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ui-toast ui-toast--${t.tone}`}>
          <span className="ui-toast__body">{t.text}</span>
          <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
