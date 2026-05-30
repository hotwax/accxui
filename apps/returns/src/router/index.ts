import { createRouter, createWebHistory } from "@ionic/vue-router";
import { RouteRecordRaw } from "vue-router";
import Tabs from "@/views/Tabs.vue";
import { commonUtil, translate, useAuth } from "@common";
import Login from "@common/components/Login.vue";
import { useUserStore } from "@/store/userStore";

declare module "vue-router" {
  interface RouteMeta {
    permissionId?: string;
  }
}

const authGuard = async (to: any) => {
  if (!useAuth().isAuthenticated.value) {
    to.fullPath != "/" && localStorage.setItem("requestedPagePath", to.fullPath);
    return { path: "/login" };
  }
};

const routes: Array<RouteRecordRaw> = [
  { path: "/", redirect: "/tabs/returns" },
  { path: "/login", name: "Login", component: Login },
  {
    path: "/tabs",
    component: Tabs,
    beforeEnter: authGuard,
    children: [
      { path: "", redirect: "/tabs/returns" },
      { path: "returns", name: "Returns", component: () => import("@/views/ReturnsList.vue") },
      { path: "settings", name: "Settings", component: () => import("@/views/Settings.vue") },
    ],
  },
  { path: "/create-return", name: "CreateReturn", component: () => import("@/views/CreateReturn.vue"), beforeEnter: authGuard },
  { path: "/return-detail/:returnId", name: "ReturnDetail", component: () => import("@/views/ReturnDetail.vue"), props: true, beforeEnter: authGuard },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });

// Shared flow contract: block routes the user lacks permission for. No route sets permissionId yet
// (returns defines no permissions), but the guard is installed so the flow matches other apps.
router.beforeEach((to, from) => {
  const userStore = useUserStore();
  if (to.meta.permissionId && !userStore.hasPermission(to.meta.permissionId)) {
    let redirectToPath = from.path;
    if (redirectToPath == "/login" || redirectToPath == "/") redirectToPath = "/tabs/settings";
    else commonUtil.showToast(translate("You do not have permission to access this page"), { position: "top" });
    return { path: redirectToPath };
  }
});

export default router;
