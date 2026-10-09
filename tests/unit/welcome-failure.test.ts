import { describe, expect, it } from "vitest";
import { LOAD_FAILED, SIGN_IN_UNFINISHED, loadFailure } from "@/app/welcome/load-failure";

// R1 audit: /welcome no longer waits forever when the sign-up state can't be read.
describe("/welcome when the sign-up state can't be read", () => {
  it("a 401 while signed in says the sign-in isn't finished (with a way out), anything else asks for a reload", () => {
    expect(loadFailure(401)).toBe(SIGN_IN_UNFINISHED);
    expect(loadFailure(500)).toBe(LOAD_FAILED);
    expect(loadFailure(503)).toBe(LOAD_FAILED);
  });
});
