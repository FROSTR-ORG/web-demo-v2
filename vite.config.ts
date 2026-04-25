import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      "8d9f-2600-1700-250-1190-d088-d696-7cde-1fde.ngrok-free.app",
      "7737-136-49-79-99.ngrok-free.app",
      "2c60-136-49-79-99.ngrok-free.app"
    ],
    fs: {
      allow: [".."]
    }
  }
});
