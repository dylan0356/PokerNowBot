import "dotenv/config";
import * as Sentry from "@sentry/node";
import Fastify from "fastify";
import { createLogger, readConfig } from "@pokernow/shared";
import { registerHealthRoute } from "./routes/health.js";
import { registerStatsRoutes } from "./routes/stats.js";

const config = readConfig();
const logger = createLogger("api", config.logLevel);

if (config.sentryDsn) {
  Sentry.init({ dsn: config.sentryDsn });
}

async function main() {
  const app = Fastify({
    logger,
  });

  await registerHealthRoute(app);
  await registerStatsRoutes(app);

  await app.listen({
    host: "0.0.0.0",
    port: config.port,
  });
}

main().catch((error) => {
  logger.error({ err: error }, "API failed");
  process.exitCode = 1;
});
