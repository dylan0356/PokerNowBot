import "dotenv/config";
import { Queue } from "bullmq";
import { prisma } from "../packages/db/src/index.ts";
import { queueNames, readConfig, toBullConnection } from "../packages/shared/src/index.ts";

interface ResetTrackingOptions {
  guildId: string;
  confirm: boolean;
}

const options = parseArgs(process.argv.slice(2));

if (!options.confirm) {
  throw new Error(
    "This deletes tracked tables and cascades sessions, raw events, hands, hand players, and hand actions. Re-run with --confirm-reset-tracking to continue.",
  );
}

const config = readConfig();
const queueConnection = toBullConnection(config.redisUrl);
const trackQueue = new Queue(queueNames.trackTable, { connection: queueConnection });
const reconcileQueue = new Queue(queueNames.reconcilePokerNowHand, { connection: queueConnection });

const deleted = await prisma.trackedTable.deleteMany({
  where: { guildId: options.guildId },
});

await trackQueue.drain(true);
await reconcileQueue.drain(true);
await trackQueue.close();
await reconcileQueue.close();
await prisma.$disconnect();

console.log(`Removed ${deleted.count} tracked table(s) for guild ${options.guildId}`);

function parseArgs(args: string[]): ResetTrackingOptions {
  const values = new Map<string, string>();
  let confirm = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-reset-tracking") {
      confirm = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (!inlineValue) {
      index += 1;
    }
    values.set(key, value);
  }

  const guildId = values.get("guild-id") ?? values.get("guildId");
  if (!guildId) {
    throw new Error("Usage: npm run reset:tracking -- --guild-id <discordGuildId> --confirm-reset-tracking");
  }

  return { guildId, confirm };
}
