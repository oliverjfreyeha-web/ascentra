import type { AuditFilters } from "@/lib/audit";

const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

/** Search filters from a query string or JSON body. Anything malformed is dropped, not guessed. */
export function parseAuditFilters(input: Record<string, unknown> | URLSearchParams): AuditFilters {
  const get = (k: string) => {
    const v = input instanceof URLSearchParams ? input.get(k) : input[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const date = (k: string, endOfDay = false) => {
    const v = get(k);
    if (!v || !DATE.test(v)) return undefined;
    return v.length === 10 ? `${v}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z` : v;
  };
  const before = Number(get("before"));
  return {
    actor: get("actor"),
    action: get("action"),
    target: get("target"),
    from: date("from"),
    to: date("to", true),
    before: Number.isInteger(before) && before > 0 ? before : undefined,
  };
}
