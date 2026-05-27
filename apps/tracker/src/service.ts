import { prisma } from "@pokernow/db";
import { Queue } from "bullmq";
import { createLogger, queueNames, readConfig, toBullConnection } from "@pokernow/shared";
import type { ReconcilePokerNowHandJob, RefreshStatsJob, TrackTableJob, TrackerEventEnvelope } from "@pokernow/shared";
import { persistRawEvent } from "./persistence.js";
import { PokerNowRealtimeClient } from "./pokernow/client.js";
import { bootstrapPokerNowCookieHeader } from "./pokernow/http.js";

const config = readConfig();
const logger = createLogger("tracker", config.logLevel);
const refreshStatsQueue = new Queue<RefreshStatsJob>(queueNames.refreshStats, {
  connection: toBullConnection(config.redisUrl),
});
const reconcileQueue = new Queue<ReconcilePokerNowHandJob>(queueNames.reconcilePokerNowHand, {
  connection: toBullConnection(config.redisUrl),
});

export async function trackTable(job: TrackTableJob) {
  const trackedTable = await prisma.trackedTable.update({
    where: { id: job.trackedTableId },
    data: {
      state: "ACTIVE",
      lastHeartbeatAt: new Date(),
    },
  });

  await prisma.trackingSession.updateMany({
    where: {
      trackedTableId: trackedTable.id,
      status: {
        in: ["ACTIVE", "RECONNECTING"],
      },
      endedAt: null,
    },
    data: {
      status: "ENDED",
      endedAt: new Date(),
    },
  });

  const session = await prisma.trackingSession.create({
    data: {
      trackedTableId: trackedTable.id,
      status: "ACTIVE",
    },
  });

  let sequence = 0;
  let lastKnownFrameNow: number | undefined;
  let lastObservedHandNumber: number | undefined;
  let lastQueuedCompletedHandNumber: number | undefined;
  let lastKnownPlayersCount: number | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let client: PokerNowRealtimeClient;
  const cookieHeader = await bootstrapPokerNowCookieHeader(
    config.pokernowBaseUrl,
    job.tableId,
    config.pokernowCookieHeader,
  );

  const persistSocketEvent = async (
    eventType: string,
    socketEvent: string,
    payload: Record<string, unknown>,
    connectionAttempt: number,
  ) => {
    sequence += 1;
    const occurredAt = new Date().toISOString();
    const event: TrackerEventEnvelope = {
      tableId: job.tableId,
      eventType,
      sequence,
      occurredAt,
      payload: {
        socketEvent,
        data: payload,
        connectionAttempt,
      },
    };

    await persistRawEvent(session.id, event);
    await prisma.trackedTable.update({
      where: { id: trackedTable.id },
      data: {
        lastHeartbeatAt: new Date(occurredAt),
      },
    });
  };

  const enqueueReconcile = async (handNumber?: number) => {
    await reconcileQueue.add(
      "reconcile-latest-hand",
      {
        guildId: job.guildId,
        trackingSessionId: session.id,
        trackedTableId: trackedTable.id,
        tableId: job.tableId,
        handNumber,
      },
      {
        delay: 1500,
        attempts: 3,
        removeOnComplete: 100,
      },
    );
  };

  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(() => {
      logger.info(
        {
          tableId: job.tableId,
          timeoutMs: config.pokernowHeartbeatTimeoutMs,
        },
        "Ending PokerNow tracking after heartbeat timeout",
      );
      client.disconnect();
    }, config.pokernowHeartbeatTimeoutMs);
  };

  client = new PokerNowRealtimeClient({
    socketUrl: config.pokernowSocketUrl,
    tableId: job.tableId,
    layout: config.pokernowLayout,
    cookieHeader,
    queryPlayerToken: config.pokernowQueryPlayerToken,
    onConnecting: async (details) => {
      logger.info(
        {
          tableId: details.tableId,
          socketUrl: details.socketUrl,
          layout: details.layout,
          hasCookieHeader: details.hasCookieHeader,
          hasQueryPlayerToken: details.hasQueryPlayerToken,
          connectionAttempt: details.connectionAttempt,
        },
        "PokerNow websocket connecting",
      );
    },
    onConnected: async (details) => {
      resetIdleTimer();
      logger.info(
        {
          tableId: details.tableId,
          socketUrl: details.socketUrl,
          connectionAttempt: details.connectionAttempt,
        },
        "PokerNow websocket connected",
      );
    },
    onRegistered: async (payload, connectionAttempt) => {
      resetIdleTimer();
      const summary = summarizePokerNowPayload(payload);
      lastKnownPlayersCount = summary.playersCount ?? lastKnownPlayersCount;
      logger.info(
        {
          tableId: job.tableId,
          handNumber: summary.handNumber,
          playersCount: lastKnownPlayersCount,
        },
        "PokerNow websocket registered",
      );
      await prisma.trackedTable.update({
        where: { id: trackedTable.id },
        data: { state: "ACTIVE" },
      });
      await persistSocketEvent("socket_registered", "registered", payload, connectionAttempt);
    },
    onSocketEvent: async (socketEvent, payload, connectionAttempt) => {
      resetIdleTimer();
      const summary = summarizePokerNowPayload(payload);
      lastKnownPlayersCount = summary.playersCount ?? lastKnownPlayersCount;
      if (summary.handNumber !== undefined && summary.handNumber !== lastObservedHandNumber) {
        const previousObservedHandNumber = lastObservedHandNumber;
        lastObservedHandNumber = summary.handNumber;
        logger.info(
          {
            tableId: job.tableId,
            handNumber: summary.handNumber,
            playersCount: lastKnownPlayersCount,
          },
          "PokerNow hand observed",
        );

        if (
          previousObservedHandNumber !== undefined &&
          summary.handNumber > previousObservedHandNumber &&
          previousObservedHandNumber !== lastQueuedCompletedHandNumber
        ) {
          lastQueuedCompletedHandNumber = previousObservedHandNumber;
          logger.info(
            {
              tableId: job.tableId,
              completedHandNumber: previousObservedHandNumber,
              currentHandNumber: summary.handNumber,
            },
            "PokerNow completed hand detected, queuing reconcile",
          );
          await enqueueReconcile(previousObservedHandNumber);
        }
      }
      const eventType = socketEvent === "rup" ? "socket_rup" : socketEvent === "gC" ? "socket_gc" : `socket_${socketEvent.toLowerCase()}`;
      await persistSocketEvent(eventType, socketEvent, payload, connectionAttempt);

      if (socketEvent === "rup") {
        lastKnownFrameNow = extractNumericField(payload, "now") ?? lastKnownFrameNow;
        return;
      }

      if (socketEvent === "gC") {
        const previousFrameNow = extractNumericField(payload, "pre");
        if (
          typeof previousFrameNow === "number" &&
          typeof lastKnownFrameNow === "number" &&
          previousFrameNow !== lastKnownFrameNow
        ) {
          logger.warn({ tableId: job.tableId, previousFrameNow, lastKnownFrameNow }, "Detected PokerNow frame gap, requesting resync");
          client.requestResync();
        }

        lastKnownFrameNow = extractNumericField(payload, "now") ?? lastKnownFrameNow;
        if (isHandResult(payload)) {
          logger.info(
            {
              tableId: job.tableId,
              handNumber: summary.handNumber ?? lastObservedHandNumber,
              pot: summary.pot,
              playersCount: lastKnownPlayersCount,
            },
            "PokerNow hand result observed",
          );
        }
      }
    },
    onReconnectAttempt: async (connectionAttempt) => {
      resetIdleTimer();
      logger.warn(
        {
          tableId: job.tableId,
          connectionAttempt,
        },
        "PokerNow websocket reconnect attempt",
      );
      await prisma.trackedTable.update({
        where: { id: trackedTable.id },
        data: { state: "RECONNECTING" },
      });
      await persistSocketEvent("socket_reconnect_attempt", "reconnect_attempt", {}, connectionAttempt);
    },
    onDisconnect: async (reason, connectionAttempt) => {
      resetIdleTimer();
      logger.warn(
        {
          tableId: job.tableId,
          connectionAttempt,
          reason,
        },
        "PokerNow websocket disconnected",
      );
      await persistSocketEvent("socket_disconnect", "disconnect", { reason }, connectionAttempt);
    },
    onFailed: async (payload, connectionAttempt) => {
      resetIdleTimer();
      logger.error(
        {
          tableId: job.tableId,
          connectionAttempt,
          keys: Object.keys(payload),
        },
        "PokerNow websocket failed event",
      );
      await persistSocketEvent("socket_failed", "failed", payload, connectionAttempt);
    },
    onConnectError: async (error, connectionAttempt) => {
      logger.error(
        {
          tableId: job.tableId,
          connectionAttempt,
          err: error,
        },
        "PokerNow websocket connect error",
      );
    },
  });

  try {
    logger.info({ tableId: job.tableId }, "Tracker connecting directly to PokerNow");
    await client.connectAndRun();
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    await prisma.trackedTable.update({
      where: { id: trackedTable.id },
      data: {
        state: "ENDED",
        endedAt: new Date(),
      },
    });
    await prisma.trackingSession.update({
      where: { id: session.id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });
  } catch (error) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    await prisma.trackedTable.update({
      where: { id: trackedTable.id },
      data: { state: "FAILED" },
    });
    await prisma.trackingSession.update({
      where: { id: session.id },
      data: {
        status: "FAILED",
        endedAt: new Date(),
      },
    });
    throw error;
  }
}

