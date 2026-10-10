/**
 * I1 (C2 live check): the Admin link in the main navigation is for the Owner and staff only, and the admin home lists
 * each role's pages (the server still decides every request). Import course is the Owner's.
 */
import { describe, expect, it } from "vitest";
import { adminLinksFor, isStaff } from "@/app/admin-links";
import { decide, ROLES } from "@/lib/caps";

describe("admin links", () => {
  it("the Admin link: Owner and staff, never learners or Guardians", () => {
    expect(ROLES.filter((r) => isStaff(r)).sort()).toEqual(["courseAdmin", "owner", "reviewer", "superAdmin", "support"].sort());
    expect(isStaff("learner")).toBe(false);
    expect(isStaff("guardian")).toBe(false);
    expect(isStaff(null)).toBe(false);
  });

  it("Import course is listed for the Owner only, matching the capability", () => {
    for (const r of ROLES) {
      const listed = adminLinksFor(r).some((l) => l.href === "/admin/import");
      expect(listed).toBe(decide({ role: r, assignedCourses: [] }, "courses.import").allowed);
    }
  });

  it("learners and Guardians get no admin pages", () => {
    expect(adminLinksFor("learner")).toEqual([]);
    expect(adminLinksFor("guardian")).toEqual([]);
  });
});
