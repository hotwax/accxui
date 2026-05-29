import { createRouter, createWebHistory } from "@ionic/vue-router";
import { RouteRecordRaw } from "vue-router";
import Tabs from "@/views/Tabs.vue";
import { useAuth } from "@common";
import Login from "@common/components/Login.vue";

const authGuard = async () => {
  if (!useAuth().isAuthenticated.value) return { path: "/login" };
};

const routes: Array<RouteRecordRaw> = [
  { path: "/", redirect: "/tabs/returns" },
  { path: "/login", component: Login },
  {
    path: "/tabs",
    component: Tabs,
    children: [
      { path: "", redirect: "/tabs/returns" },
      { path: "returns", component: () => import("@/views/ReturnsList.vue"), beforeEnter: authGuard },
      { path: "returns/create", component: () => import("@/views/CreateReturn.vue"), beforeEnter: authGuard },
      { path: "returns/:returnId", component: () => import("@/views/ReturnDetail.vue"), props: true, beforeEnter: authGuard },
      { path: "settings", component: () => import("@/views/Settings.vue"), beforeEnter: authGuard },
    ],
  },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
export default router;
