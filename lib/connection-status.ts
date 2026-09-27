/**
 * ConnectionStatus, using the prototype's truthful labels (reference/ascentra.html, STATUS).
 * A service is Disconnected until a real call to it succeeds. Connected always carries evidence.
 */
export const STATUS_LABELS = {
  disconnected: {
    label: "Disconnected",
    glyph: "⊘",
    help: "No successful call to this service has been made.",
  },
  connected: {
    label: "Connected",
    glyph: "●",
    help: "A live service is reachable. Used only with real evidence.",
  },
} as const;

export type ServiceName = "supabase" | "clerk";

export type ConnectionStatus =
  | {
      service: ServiceName;
      status: "disconnected";
      label: "Disconnected";
      checkedAt: string;
      reason: string;
    }
  | {
      service: ServiceName;
      status: "connected";
      label: "Connected";
      checkedAt: string;
      evidence: string;
    };

export function disconnected(service: ServiceName, reason: string): ConnectionStatus {
  return { service, status: "disconnected", label: "Disconnected", checkedAt: new Date().toISOString(), reason };
}

export function connected(service: ServiceName, evidence: string): ConnectionStatus {
  return { service, status: "connected", label: "Connected", checkedAt: new Date().toISOString(), evidence };
}
