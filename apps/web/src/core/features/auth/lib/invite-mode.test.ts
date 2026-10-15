import { describe, expect, test } from "bun:test";
import { inviteMode, isClaimInvite } from "./invite-mode";

describe("inviteMode", () => {
  test("a plain invite keeps the join / register split", () => {
    expect(inviteMode({ claimsDisplayName: null }, true)).toBe("join");
    expect(inviteMode({ claimsDisplayName: null }, false)).toBe("register");
  });

  test("a claim invite is redeemed by registering, never by joining", () => {
    expect(inviteMode({ claimsDisplayName: "Anna" }, false)).toBe("claim-register");
    expect(inviteMode({ claimsDisplayName: "Anna" }, true)).toBe("claim-logged-in");
  });

  test("an empty name is still a claim; only null means plain", () => {
    expect(isClaimInvite({ claimsDisplayName: "" })).toBe(true);
    expect(isClaimInvite({ claimsDisplayName: null })).toBe(false);
  });

  test("a payload from an older server (no field) is a plain invite", () => {
    expect(isClaimInvite({ claimsDisplayName: undefined })).toBe(false);
    expect(isClaimInvite(null)).toBe(false);
    expect(inviteMode({ claimsDisplayName: undefined }, true)).toBe("join");
  });
});
