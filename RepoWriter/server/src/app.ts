import express from "express";
import cors from "cors";
import health from "./routes/health.js";
import repo from "./routes/repo.js";
import openai from "./routes/openai.js";
import git from "./routes/git.js";
import memory from "./routes/memory.js";
import usage from "./routes/usage.js";
import { errorHandler } from "./middleware/error.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/health", health);
app.use("/api/repo", repo);
app.use("/api/openai", openai);
app.use("/api/git", git);
app.use("/api/memory", memory);
app.use("/api/usage", usage);

app.use(errorHandler);
export default app;

