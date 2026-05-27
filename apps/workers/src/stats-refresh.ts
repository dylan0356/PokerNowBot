import { prisma } from "@pokernow/db";
import { calculateActionStats, deriveStatsDimensions, filterHandsForDimension } from "@pokernow/stats";
import type { ReconstructedHand } from "@pokernow/shared";
import type { HandednessBucket as PrismaHandednessBucket } from "@prisma/client";

export async function refreshStatsForGuild(guildId: string) {
  const profiles = await prisma.playerProfile.findMany({
    where: { guildId },
  });

  const hands = await prisma.hand.findMany({
    where: {
      trackingSession: {
        trackedTable: {
          guildId,
        },
      },
    },
    include: {
      players: true,
      actions: true,
    },
  });

  const reconstructedHands = hands.map((hand: (typeof hands)[number]) => ({
    ...(hand.rawJson as unknown as ReconstructedHand),
    gameType: hand.gameType ?? undefined,
    handedness: hand.handedness ?? undefined,
  }));

  const dimensions = deriveStatsDimensions(reconstructedHands);

  for (const profile of profiles) {
    const snapshotRows = dimensions.map((dimension) => {
      const dimensionHandIds = new Set(filterHandsForDimension(reconstructedHands, dimension).map((hand) => hand.handId));
      const relevantEntries = hands.flatMap((hand) =>
        dimensionHandIds.has(hand.id)
          ? hand.players
              .filter((player) => player.playerProfileId === profile.id)
              .map((player) => ({
                vpip: player.vpip,
                pfr: player.pfr,
                profit: Number(player.profit),
                bigBlindAmount: hand.bigBlindAmount ? Number(hand.bigBlindAmount) : undefined,
                playerProfileId: profile.id,
                playerAlias: player.playerAlias,
                actions: hand.actions,
              }))
          : [],
      );
      const stats = calculateProfileStats(relevantEntries);

      return {
        guildId,
        playerProfileId: profile.id,
        scope: dimension.scope,
        gameType: dimension.gameType ?? null,
        handednessBucket: (dimension.handednessBucket as PrismaHandednessBucket | undefined) ?? null,
        dimensionKey: dimension.dimensionKey,
        handsPlayed: stats.handsPlayed,
        vpip: stats.vpip,
        pfr: stats.pfr,
        threeBet: stats.threeBet,
        fourBet: stats.fourBet,
        cbet: stats.cbet,
        foldToCbet: stats.foldToCbet,
        profitTotal: stats.profitTotal,
        profitTotalBb: stats.profitTotalBb,
        bbPerHundred: stats.bbPerHundred,
        biggestPotWon: stats.biggestPotWon,
        biggestPotWonBb: stats.biggestPotWonBb,
        biggestPunt: stats.biggestPunt,
        biggestPuntBb: stats.biggestPuntBb,
      };
    });

    await prisma.$transaction([
      prisma.statsSnapshot.deleteMany({
        where: {
          guildId,
          playerProfileId: profile.id,
        },
      }),
      prisma.statsSnapshot.createMany({
        data: snapshotRows,
      }),
    ]);
  }
}

interface ProfileHandEntry {
  vpip: boolean;
  pfr: boolean;
  profit: number;
  bigBlindAmount?: number;
  playerProfileId: string;
  playerAlias: string;
  actions: Array<{
    playerProfileId: string | null;
    playerAlias: string;
    street: string;
    actionType: string;
    sequence: number;
  }>;
}

function calculateProfileStats(entries: ProfileHandEntry[]) {
  const handsPlayed = entries.length;
  const vpipCount = entries.filter((entry) => entry.vpip).length;
  const pfrCount = entries.filter((entry) => entry.pfr).length;
  const actionStats = calculateActionStats(
    entries.map((entry) => ({
      actions: entry.actions,
      actor: {
        playerProfileId: entry.playerProfileId,
        playerAlias: entry.playerAlias,
      },
    })),
  );
  const profitTotal = entries.reduce((sum, entry) => sum + entry.profit, 0);
  const profitTotalBbRaw = entries.reduce((sum, entry) => sum + toBigBlinds(entry.profit, entry.bigBlindAmount), 0);
  const biggestPotWon = Math.max(0, ...entries.map((entry) => Math.max(entry.profit, 0)));
  const biggestPotWonBb = Math.max(0, ...entries.map((entry) => Math.max(toBigBlinds(entry.profit, entry.bigBlindAmount), 0)));
  const biggestPunt = Math.min(0, ...entries.map((entry) => entry.profit));
  const biggestPuntBb = Math.min(0, ...entries.map((entry) => toBigBlinds(entry.profit, entry.bigBlindAmount)));

  return {
    handsPlayed,
    vpip: handsPlayed === 0 ? 0 : vpipCount / handsPlayed,
    pfr: handsPlayed === 0 ? 0 : pfrCount / handsPlayed,
    threeBet: rate(actionStats.threeBets, actionStats.threeBetOpportunities),
    fourBet: rate(actionStats.fourBets, actionStats.fourBetOpportunities),
    cbet: rate(actionStats.cbets, actionStats.cbetOpportunities),
    foldToCbet: rate(actionStats.foldsToCbet, actionStats.foldToCbetOpportunities),
    profitTotal,
    profitTotalBb: Number(profitTotalBbRaw.toFixed(2)),
    bbPerHundred: handsPlayed === 0 ? 0 : (profitTotalBbRaw / handsPlayed) * 100,
    biggestPotWon,
    biggestPotWonBb: Number(biggestPotWonBb.toFixed(2)),
    biggestPunt,
    biggestPuntBb: Number(biggestPuntBb.toFixed(2)),
  };
}

function rate(count: number, opportunities: number) {
  return opportunities === 0 ? 0 : count / opportunities;
}

function toBigBlinds(amount: number, bigBlindAmount: number | undefined) {
  const divisor = bigBlindAmount && bigBlindAmount > 0 ? bigBlindAmount : 1;
  return divisor > 0 ? amount / divisor : 0;
}
