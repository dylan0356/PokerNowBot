import "dotenv/config";
import { Worker } from "bullmq";
import {
  createLogger,
  queueNames,
  readConfig,
  toBullConnection,
  type MonthlySnapshotJob,
  type RefreshStatsJob,
} from "@pokernow/shared";
import { createMonthlySnapshot } from "./monthly-snapshot.js";
import { refreshStatsForGuild } from "./stats-refresh.js";

const config = readConfig();
const logger = createLogger("workers", config.logLevel);

new Worker<RefreshStatsJob>(
  queueNames.refreshStats,
  async (job) => {
    logger.info({ guildId: job.data.guildId, jobId: job.id }, "Starting stats refresh");
    await refreshStatsForGuild(job.data.guildId);
    logger.info({ guildId: job.data.guildId, jobId: job.id }, "Finished stats refresh");
  },
  { connection: toBullConnection(config.redisUrl) },
).on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "Stats refresh failed");
});

new Worker<MonthlySnapshotJob>(
  queueNames.monthlySnapshot,
  async (job) => {
    await createMonthlySnapshot(job.data.guildId, job.data.year, job.data.month);
  },
  { connection: toBullConnection(config.redisUrl) },
).on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "Monthly snapshot failed");
});
