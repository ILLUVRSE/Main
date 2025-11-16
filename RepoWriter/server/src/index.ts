// RepoWriter/server/src/index.ts
//
// Server entrypoint for RepoWriter server.
// Runs startup checks (sanity / config) before binding the HTTP server.
//
// Note: runStartupChecks will throw on fatal misconfiguration (e.g., REQUIRE_SIGNING_PROXY=1 in prod without SIGNING_PROXY_URL).

import express from "express";
import catalogRoutes from "./routes/catalog.route";
import checkoutRoutes from "./routes/checkout.route";
import { runStartupChecks } from "./startupCheck";

async function main() {
  try {
    // Run startup checks and fail fast if misconfigured
    await runStartupChecks();
  } catch (err: any) {
    console.error("Startup checks failed:", err?.message ?? err);
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Application routes
  app.use("/api/catalog", catalogRoutes);
  app.use("/api/checkout", checkoutRoutes);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// If top-level await is not desired, use the wrapper below.
main().catch((err) => {
  console.error("Server failed to start:", err?.message ?? err);
  process.exit(1);
});

