import { test } from "node:test";
import assert from "node:assert/strict";
import { buildValues } from "./build.mjs";

const secrets = {
  DEV_VUE_APP_FIREBASE_CONFIG: '{"projectId":"dev"}',
  DEV_VUE_APP_FIREBASE_VAPID_KEY: "dev-vapid",
  DEV_SHOPIFY_SHOP_CONFIG: '{"shop":"dev"}',
  PROD_VUE_APP_FIREBASE_CONFIG: '{"projectId":"prod"}',
  PROD_VUE_APP_FIREBASE_VAPID_KEY: "prod-vapid",
  PROD_SHOPIFY_SHOP_CONFIG: '{"shop":"prod"}',
  PROD_OMS_ALIAS: '{"prod":"https://prod"}',
  PROD_FARO_COLLECTOR_URL: "https://faro",
  PROD_FARO_API_KEY: "faro-key",
};

test("UAT builds use the dev Firebase and Shopify values only", () => {
  assert.deepEqual(buildValues("uat", secrets), {
    VITE_FIREBASE_CONFIG: '{"projectId":"dev"}',
    VITE_FIREBASE_VAPID_KEY: "dev-vapid",
    VITE_SHOPIFY_SHOP_CONFIG: '{"shop":"dev"}',
  });
});

test("production builds use every production value", () => {
  assert.deepEqual(buildValues("prod", secrets), {
    VITE_FIREBASE_CONFIG: '{"projectId":"prod"}',
    VITE_FIREBASE_VAPID_KEY: "prod-vapid",
    VITE_SHOPIFY_SHOP_CONFIG: '{"shop":"prod"}',
    VITE_ALIAS: '{"prod":"https://prod"}',
    VITE_FARO_COLLECTOR_URL: "https://faro",
    VITE_FARO_API_KEY: "faro-key",
  });
});

test("production never falls back to dev values for missing secrets", () => {
  assert.deepEqual(
    buildValues("prod", {
      DEV_VUE_APP_FIREBASE_CONFIG: '{"projectId":"dev"}',
      PROD_OMS_ALIAS: "alias",
    }),
    { VITE_ALIAS: "alias" },
  );
});