interface PokerNowPayloadSummary {
  handNumber?: number;
  gameType?: string;
  pot?: number;
  playersCount?: number;
  boardCards?: number;
  hasGameResult: boolean;
  eventCount?: number;
}

function summarizePokerNowPayload(value: unknown): PokerNowPayloadSummary {
  return {
    handNumber: extractNumericField(value, "hI") ?? extractNumericField(value, "nR") ?? extractNumericField(value, "gN"),
    gameType: extractStringField(value, "gT"),
    pot: extractNumericField(value, "pot"),
    playersCount: countPlayers(value),
    boardCards: countBoardCards(value),
    hasGameResult: hasField(value, "gameResult"),
    eventCount: countEventsData(value),
  };
}

function extractNumericField(value: unknown, field: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record[field] === "number") {
    return record[field] as number;
  }

  for (const nested of Object.values(record)) {
    const found = extractNumericField(nested, field);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function extractStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record[field] === "string") {
    return record[field] as string;
  }

  for (const nested of Object.values(record)) {
    const found = extractStringField(nested, field);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function hasField(value: unknown, field: string): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (field in record) {
    return true;
  }

  return Object.values(record).some((nested) => hasField(nested, field));
}

function countPlayers(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const players = record.players;
  if (players && typeof players === "object" && !Array.isArray(players)) {
    return Object.keys(players as Record<string, unknown>).length;
  }

  for (const nested of Object.values(record)) {
    const found = countPlayers(nested);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function countBoardCards(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const cards = record.cHB;
  if (Array.isArray(cards)) {
    return cards.length;
  }

  for (const nested of Object.values(record)) {
    const found = countBoardCards(nested);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function countEventsData(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const eventsData = record.eventsData;
  if (Array.isArray(eventsData)) {
    return eventsData.length;
  }

  for (const nested of Object.values(record)) {
    const found = countEventsData(nested);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function isHandResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.gT === "gameResult" || "gameResult" in record) {
    return true;
  }

  return Object.values(record).some((nested) => isHandResult(nested));
}
