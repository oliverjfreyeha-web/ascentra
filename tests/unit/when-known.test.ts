/**
 * S1 Part B: a device's time is shown with its date, or only the date when the time isn't known (a date-only value or
 * exactly midnight), never "12:00:00 AM". app/call.ts whenKnown, used by the Account page's devices, the device check
 * and the security console's device columns.
 */
import { describe, expect, it } from "vitest";
import { whenKnown } from "@/app/call";

const NY = "America/New_York";
describe("whenKnown", () => {
  it("a date-only value shows only the date, on that same day", () => {
    expect(whenKnown("2026-10-01", "en-US", NY)).toBe("10/1/2026");
  });
  it("exactly midnight (UTC or local) shows only the date, never 12:00:00 AM", () => {
    expect(whenKnown("2026-10-01T00:00:00Z", "en-US", NY)).toBe("10/1/2026");
    expect(whenKnown("2026-10-01T00:00:00+00:00", "en-US", NY)).toBe("10/1/2026");
    expect(whenKnown("2026-10-01T04:00:00Z", "en-US", NY)).toBe("10/1/2026");
    expect(whenKnown("2026-10-01T04:00:00Z", "en-US", NY)).not.toMatch(/12:00:00/);
  });
  it("a real time shows the date and the time", () => {
    expect(whenKnown("2026-10-01T15:42:07.123Z", "en-US", NY)).toBe("10/1/2026, 11:42:07 AM");
  });
  it("nothing, or a value that isn't a date, shows a dash", () => {
    expect(whenKnown(null)).toBe("—");
    expect(whenKnown("not a date")).toBe("—");
  });
});
