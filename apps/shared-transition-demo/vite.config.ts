import path from "path"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    vue()
  ],
  resolve: {
    dedupe: ["vue"],
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  test: {
    globals: true,
    environment: "jsdom"
  }
})
