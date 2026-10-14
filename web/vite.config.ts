import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from https://<user>.github.io/stock-screener/
export default defineConfig({
  base: "/stock-screener/",
  plugins: [react()],
});
