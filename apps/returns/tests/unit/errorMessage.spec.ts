import { describe, it, expect } from "vitest";
import { describeApiError } from "@/util/errorMessage";

describe("describeApiError", () => {
  it("surfaces HTTP status and a string `errors` body (Moqui style)", () => {
    const e = { response: { status: 403, data: { errors: "User [No User] is not authorized for View on REST Path /oms/orders/{orderId}\n" } } };
    expect(describeApiError(e)).toBe("[403] User [No User] is not authorized for View on REST Path /oms/orders/{orderId}");
  });

  it("joins an array `errors` body", () => {
    const e = { response: { status: 400, data: { errors: ["bad a", "bad b"] } } };
    expect(describeApiError(e)).toBe("[400] bad a; bad b");
  });

  it("falls back to _ERROR_MESSAGE_ when present", () => {
    const e = { response: { status: 400, data: { _ERROR_MESSAGE_: "order item missing" } } };
    expect(describeApiError(e)).toBe("[400] order item missing");
  });

  it("uses the Error message when there is no response (thrown Error / network)", () => {
    expect(describeApiError(new Error("Network Error"))).toBe("Network Error");
  });

  it("uses the provided fallback when nothing else is available", () => {
    expect(describeApiError({}, "Order not found")).toBe("Order not found");
  });
});
