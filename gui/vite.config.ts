import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    hmr: process.env.VITE_TEST_MODE === "true" ? false : undefined,
  },
});
