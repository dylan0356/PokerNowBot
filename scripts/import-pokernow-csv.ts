import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../packages/db/src/index.ts";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.ts";
import { persistHand, persistRawEvent } from "../apps/tracker/src/persistence.ts";
import { refreshStatsForGuild } from "../apps/workers/src/stats-refresh.ts";
import type { PokerNowLogEntry, TrackerEventEnvelope } from "../packages/shared/src/types.ts";

interface ImportOptions {
  guildId: string;
  tableId: string;
  csvPath: string;
  sourceUrl: string;
}

const options = parseArgs(process.argv.slice(2));
const csv = await readFile(options.csvPath, "utf8");
const entries = parsePokerNowCsv(csv);
const hands = parsePokerNowHandsFromLogs(options.tableId, entries);

await prisma.guild.upsert({
  where: { id: options.guildId },
  update: {},
  create: { id: options.guildId },
});

const trackedTable = await prisma.trackedTable.upsert({
  where: {
    guildId_tableId: {
      guildId: options.guildId,
      tableId: options.tableId,
    },
  },
  update: {
    sourceUrl: options.sourceUrl,
  },
  create: {
    guildId: options.guildId,
    tableId: options.tableId,
    sourceUrl: options.sourceUrl,
    state: "ENDED",
  },
});

const session = await prisma.trackingSession.create({
  data: {
    trackedTableId: trackedTable.id,
    status: "ENDED",
    startedAt: hands[0]?.startedAt ? new Date(hands[0].startedAt) : new Date(),
    endedAt: hands.at(-1)?.finishedAt ? new Date(hands.at(-1)!.finishedAt) : new Date(),
  },
});

const rawEvent: TrackerEventEnvelope = {
  tableId: options.tableId,
  eventType: "csv_log_import",
  sequence: 1,
  occurredAt: new Date().toISOString(),
  payload: {
    source: "csv",
    csvPath: options.csvPath,
    entries,
  },
};
await persistRawEvent(session.id, rawEvent);

let insertedHands = 0;
let updatedHands = 0;
for (const hand of hands) {
  const exists = await prisma.hand.findUnique({
    where: { id: hand.handId },
    select: { id: true },
  });
  await persistHand(session.id, hand);
  if (exists) {
    updatedHands += 1;
  } else {
    insertedHands += 1;
  }
}

await refreshStatsForGuild(options.guildId);

console.log(
  JSON.stringify(
    {
      guildId: options.guildId,
      tableId: options.tableId,
      csvPath: options.csvPath,
      entries: entries.length,
      parsedHands: hands.length,
      insertedHands,
      updatedHands,
      trackingSessionId: session.id,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();

function parseArgs(args: string[]): ImportOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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
  const csvPath = values.get("csv");
  if (!guildId || !tableId || !csvPath) {
    throw new Error(
      "Usage: npm run import:pokernow-csv -- --guild-id <discordGuildId> --table-id <pokernowTableId> --csv <path/to/log.csv>",
    );
  }

  return {
    guildId,
    tableId,
    csvPath,
    sourceUrl: values.get("source-url") ?? values.get("sourceUrl") ?? `https://www.pokernow.com/games/${tableId}`,
  };
}

function parsePokerNowCsv(csv: string): PokerNowLogEntry[] {
  const rows = parseCsv(csv);
  const [header, ...body] = rows;
  if (!header) {
    return [];
  }

  const entryIndex = header.indexOf("entry");
  const orderIndex = header.indexOf("order");
  if (entryIndex === -1 || orderIndex === -1) {
    throw new Error("CSV must contain entry and order columns");
  }

  return body
    .filter((row) => row[entryIndex] && row[orderIndex])
    .map((row) => ({
      msg: row[entryIndex],
      createdAt: row[orderIndex],
    }));
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}
