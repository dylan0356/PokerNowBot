import "dotenv/config";
import { prisma } from "../packages/db/src/index.ts";
import { fetchPokerNowLogEntries } from "../apps/tracker/src/pokernow/http.ts";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.ts";
import { persistHand } from "../apps/tracker/src/persistence.ts";

const tableId = process.argv[2] ?? "pglS-DecN6jYyfRVYhW2vcJvf";
const handNumbers = process.argv.slice(3).map(Number).filter(Number.isFinite);

if (handNumbers.length === 0) {
  throw new Error("Usage: node --import tsx scripts/verify-live-hands.ts <tableId> <handNumber> [handNumber...]");
}

const trackedTable = await prisma.trackedTable.findFirst({
  where: { tableId },
  include: {
    sessions: {
      orderBy: { startedAt: "desc" },
      take: 1,
    },
  },
});

if (!trackedTable || !trackedTable.sessions[0]) {
  throw new Error(`No tracking session found for table ${tableId}`);
}

for (const handNumber of handNumbers) {
  const entries = await fetchPokerNowLogEntries(
    process.env.POKERNOW_BASE_URL ?? "https://www.pokernow.com",
    tableId,
    handNumber,
    process.env.POKERNOW_COOKIE_HEADER,
  );
  const hands = parsePokerNowHandsFromLogs(tableId, entries);

  console.log(
    JSON.stringify(
      {
        handNumber,
        fetchedEntries: entries.length,
        parsedHands: hands.map((hand) => ({
          handId: hand.handId,
          handNumber: hand.handNumber,
          smallBlindAmount: hand.smallBlindAmount,
          bigBlindAmount: hand.bigBlindAmount,
          potSize: hand.potSize,
          winners: hand.winners,
          players: hand.players.map((player) => ({
            alias: player.playerAlias,
            profit: player.profit,
          })),
        })),
      },
      null,
      2,
    ),
  );

  for (const hand of hands) {
    await persistHand(trackedTable.sessions[0].id, hand);
  }
}

await prisma.$disconnect();
