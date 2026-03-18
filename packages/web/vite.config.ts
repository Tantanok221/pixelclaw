import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    proxy: {
      "/api": "http://127.0.0.1:4001",
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
    setupFiles: "./test/setup.ts",
  },
});
