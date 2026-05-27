import "dotenv/config";
import { prisma } from "@pokernow/db";
import { Queue, Worker } from "bullmq";
import {
  createLogger,
  queueNames,
  readConfig,
  toBullConnection,
  type ReconcilePokerNowHandJob,
  type TrackTableJob,
} from "@pokernow/shared";
import { reconcileLatestPokerNowHands } from "./reconcile.js";
import { trackTable } from "./service.js";

const config = readConfig();
const logger = createLogger("tracker-worker", config.logLevel);
const tableWorkerConcurrency = Number(process.env.TRACKER_TABLE_CONCURRENCY ?? "10");

const tableWorker = new Worker<TrackTableJob>(
  queueNames.trackTable,
  async (job) => {
    logger.info({ jobId: job.id, tableId: job.data.tableId }, "Starting tracking job");
    await trackTable(job.data);
  },
  {
    connection: toBullConnection(config.redisUrl),
    concurrency: tableWorkerConcurrency,
  },
);

tableWorker.on("ready", () => {
  logger.info({ queue: queueNames.trackTable, concurrency: tableWorkerConcurrency }, "Tracker table worker ready");
});

tableWorker.on("error", (error) => {
  logger.error({ err: error, queue: queueNames.trackTable }, "Tracker table worker error");
});

tableWorker.on("failed", (job, error) => {
  if (!job) {
    logger.error({ err: error }, "Tracking job failed");
    return;
  }

  if (isStalledJobError(error) && isRecoveryJobId(job.id)) {
    logger.warn(
      {
        jobId: job.id,
        tableId: job.data.tableId,
      },
      "Ignoring stalled stale recovery track-table job",
    );
    return;
  }

  logger.error({ jobId: job.id, tableId: job.data.tableId, err: error }, "Tracking job failed");
  void recoverStalledTrackingJob(job.data, error);
});

const reconcileWorker = new Worker<ReconcilePokerNowHandJob>(
  queueNames.reconcilePokerNowHand,
  async (job) => {
    await reconcileLatestPokerNowHands(job.data, {
      baseUrl: config.pokernowBaseUrl,
      cookieHeader: config.pokernowCookieHeader,
      redisUrl: config.redisUrl,
    });
  },
  {
    connection: toBullConnection(config.redisUrl),
  },
);

reconcileWorker.on("ready", () => {
  logger.info({ queue: queueNames.reconcilePokerNowHand }, "Tracker reconcile worker ready");
});

reconcileWorker.on("error", (error) => {
  logger.error({ err: error, queue: queueNames.reconcilePokerNowHand }, "Tracker reconcile worker error");
});

reconcileWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "PokerNow reconcile job failed");
});

void resumeTrackedTables();

async function resumeTrackedTables() {
  const trackedTables = await prisma.trackedTable.findMany({
    where: {
      state: {
        in: ["DETECTED", "ACTIVE", "RECONNECTING"],
      },
    },
  });

  if (trackedTables.length === 0) {
    logger.info("No tracked PokerNow tables to resume");
    return;
  }

  const queue = new Queue<TrackTableJob>(queueNames.trackTable, {
    connection: toBullConnection(config.redisUrl),
  });

  for (const trackedTable of trackedTables) {
    const jobId = `track-${trackedTable.guildId}-${trackedTable.tableId}`;
    const existingJob = await queue.getJob(jobId);

    if (existingJob) {
      const existingState = await existingJob.getState();
      if (existingState === "active") {
        logger.warn(
          {
            tableId: trackedTable.tableId,
            trackedTableId: trackedTable.id,
            jobId,
            state: existingState,
          },
          "Detected active track-table job during startup resume, waiting for stall recovery or existing worker",
        );
        continue;
      }

      logger.warn(
        {
          tableId: trackedTable.tableId,
          trackedTableId: trackedTable.id,
          jobId,
          state: existingState,
        },
        "Replacing existing track-table job during startup resume",
      );

      try {
        await existingJob.remove();
      } catch (error) {
        logger.warn(
          {
            tableId: trackedTable.tableId,
            trackedTableId: trackedTable.id,
            jobId,
            state: existingState,
            err: error,
          },
          "Could not remove existing track-table job during startup resume",
        );
        continue;
      }
    }

    await queueTrackTableJob(
      queue,
      {
        guildId: trackedTable.guildId,
        trackedTableId: trackedTable.id,
        tableId: trackedTable.tableId,
        sourceUrl: trackedTable.sourceUrl,
      },
      jobId,
    );

    logger.info(
      {
        tableId: trackedTable.tableId,
        trackedTableId: trackedTable.id,
        jobId,
        trackedState: trackedTable.state,
      },
      "Re-queued tracked PokerNow table on tracker startup",
    );
  }

  await queue.close();
}

async function recoverStalledTrackingJob(job: TrackTableJob, error: Error) {
  if (!isStalledJobError(error)) {
    return;
  }

  const trackedTable = await prisma.trackedTable.findUnique({
    where: { id: job.trackedTableId },
  });

  if (!trackedTable || ["ENDED", "FAILED"].includes(trackedTable.state)) {
    logger.info(
      {
        tableId: job.tableId,
        trackedTableId: job.trackedTableId,
      },
      "Skipping stalled track-table recovery because tracking was cleared or ended",
    );
    return;
  }

  const queue = new Queue<TrackTableJob>(queueNames.trackTable, {
    connection: toBullConnection(config.redisUrl),
  });

  const recoveryJobId = `track-recover-${trackedTable.id}-${Date.now()}`;
  await queueTrackTableJob(
    queue,
    {
      guildId: trackedTable.guildId,
      trackedTableId: trackedTable.id,
      tableId: trackedTable.tableId,
      sourceUrl: trackedTable.sourceUrl,
    },
    recoveryJobId,
  );

  logger.warn(
    {
      tableId: trackedTable.tableId,
      trackedTableId: trackedTable.id,
      recoveryJobId,
    },
    "Re-queued stalled track-table job",
  );

  await queue.close();
}

function isStalledJobError(error: Error) {
  return error.name === "UnrecoverableError" && error.message.includes("job stalled more than allowable limit");
}

function isRecoveryJobId(jobId?: string | null) {
  return typeof jobId === "string" && (jobId.startsWith("track-resume-") || jobId.startsWith("track-recover-"));
}

async function queueTrackTableJob(queue: Queue<TrackTableJob>, data: TrackTableJob, jobId: string) {
  await queue.add("track-table", data, {
    jobId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}
