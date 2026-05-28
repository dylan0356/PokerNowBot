import "dotenv/config";
import { prisma } from "../packages/db/src/index.ts";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.ts";
import { persistHand } from "../apps/tracker/src/persistence.ts";
import { refreshStatsForGuild } from "../apps/workers/src/stats-refresh.ts";
import type { PokerNowLogEntry, ReconstructedHand } from "../packages/shared/src/types.ts";

interface RebuildOptions {
  guildId: string;
  tableId?: string;
  dryRun: boolean;
}

const options = parseArgs(process.argv.slice(2));
const beforeProfitTotal = await handProfitTotal(options.guildId, options.tableId);

const sessions = await prisma.trackingSession.findMany({
  where: {
    trackedTable: {
      guildId: options.guildId,
      ...(options.tableId ? { tableId: options.tableId } : {}),
    },
  },
  include: {
    trackedTable: true,
    rawEvents: {
      orderBy: {
        sequence: "asc",
      },
    },
    hands: {
      include: {
        players: true,
      },
      orderBy: {
        startedAt: "asc",
      },
    },
  },
  orderBy: {
    startedAt: "asc",
  },
});

let parsedHands = 0;
let rewrittenHands = 0;
let validationFailures = 0;
const changedHandIds = new Set<string>();

for (const session of sessions) {
  const entries = entriesForSession(session);
  if (entries.length === 0) {
    continue;
  }

  const parsed = dedupeHands(parsePokerNowHandsFromLogs(session.trackedTable.tableId, entries));
  parsedHands += parsed.length;

  for (const hand of parsed) {
    const profitTotal = roundMoney(hand.players.reduce((sum, player) => sum + player.profit, 0));
    if (profitTotal !== 0) {
      validationFailures += 1;
    }

    const existing = session.hands.find((row) => row.id === hand.handId);
    if (!existing || handChanged(existing, hand)) {
      changedHandIds.add(hand.handId);
    }

    if (!options.dryRun) {
      await persistHand(session.id, hand);
      rewrittenHands += 1;
    }
  }
}

if (!options.dryRun) {
  await refreshStatsForGuild(options.guildId);
}

const afterProfitTotal = options.dryRun ? beforeProfitTotal : await handProfitTotal(options.guildId, options.tableId);

console.log(
  JSON.stringify(
    {
      guildId: options.guildId,
      tableId: options.tableId ?? null,
      dryRun: options.dryRun,
      sessionsProcessed: sessions.length,
      parsedHands,
      changedHands: changedHandIds.size,
      rewrittenHands,
      validationFailures,
      beforeProfitTotal,
      afterProfitTotal,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();

function parseArgs(args: string[]): RebuildOptions {
  const values = new Map<string, string>();
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
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
    throw new Error("Usage: npm run rebuild:pokernow-hands -- --guild-id <discordGuildId> [--table-id <pokernowTableId>] [--dry-run]");
  }

  return {
    guildId,
    tableId: values.get("table-id") ?? values.get("tableId"),
    dryRun,
  };
}

function entriesForSession(session: (typeof sessions)[number]) {
  const rawEntries = session.rawEvents.flatMap((event) => {
    const payload = event.payload as { entries?: PokerNowLogEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
  });

  if (rawEntries.length > 0) {
    return rawEntries;
  }

  return session.hands.flatMap((hand) => {
    const raw = hand.rawJson as unknown as { sourceEntries?: PokerNowLogEntry[] };
    return Array.isArray(raw.sourceEntries) ? raw.sourceEntries : [];
  });
}

function dedupeHands(hands: ReconstructedHand[]) {
  const byId = new Map<string, ReconstructedHand>();
  for (const hand of hands) {
    byId.set(hand.handId, hand);
  }
  return [...byId.values()].sort((left, right) => (left.handNumber ?? 0) - (right.handNumber ?? 0));
}

function handChanged(existing: (typeof sessions)[number]["hands"][number], parsed: ReconstructedHand) {
  const existingProfit = roundMoney(existing.players.reduce((sum, player) => sum + Number(player.profit), 0));
  const parsedProfit = roundMoney(parsed.players.reduce((sum, player) => sum + player.profit, 0));
  if (existingProfit !== parsedProfit) {
    return true;
  }

  if (existing.players.length !== parsed.players.length) {
    return true;
  }

  if (existing.isBombPot !== (parsed.isBombPot ?? false)) {
    return true;
  }

  for (const player of parsed.players) {
    const existingPlayer = existing.players.find((entry) => entry.playerAlias === player.playerAlias);
    if (!existingPlayer || Number(existingPlayer.profit) !== player.profit || existingPlayer.vpip !== player.vpip || existingPlayer.pfr !== player.pfr) {
      return true;
    }
  }

  return false;
}

async function handProfitTotal(guildId: string, tableId?: string) {
  const rows = await prisma.handPlayer.findMany({
    where: {
      hand: {
        trackingSession: {
          trackedTable: {
            guildId,
            ...(tableId ? { tableId } : {}),
          },
        },
      },
    },
    select: {
      profit: true,
    },
  });

  return roundMoney(rows.reduce((sum, row) => sum + Number(row.profit), 0));
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}
