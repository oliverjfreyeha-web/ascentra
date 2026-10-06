"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** D1 · A modal on the native <dialog>: focus stays inside, Escape closes, focus returns to the opener. */
export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="ui-modal" aria-labelledby="ui-modal-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="ui-modal__body">
        <h2 id="ui-modal-title" style={{ marginTop: 0 }}>{title}</h2>
        {children}
      </div>
      <div className="ui-modal__actions">{actions}</div>
    </dialog>
  );
}
