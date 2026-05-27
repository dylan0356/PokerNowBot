import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { normalizePokerNowAlias, prisma, resolveAliasOwner } from "../packages/db/src/index.ts";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.ts";
import { persistRawEvent } from "../apps/tracker/src/persistence.ts";
import { refreshStatsForGuild } from "../apps/workers/src/stats-refresh.ts";
import type { PokerNowLogEntry, ReconstructedHand, TrackerEventEnvelope } from "../packages/shared/src/types.ts";

interface ImportOptions {
  guildId: string;
  tableId: string;
  csvPath: string;
  sourceUrl: string;
  chunkSize?: number;
}

const options = parseArgs(process.argv.slice(2));
console.log(`Reading PokerNow CSV from ${options.csvPath}`);
const csv = await readFile(options.csvPath, "utf8");
const entries = parsePokerNowCsv(csv);
console.log(`Parsed ${entries.length} log entries from CSV`);
const hands = parsePokerNowHandsFromLogs(options.tableId, entries);
console.log(`Parsed ${hands.length} hands for table ${options.tableId}`);

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
console.log(`Persisting raw CSV event for tracking session ${session.id}`);
await persistRawEvent(session.id, rawEvent);

let insertedHands = 0;
let updatedHands = 0;
const existingHandIds = new Set(
  (
    await prisma.hand.findMany({
      where: {
        id: {
          in: hands.map((hand) => hand.handId),
        },
      },
      select: {
        id: true,
      },
    })
  ).map((hand) => hand.id),
);

const aliasOwnerMap = await buildAliasOwnerMap(options.guildId, trackedTable.id, hands);
const importStartedAt = Date.now();
const chunkSize = options.chunkSize ?? hands.length;
for (let start = 0; start < hands.length; start += chunkSize) {
  const handChunk = hands.slice(start, start + chunkSize);
  const chunkStartedAt = Date.now();
  await replaceHands(session.id, handChunk, aliasOwnerMap);

  for (const hand of handChunk) {
    if (existingHandIds.has(hand.handId)) {
      updatedHands += 1;
    } else {
      insertedHands += 1;
    }
  }

  const imported = Math.min(start + handChunk.length, hands.length);
  const elapsedSeconds = ((Date.now() - importStartedAt) / 1000).toFixed(1);
  const chunkSeconds = ((Date.now() - chunkStartedAt) / 1000).toFixed(1);
  console.log(`Imported ${imported}/${hands.length} hands (${elapsedSeconds}s elapsed, last chunk ${chunkSeconds}s)`);
}

console.log(`Refreshing stats for guild ${options.guildId}`);
await refreshStatsForGuild(options.guildId);
console.log("Stats refresh complete");

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

async function buildAliasOwnerMap(guildId: string, trackedTableId: string, handsToImport: ReconstructedHand[]) {
  const aliases = [
    ...handsToImport.flatMap((hand) => hand.players.map((player) => player.playerAlias)),
    ...handsToImport.flatMap((hand) => hand.actions.map((action) => action.playerAlias)),
  ];
  const normalizedAliases = [...new Set(aliases.map((alias) => normalizePokerNowAlias(alias)))];

  const [overrides, defaultAliases] = await Promise.all([
    prisma.trackedTablePlayerOverride.findMany({
      where: {
        trackedTableId,
        normalizedAlias: { in: normalizedAliases },
      },
      select: {
        normalizedAlias: true,
        playerProfileId: true,
      },
    }),
    prisma.playerAlias.findMany({
      where: {
        guildId,
        normalizedAlias: { in: normalizedAliases },
      },
      select: {
        normalizedAlias: true,
        defaultPlayerProfileId: true,
      },
    }),
  ]);

  const overrideMap = new Map(overrides.map((entry) => [entry.normalizedAlias, entry.playerProfileId]));
  const defaultMap = new Map(defaultAliases.map((entry) => [entry.normalizedAlias, entry.defaultPlayerProfileId]));

  return new Map([...new Set(aliases)].map((alias) => [alias, resolveAliasOwner(alias, overrideMap, defaultMap)]));
}

async function replaceHands(trackingSessionId: string, handsToImport: ReconstructedHand[], aliasOwnerMap: ReadonlyMap<string, string | null>) {
  const handIds = handsToImport.map((hand) => hand.handId);

  await prisma.$transaction([
    prisma.hand.deleteMany({
      where: {
        id: {
          in: handIds,
        },
      },
    }),
    prisma.hand.createMany({
      data: handsToImport.map((hand) => ({
        id: hand.handId,
        trackingSessionId,
        tableId: hand.tableId,
        gameType: hand.gameType,
        handedness: hand.handedness,
        startedAt: new Date(hand.startedAt),
        finishedAt: new Date(hand.finishedAt),
        buttonSeat: hand.buttonSeat,
        smallBlindAlias: hand.smallBlindAlias,
        bigBlindAlias: hand.bigBlindAlias,
        smallBlindAmount: hand.smallBlindAmount,
        bigBlindAmount: hand.bigBlindAmount,
        anteAmount: hand.anteAmount,
        boardCards: hand.boardCards,
        winners: hand.winners,
        potSize: hand.potSize,
        rawJson: hand as unknown as Prisma.InputJsonValue,
      })),
    }),
    prisma.handPlayer.createMany({
      data: handsToImport.flatMap((hand) =>
        hand.players.map((player) => ({
          handId: hand.handId,
          playerProfileId: aliasOwnerMap.get(player.playerAlias) ?? null,
          playerAlias: player.playerAlias,
          seat: player.seat,
          position: player.position,
          stackStart: player.stackStart,
          stackEnd: player.stackEnd,
          vpip: player.vpip,
          pfr: player.pfr,
          profit: player.profit,
        })),
      ),
    }),
    prisma.handAction.createMany({
      data: handsToImport.flatMap((hand) =>
        hand.actions.map((action) => ({
          handId: hand.handId,
          playerProfileId: aliasOwnerMap.get(action.playerAlias) ?? null,
          playerAlias: action.playerAlias,
          street: action.street,
          actionType: action.actionType,
          amount: action.amount,
          sequence: action.sequence,
          occurredAt: new Date(action.occurredAt),
        })),
      ),
    }),
  ]);
}

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
    chunkSize: parseOptionalPositiveInteger(values.get("chunk-size") ?? values.get("chunkSize")),
  };
}

function parseOptionalPositiveInteger(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }

  return parsed;
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
