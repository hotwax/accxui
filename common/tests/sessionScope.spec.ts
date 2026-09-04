import { describe, expect, it, vi } from "vitest";
import { clearSessionScopedState, onSessionCleared } from "../core/sessionScope";

describe("common sessionScope", () => {
  it("runs every registered reset once per sweep and keeps going past a failing one", () => {
    const first = vi.fn();
    const failing = vi.fn(() => { throw new Error("boom"); });
    const last = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unregister = [onSessionCleared(first), onSessionCleared(failing), onSessionCleared(last)];

    clearSessionScopedState();

    expect(first).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    unregister.forEach((off) => off());
    consoleError.mockRestore();
  });

  it("stops calling a reset once it is unregistered", () => {
    const reset = vi.fn();
    const off = onSessionCleared(reset);
    off();

    clearSessionScopedState();

    expect(reset).not.toHaveBeenCalled();
  });
});
