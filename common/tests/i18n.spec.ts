// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createDxpI18n, setLocale, translate } from "../core/i18n";
import { commonUtil } from "../utils/commonUtil";

const messages = {
  "en-US": { "{count} orders": "{count} order | {count} orders", "Order {id}": "Order {id}", "Hi {name}": "Hi {name}" },
  "es-ES": { "{count} orders": "{count} pedido | {count} pedidos", "Order {id}": "Pedido {id}", "Hi {name}": "Hola {name}" },
};

const clearCookies = () => {
  for(const cookie of document.cookie.split(";")) {document.cookie = `${cookie.split("=")[0].trim()}=; path=/; max-age=0`;}
};

describe("i18n", () => {
  beforeEach(() => {
    clearCookies();
    createDxpI18n(messages);
    setLocale("en-US");
  });

  it("shows the count in the current language and picks the plural form from it", () => {
    expect([1, 1204].map((count) => translate("{count} orders", { count }))).toEqual(["1 order", "1,204 orders"]);
    setLocale("es-ES");
    expect([1, 12000].map((count) => translate("{count} orders", { count }))).toEqual(["1 pedido", "12.000 pedidos"]);
  });

  it("leaves other number parameters, such as IDs, as they are", () => {
    expect(translate("Order {id}", { id: 123456 })).toBe("Order 123456");
  });

  it("keeps translate options alongside a count", () => {
    expect(translate("Hi {name}", { name: "<b>", count: 2 }, { escapeParameter: true })).toBe("Hi &lt;b&gt;");
  });

  it("starts in the saved language, ignoring one the app does not ship", () => {
    document.cookie = "locale=es-ES; path=/";
    createDxpI18n(messages);
    expect(translate("Order {id}", { id: "7" })).toBe("Pedido 7");

    document.cookie = "locale=fr-FR; path=/";
    createDxpI18n(messages);
    expect(translate("Order {id}", { id: "7" })).toBe("Order 7");
  });

  it("saves the chosen language and keeps <html lang> in step", async () => {
    setLocale("es-ES");
    await nextTick();
    expect(document.documentElement.lang).toBe("es-ES");
    expect(document.cookie).toContain("locale=es-ES");
  });

  it("describes schedules in the current language", () => {
    expect(commonUtil.getCronString("0 */5 * ? * *")).toBe("Every 5 minutes");
    setLocale("es-ES");
    expect(commonUtil.getCronString("0 */5 * ? * *")).toMatch(/^Cada 5 minutos/);
  });
});
