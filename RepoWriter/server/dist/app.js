import express from "express";
import cors from "cors";
import health from "./routes/health.js";
import repo from "./routes/repo.js";
// Use codex router (streaming / plan / apply / validate)
import codex from "./routes/codex.js";
import git from "./routes/git.js";
import memory from "./routes/memory.js";
import usage from "./routes/usage.js";
import history from "./routes/history.js";
import { errorHandler } from "./middleware/error.js";
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api/health", health);
app.use("/api/repo", repo);
app.use("/api/openai", codex); // codex implements stream/plan/apply/validate
app.use("/api/git", git);
app.use("/api/memory", memory);
app.use("/api/usage", usage);
app.use("/api/history", history);
app.use(errorHandler);
export default app;
