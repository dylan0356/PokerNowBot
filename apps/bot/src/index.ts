import "dotenv/config";
import * as Sentry from "@sentry/node";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { createLogger, readConfig } from "@pokernow/shared";
import { CommandService } from "./discord/command-service.js";
import { registerInteractionHandler, registerSlashCommands } from "./discord/commands.js";
import { registerMessageHandler } from "./discord/register-message-handler.js";
import { TrackingService } from "./discord/tracking-service.js";

const config = readConfig();
const logger = createLogger("bot", config.logLevel);

if (config.sentryDsn) {
  Sentry.init({ dsn: config.sentryDsn });
}

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
  });
  const trackingService = new TrackingService(config.redisUrl);
  const commandService = new CommandService();

  registerMessageHandler(client, trackingService);
  registerInteractionHandler(client, commandService, config.redisUrl);

  client.once(Events.ClientReady, () => {
    logger.info({ botUser: client.user?.tag }, "Discord bot ready");
  });

  await registerSlashCommands(config.discordToken, config.discordClientId, config.discordGuildIds);
  await client.login(config.discordToken);
}

main().catch((error) => {
  logger.error({ err: error }, "Bot failed");
  process.exitCode = 1;
});
