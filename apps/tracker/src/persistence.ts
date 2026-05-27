import { Prisma } from "@prisma/client";
import { prisma, resolveAliasOwnersForTable } from "@pokernow/db";
import type { ReconstructedHand, TrackerEventEnvelope } from "@pokernow/shared";

export async function persistRawEvent(trackingSessionId: string, event: TrackerEventEnvelope) {
  await prisma.rawTableEvent.upsert({
    where: {
      trackingSessionId_sequence: {
        trackingSessionId,
        sequence: event.sequence,
      },
    },
    update: {
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      payload: event.payload as Prisma.InputJsonValue,
    },
    create: {
      trackingSessionId,
      tableId: event.tableId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}

export async function persistHand(trackingSessionId: string, hand: ReconstructedHand) {
  const trackingSession = await prisma.trackingSession.findUnique({
    where: { id: trackingSessionId },
    include: {
      trackedTable: {
        select: {
          id: true,
          guildId: true,
        },
      },
    },
  });

  if (!trackingSession) {
    throw new Error(`Tracking session ${trackingSessionId} not found`);
  }

  const aliases = [
    ...hand.players.map((player) => player.playerAlias),
    ...hand.actions.map((action) => action.playerAlias),
  ];
  const aliasOwners = await resolveAliasOwnersForTable(
    {
      guildId: trackingSession.trackedTable.guildId,
      trackedTableId: trackingSession.trackedTable.id,
    },
    aliases,
  );
  const aliasOwnerMap = new Map(aliasOwners.map((entry) => [entry.alias, entry.playerProfileId]));

  await prisma.$transaction([
    prisma.hand.upsert({
      where: { id: hand.handId },
      update: {
        gameType: hand.gameType,
        handedness: hand.handedness,
        startedAt: new Date(hand.startedAt),
        finishedAt: new Date(hand.finishedAt),
        buttonSeat: hand.buttonSeat,
        smallBlindAlias: hand.smallBlindAlias,
        bigBlindAlias: hand.bigBlindAlias,
        smallBlindAmount: decimalOrNull(hand.smallBlindAmount),
        bigBlindAmount: decimalOrNull(hand.bigBlindAmount),
        anteAmount: decimalOrNull(hand.anteAmount),
        boardCards: hand.boardCards,
        winners: hand.winners,
        potSize: hand.potSize,
        rawJson: hand as unknown as Prisma.InputJsonValue,
      },
      create: {
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
        smallBlindAmount: decimalOrNull(hand.smallBlindAmount),
        bigBlindAmount: decimalOrNull(hand.bigBlindAmount),
        anteAmount: decimalOrNull(hand.anteAmount),
        boardCards: hand.boardCards,
        winners: hand.winners,
        potSize: hand.potSize,
        rawJson: hand as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.handAction.deleteMany({ where: { handId: hand.handId } }),
    prisma.handPlayer.deleteMany({ where: { handId: hand.handId } }),
  ]);

  await prisma.handPlayer.createMany({
    data: hand.players.map((player) => ({
      handId: hand.handId,
      playerProfileId: aliasOwnerMap.get(player.playerAlias) ?? null,
      playerAlias: player.playerAlias,
      seat: player.seat,
      position: player.position,
      stackStart: decimalOrNull(player.stackStart),
      stackEnd: decimalOrNull(player.stackEnd),
      vpip: player.vpip,
      pfr: player.pfr,
      profit: player.profit,
    })),
  });

  await prisma.handAction.createMany({
    data: hand.actions.map((action) => ({
      handId: hand.handId,
      playerProfileId: aliasOwnerMap.get(action.playerAlias) ?? null,
      playerAlias: action.playerAlias,
      street: action.street,
      actionType: action.actionType,
      amount: decimalOrNull(action.amount),
      sequence: action.sequence,
      occurredAt: new Date(action.occurredAt),
    })),
  });
}

function decimalOrNull(value: number | undefined) {
  return value === undefined ? null : value;
}
