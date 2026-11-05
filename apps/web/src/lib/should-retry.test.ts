import { describe, expect, test } from "bun:test";
import { ApiError } from "./api";
import { shouldRetry } from "./queries";

describe("shouldRetry (plan e6 P7a)", () => {
  test("a response that does not match its schema is not retried", () => {
    const error = new ApiError({ code: "invalid_response", status: 200, message: "x" });
    expect(shouldRetry(0, error)).toBe(false);
  });
  test("a network error is still retried twice", () => {
    const error = new ApiError({ code: "network_error", status: 0, message: "x" });
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });
  test("a 4xx is not retried", () => {
    expect(shouldRetry(0, new ApiError({ code: "not_found", status: 404, message: "x" }))).toBe(false);
  });
});
