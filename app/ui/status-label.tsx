import type { ReactNode } from "react";

/*
 * D1 · Status labels. Each state has its own hue and shape (see app/styles/components.css). The state is required:
 * nothing is shown as Connected or Verified unless the caller says so from a real answer.
 */
export type StatusState = "demo" | "simulated" | "disconnected" | "checking" | "connected" | "verified" | "failed" | "draft" | "published";

export const STATUS_TEXT: Record<StatusState, string> = {
  demo: "Demo",
  simulated: "Simulated",
  disconnected: "Disconnected",
  checking: "Checking",
  connected: "Connected",
  verified: "Verified",
  failed: "Failed",
  draft: "Draft",
  published: "Published",
};

export function StatusLabel({ state, children }: { state: StatusState; children?: ReactNode }) {
  return (
    <span className="ui-status" data-state={state}>
      <span className="ui-status__mark" aria-hidden="true" />
      {children ?? STATUS_TEXT[state]}
    </span>
  );
}
