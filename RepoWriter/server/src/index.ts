import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// Log early to verify envs are present
console.log("[Env] OPENAI_API_KEY prefix:", (process.env.OPENAI_API_KEY || "").slice(0, 10));
console.log("[Env] OPENAI_PROJECT_ID:", process.env.OPENAI_PROJECT_ID);

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && (err.stack || err));
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});

async function main() {
  try {
    // Defer heavy imports so we can see env logs first
    const { default: app } = await import("./app.js");
    const { initWs } = await import("./ws/server.js");

    const port = Number(process.env.PORT || 7071);
    const server = createServer(app);
    const wss = new WebSocketServer({ server, path: "/ws" });
    initWs(wss);

    server.listen(port, () => {
      console.log(`[RepoWriter] server listening on http://localhost:${port}`);
    });
  } catch (err: any) {
    console.error("[startup error]", err && (err.stack || err));
    process.exit(1);
  }
}

main();

