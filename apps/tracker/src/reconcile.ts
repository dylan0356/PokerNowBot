import { prisma } from "@pokernow/db";
import { Queue } from "bullmq";
import { createLogger, queueNames, readConfig, toBullConnection } from "@pokernow/shared";
import type { ReconcilePokerNowHandJob, TrackerEventEnvelope } from "@pokernow/shared";
import { fetchPokerNowLogEntries } from "./pokernow/http.js";
import { parsePokerNowHandsFromLogs } from "./parser/log-parser.js";
import { persistHand, persistRawEvent } from "./persistence.js";

const config = readConfig();
const logger = createLogger("tracker-reconcile", config.logLevel);
const refreshStatsDelayMs = Number(process.env.REFRESH_STATS_DELAY_MS ?? "180000");

export async function reconcileLatestPokerNowHands(
  job: ReconcilePokerNowHandJob,
  options: { baseUrl: string; cookieHeader?: string; redisUrl: string },
) {
  logger.debug({ tableId: job.tableId, handNumber: job.handNumber }, "Starting PokerNow reconcile");
  const refreshStatsQueue = new Queue(queueNames.refreshStats, {
    connection: toBullConnection(options.redisUrl),
  });
  const sequenceBase = await prisma.rawTableEvent.aggregate({
    where: { trackingSessionId: job.trackingSessionId },
    _max: { sequence: true },
  });
  let sequence = (sequenceBase._max.sequence ?? 0) + 1;
  const entries = await fetchPokerNowLogEntries(options.baseUrl, job.tableId, job.handNumber, options.cookieHeader);
  const rawEvent: TrackerEventEnvelope = {
    tableId: job.tableId,
    eventType: "log_v3_page",
    sequence: sequence++,
    occurredAt: new Date().toISOString(),
    payload: {
      source: "log_v3",
      handNumber: job.handNumber,
      entries,
    },
  };
  await persistRawEvent(job.trackingSessionId, rawEvent);

  const hands = parsePokerNowHandsFromLogs(job.tableId, entries);
  let insertedHands = 0;
  let lastInsertedHandNumber: number | undefined;
  for (const hand of hands) {
    const exists = await prisma.hand.findUnique({
      where: { id: hand.handId },
    });

    if (!exists) {
      await persistHand(job.trackingSessionId, hand);
      insertedHands += 1;
      lastInsertedHandNumber = hand.handNumber;
    }
  }

  if (insertedHands > 0) {
    await refreshStatsQueue.add(
      "refresh-stats",
      {
        guildId: job.guildId,
      },
      {
        jobId: `refresh-stats-${job.guildId}`,
        delay: refreshStatsDelayMs,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  logger.info(
    {
      tableId: job.tableId,
      handNumber: job.handNumber,
      fetchedEntries: entries.length,
      parsedHands: hands.length,
      insertedHands,
      lastInsertedHandNumber,
      refreshStatsDelayMs: insertedHands > 0 ? refreshStatsDelayMs : undefined,
    },
    "Finished PokerNow reconcile",
  );
  await refreshStatsQueue.close();
}
