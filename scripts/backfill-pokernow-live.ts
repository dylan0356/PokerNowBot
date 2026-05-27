import "dotenv/config";
import { prisma } from "../packages/db/src/index.ts";
import { fetchPokerNowLogEntries } from "../apps/tracker/src/pokernow/http.ts";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.ts";
import { persistHand } from "../apps/tracker/src/persistence.ts";
import { refreshStatsForGuild } from "../apps/workers/src/stats-refresh.ts";

interface BackfillOptions {
  guildId: string;
  tableId: string;
  from: number;
  to: number;
  refreshStats: boolean;
}

const options = parseArgs(process.argv.slice(2));

const trackedTable = await prisma.trackedTable.findUnique({
  where: {
    guildId_tableId: {
      guildId: options.guildId,
      tableId: options.tableId,
    },
  },
  include: {
    sessions: {
      orderBy: { startedAt: "desc" },
      take: 1,
    },
  },
});

if (!trackedTable || !trackedTable.sessions[0]) {
  throw new Error(`No tracked table/session found for guild ${options.guildId} and table ${options.tableId}`);
}

let fetchedHands = 0;
let parsedHands = 0;
let persistedHands = 0;
let emptyHands = 0;
let failedHands = 0;

for (let handNumber = options.from; handNumber <= options.to; handNumber += 1) {
  try {
    const entries = await fetchPokerNowLogEntries(
      process.env.POKERNOW_BASE_URL ?? "https://www.pokernow.com",
      options.tableId,
      handNumber,
      process.env.POKERNOW_COOKIE_HEADER,
    );
    fetchedHands += 1;

    const hands = parsePokerNowHandsFromLogs(options.tableId, entries);
    parsedHands += hands.length;

    if (hands.length === 0) {
      emptyHands += 1;
      console.warn(`No parsed hand for hand_number=${handNumber}`);
      continue;
    }

    for (const hand of hands) {
      await persistHand(trackedTable.sessions[0].id, hand);
      persistedHands += 1;
    }

    console.log(`Backfilled hand_number=${handNumber} parsed=${hands.length}`);
  } catch (error) {
    failedHands += 1;
    console.error(`Failed to backfill hand_number=${handNumber}`, error);
  }
}

if (options.refreshStats) {
  await refreshStatsForGuild(options.guildId);
}

console.log(
  JSON.stringify(
    {
      guildId: options.guildId,
      tableId: options.tableId,
      trackingSessionId: trackedTable.sessions[0].id,
      from: options.from,
      to: options.to,
      fetchedHands,
      parsedHands,
      persistedHands,
      emptyHands,
      failedHands,
      refreshedStats: options.refreshStats,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();

function parseArgs(args: string[]): BackfillOptions {
  const values = new Map<string, string>();
  let refreshStats = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-refresh-stats") {
      refreshStats = false;
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
  const tableId = values.get("table-id") ?? values.get("tableId");
  const from = Number(values.get("from") ?? "1");
  const to = Number(values.get("to"));

  if (!guildId || !tableId || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    throw new Error(
      "Usage: npm run backfill:pokernow-live -- --guild-id <discordGuildId> --table-id <pokernowTableId> --from 1 --to <lastHandNumber>",
    );
  }

  return {
    guildId,
    tableId,
    from,
    to,
    refreshStats,
  };
}
