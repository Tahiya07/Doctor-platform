import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { checkDatabase } from "./config/pool.js";
import { authenticate, checkOrigin } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { mountRoutes } from "./routes/index.js";
import { checkStorage } from "./services/storage.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.trustProxy);
app.use(helmet());
app.use(cors({ origin: env.clientOrigins, credentials: true }));
if (env.nodeEnv !== "test") app.use(morgan(env.isProduction ? "combined" : "dev"));
app.use(express.json({ limit: "100kb" }));

const api = express.Router();

// Service status only: never returns credentials or connection details.
api.get("/health", async (_request, response) => {
  const checks = await Promise.allSettled([checkDatabase(), checkStorage()]);
  const services = {
    postgres: checks[0].status === "fulfilled" ? "ok" : "error",
    objectStorage: checks[1].status === "fulfilled" ? "ok" : "error",
  };
  const healthy = Object.values(services).every((status) => status === "ok");
  response.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "error", services });
});

api.use(checkOrigin); // CSRF: state-changing requests must come from our own website
api.use(authenticate); // sets request.user from the session cookie
mountRoutes(api);

app.use("/api/v1", api);

app.use((_request, response) => {
  response.status(404).json({ code: "NOT_FOUND", message: "The requested resource was not found." });
});
app.use(errorHandler);
