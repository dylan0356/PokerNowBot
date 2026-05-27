import { Events, type Client, type Message } from "discord.js";
import { createLogger, extractPokerNowTables } from "@pokernow/shared";
import { TrackingService } from "./tracking-service.js";

const logger = createLogger("bot-message-handler");

export function registerMessageHandler(client: Client, trackingService: TrackingService) {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.guildId || message.author.bot) {
      return;
    }

    try {
      const tables = extractPokerNowTables(message.content);
      if (tables.length === 0) {
        if (message.content.toLowerCase().includes("pokernow")) {
          logger.info(
            { channelId: message.channelId, authorId: message.author.id, content: message.content },
            "PokerNow mention seen but no table URL matched",
          );
        }
        return;
      }

      logger.info(
        {
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
          tableIds: tables.map((table) => table.tableId),
        },
        "PokerNow table URL detected",
      );

      let trackedAnyTable = false;

      for (const table of tables) {
        const result = await trackingService.ensureTracking(message.guildId, message.author.id, table);
        if (result.tracked) {
          trackedAnyTable = true;
          await message.reply(`Tracking PokerNow table \`${table.tableId}\``);
        }
      }

      if (trackedAnyTable) {
        await message.react("✅").catch(() => undefined);
      }
    } catch (error) {
      logger.error(
        { err: error, guildId: message.guildId, channelId: message.channelId, authorId: message.author.id },
        "Failed to process PokerNow link",
      );
    }
  });
}
