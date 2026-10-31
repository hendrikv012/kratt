import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  // Port 1420 is the origin the Study folder service (engine/ memory-engine serve) allows,
  // and where the study app's saved browser settings live.
  server: {
    port: 1420,
    strictPort: true,
  },
});
