import { prisma } from "@pokernow/db";

export async function createMonthlySnapshot(guildId: string, year: number, month: number) {
  const snapshots = await prisma.statsSnapshot.findMany({
    where: { guildId },
  });

  for (const snapshot of snapshots) {
    await prisma.monthlyPlayerSnapshot.upsert({
      where: {
        guildId_playerProfileId_year_month_dimensionKey: {
          guildId,
          playerProfileId: snapshot.playerProfileId,
          year,
          month,
          dimensionKey: snapshot.dimensionKey,
        },
      },
      update: {
        scope: snapshot.scope,
        gameType: snapshot.gameType,
        handednessBucket: snapshot.handednessBucket,
        dimensionKey: snapshot.dimensionKey,
        handsPlayed: snapshot.handsPlayed,
        vpip: snapshot.vpip,
        pfr: snapshot.pfr,
        threeBet: snapshot.threeBet,
        fourBet: snapshot.fourBet,
        cbet: snapshot.cbet,
        foldToCbet: snapshot.foldToCbet,
        profitTotal: snapshot.profitTotal,
        profitTotalBb: snapshot.profitTotalBb,
        bbPerHundred: snapshot.bbPerHundred,
        biggestPotWon: snapshot.biggestPotWon,
        biggestPotWonBb: snapshot.biggestPotWonBb,
        biggestPunt: snapshot.biggestPunt,
        biggestPuntBb: snapshot.biggestPuntBb,
      },
      create: {
        guildId,
        playerProfileId: snapshot.playerProfileId,
        year,
        month,
        scope: snapshot.scope,
        gameType: snapshot.gameType,
        handednessBucket: snapshot.handednessBucket,
        dimensionKey: snapshot.dimensionKey,
        handsPlayed: snapshot.handsPlayed,
        vpip: snapshot.vpip,
        pfr: snapshot.pfr,
        threeBet: snapshot.threeBet,
        fourBet: snapshot.fourBet,
        cbet: snapshot.cbet,
        foldToCbet: snapshot.foldToCbet,
        profitTotal: Number(snapshot.profitTotal),
        profitTotalBb: snapshot.profitTotalBb,
        bbPerHundred: snapshot.bbPerHundred,
        biggestPotWon: Number(snapshot.biggestPotWon),
        biggestPotWonBb: snapshot.biggestPotWonBb,
        biggestPunt: Number(snapshot.biggestPunt),
        biggestPuntBb: snapshot.biggestPuntBb,
      },
    });
  }
}
