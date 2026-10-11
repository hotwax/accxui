import { IonicVue } from "@ionic/vue"
import { createApp } from "vue"

import "@ionic/vue/css/core.css"
import "@ionic/vue/css/normalize.css"
import "@ionic/vue/css/structure.css"
import "@ionic/vue/css/typography.css"
import "@ionic/vue/css/padding.css"
import "@ionic/vue/css/display.css"
import "@ionic/vue/css/palettes/dark.system.css"
import "./styles.css"

import App from "./App.vue"
import { sharedElementDirective } from "./directives/sharedElement"
import router from "./router"

const app = createApp(App)
  .use(IonicVue, {
    mode: "md"
  })
  .use(router)

app.directive("shared-element", sharedElementDirective)

router.isReady().then(() => {
  app.mount("#app")
})
