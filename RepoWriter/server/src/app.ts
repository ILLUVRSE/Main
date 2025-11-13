import express from "express";
import cors from "cors";
import health from "./routes/health";
import repo from "./routes/repo";
// Use codex router (streaming / plan / apply / validate)
import codex from "./routes/codex";
import git from "./routes/git";
import memory from "./routes/memory";
import usage from "./routes/usage";
import history from "./routes/history";
import kernelApi from "./services/kernelApi";
import { errorHandler } from "./middleware/error";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/health", health);
app.use("/api/repo", repo);
app.use("/api/openai", codex);   // codex implements stream/plan/apply/validate
app.use("/api/git", git);
app.use("/api/memory", memory);
app.use("/api/usage", usage);
app.use("/api/history", history);
app.use("/", kernelApi);

app.use(errorHandler);
export default app;
