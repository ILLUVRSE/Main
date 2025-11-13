// RepoWriter/web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the backend server
      "/api": {
        target: "http://localhost:7071",
        changeOrigin: true,
        secure: false,
        ws: true
      },
      // Proxy websocket path used by the server
      "/ws": {
        target: "ws://localhost:7071",
        ws: true
      }
    }
  }
});

