// @vitest-environment node
import { createServer } from "node:http";
import { afterAll, expect, it, vi } from "vitest";

const baseURL = vi.hoisted(() => ({ value: "" }));
vi.mock("../utils/commonUtil", () => ({ commonUtil: { getToken: () => "", getMaargURL: () => baseURL.value } }));
vi.mock("../composables/useAuth", () => ({ useAuth: () => ({ isAuthenticated: { value: true } }) }));
const { default: api } = await import("../core/remoteApi");

// Exercise the real HTTP transport; this is not a HotWax service fixture.
const server = createServer((_request, response) => {
  setTimeout(() => response.end("ok"), 100);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
baseURL.value = `http://127.0.0.1:${(server.address() as any).port}`;
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

it("rejects a stalled request at the caller's timeout", async () => {
  await expect(api({ url: "/", method: "GET", timeout: 20 })).rejects.toMatchObject({ code: "ECONNABORTED" });
});

it("leaves requests without a timeout unchanged", async () => {
  expect((await api({ url: "/", method: "GET" })).data).toBe("ok");
});
