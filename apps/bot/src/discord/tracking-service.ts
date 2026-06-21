import { ensurePokerNowTableTracking } from "@pokernow/db";
import { createLogger, type PokerNowTableReference } from "@pokernow/shared";

const logger = createLogger("tracking-service", "info");

export class TrackingService {
  constructor(private readonly redisUrl: string) {}

  async ensureTracking(
    guildId: string,
    detectedById: string | null,
    table: PokerNowTableReference,
  ): Promise<{ tracked: boolean; trackedTableId: string }> {
    const result = await ensurePokerNowTableTracking(this.redisUrl, guildId, detectedById, table);
    if (result.tracked) {
      logger.info({ guildId, tableId: table.tableId }, "Queued track-table job");
    }

    return result;
  }
}
