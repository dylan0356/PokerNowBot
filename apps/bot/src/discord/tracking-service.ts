import { prisma } from "@pokernow/db";
import { Queue } from "bullmq";
import { createLogger, queueNames, toBullConnection, type PokerNowTableReference, type TrackTableJob } from "@pokernow/shared";

const logger = createLogger("tracking-service", "info");

export class TrackingService {
  constructor(private readonly redisUrl: string) {}

  async ensureTracking(
    guildId: string,
    detectedById: string | null,
    table: PokerNowTableReference,
  ): Promise<{ tracked: boolean; trackedTableId: string }> {
    await prisma.guild.upsert({
      where: { id: guildId },
      update: {},
      create: { id: guildId },
    });

    const existing = await prisma.trackedTable.findUnique({
      where: {
        guildId_tableId: {
          guildId,
          tableId: table.tableId,
        },
      },
    });

    if (existing && existing.state !== "FAILED" && existing.state !== "ENDED") {
      return { tracked: false, trackedTableId: existing.id };
    }

    const trackedTable = existing
      ? await prisma.trackedTable.update({
          where: { id: existing.id },
          data: {
            state: "DETECTED",
            sourceUrl: table.normalizedUrl,
            detectedById: detectedById ?? undefined,
            detectedAt: new Date(),
            lastHeartbeatAt: null,
            endedAt: null,
          },
        })
      : await prisma.trackedTable.create({
          data: {
            guildId,
            tableId: table.tableId,
            sourceUrl: table.normalizedUrl,
            detectedById: detectedById ?? undefined,
          },
        });

    const queue = new Queue<TrackTableJob>(queueNames.trackTable, {
      connection: toBullConnection(this.redisUrl),
    });

    const jobId = `track-${guildId}-${table.tableId}`;
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      logger.warn(
        {
          guildId,
          tableId: table.tableId,
          jobId,
          state: await existingJob.getState(),
        },
        "Replacing existing track-table job",
      );
      await existingJob.remove();
    }

    await queue.add(
      "track-table",
      {
        guildId,
        trackedTableId: trackedTable.id,
        tableId: table.tableId,
        sourceUrl: table.normalizedUrl,
      },
      {
        jobId,
      },
    );

    logger.info({ guildId, tableId: table.tableId, jobId }, "Queued track-table job");

    await queue.close();

    return { tracked: true, trackedTableId: trackedTable.id };
  }
}
