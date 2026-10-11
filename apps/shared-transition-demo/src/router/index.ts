import { createRouter, createWebHistory } from "@ionic/vue-router"
import type { RouteRecordRaw } from "vue-router"

import ProjectDetail from "@/views/ProjectDetail.vue"
import ProjectList from "@/views/ProjectList.vue"

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/projects"
  },
  {
    path: "/projects",
    name: "ProjectList",
    component: ProjectList
  },
  {
    path: "/projects/:projectId",
    name: "ProjectDetail",
    component: ProjectDetail,
    props: true
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/projects"
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
