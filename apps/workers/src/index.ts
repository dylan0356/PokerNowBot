import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { syncPokerNowClubs } from "@pokernow/db";
import {
  createLogger,
  queueNames,
  readConfig,
  toBullConnection,
  type MonthlySnapshotJob,
  type RefreshStatsJob,
  type SyncPokerNowClubsJob,
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

new Worker<SyncPokerNowClubsJob>(
  queueNames.syncPokerNowClubs,
  async (job) => {
    const result = await syncPokerNowClubs({
      redisUrl: config.redisUrl,
      baseUrl: config.pokernowBaseUrl,
      cookieHeader: config.pokernowCookieHeader,
      guildId: job.data.guildId,
      clubId: job.data.clubId,
    });
    logger.info({ jobId: job.id, clubs: result.length }, "Synced PokerNow clubs");
  },
  { connection: toBullConnection(config.redisUrl) },
).on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "PokerNow club sync failed");
});

void schedulePokerNowClubSync();

async function schedulePokerNowClubSync() {
  const queue = new Queue<SyncPokerNowClubsJob>(queueNames.syncPokerNowClubs, {
    connection: toBullConnection(config.redisUrl),
  });

  await queue.add(
    "sync-pokernow-clubs",
    {},
    {
      jobId: "sync-pokernow-clubs-repeat",
      repeat: {
        every: 5 * 60 * 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );

  await queue.close();
}
