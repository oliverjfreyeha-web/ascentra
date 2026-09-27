import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATUS_LABELS } from "@/lib/connection-status";

describe("status labels", () => {
  it("match the prototype's labels and glyphs", () => {
    const html = readFileSync("reference/ascentra.html", "utf8");
    for (const [key, s] of Object.entries(STATUS_LABELS)) {
      expect(html).toContain(`${key}:{label:"${s.label}",glyph:"${s.glyph}"`);
    }
  });
});
