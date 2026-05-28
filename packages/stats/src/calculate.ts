import type { HandednessBucket, PlayerStats, ReconstructedHand, StatsDimension } from "@pokernow/shared";

export interface StatsAccumulatorInput {
  playerAlias?: string;
  playerAliases?: string[];
  hands: ReconstructedHand[];
  defaultBigBlind: number;
}

export function calculatePlayerStats(input: StatsAccumulatorInput): PlayerStats {
  const aliasSet = new Set(input.playerAliases ?? (input.playerAlias ? [input.playerAlias] : []));
  const relevantHands = input.hands
    .map((hand) => ({
      hand,
      player: hand.players.find((player) => aliasSet.has(player.playerAlias)),
    }))
    .filter((entry): entry is { hand: ReconstructedHand; player: NonNullable<(typeof entry)["player"]> } => Boolean(entry.player));

  const handsPlayed = relevantHands.length;
  const rateHands = relevantHands.filter((entry) => !entry.hand.isBombPot);
  const vpipCount = rateHands.filter((entry) => entry.player.vpip).length;
  const pfrCount = rateHands.filter((entry) => entry.player.pfr).length;
  const actionStats = calculateActionStats(
    rateHands.map((entry) => ({
      actions: entry.hand.actions,
      actor: { playerAlias: entry.player.playerAlias },
    })),
  );
  const profitTotal = relevantHands.reduce((sum, entry) => sum + entry.player.profit, 0);
  const profitTotalBb = relevantHands.reduce((sum, entry) => sum + toBigBlinds(entry.player.profit, entry.hand.bigBlindAmount, input.defaultBigBlind), 0);
  const biggestPotWon = Math.max(0, ...relevantHands.map((entry) => Math.max(entry.player.profit, 0)));
  const biggestPotWonBb = Math.max(
    0,
    ...relevantHands.map((entry) => Math.max(toBigBlinds(entry.player.profit, entry.hand.bigBlindAmount, input.defaultBigBlind), 0)),
  );
  const biggestPunt = Math.min(0, ...relevantHands.map((entry) => entry.player.profit));
  const biggestPuntBb = Math.min(
    0,
    ...relevantHands.map((entry) => toBigBlinds(entry.player.profit, entry.hand.bigBlindAmount, input.defaultBigBlind)),
  );

  return {
    handsPlayed,
    vpip: rateHands.length === 0 ? 0 : vpipCount / rateHands.length,
    pfr: rateHands.length === 0 ? 0 : pfrCount / rateHands.length,
    threeBet: rate(actionStats.threeBets, actionStats.threeBetOpportunities),
    fourBet: rate(actionStats.fourBets, actionStats.fourBetOpportunities),
    cbet: rate(actionStats.cbets, actionStats.cbetOpportunities),
    foldToCbet: rate(actionStats.foldsToCbet, actionStats.foldToCbetOpportunities),
    profitTotal,
    profitTotalBb: Number(profitTotalBb.toFixed(2)),
    bbPerHundred: handsPlayed === 0 ? 0 : (profitTotalBb / handsPlayed) * 100,
    biggestPotWon,
    biggestPotWonBb: Number(biggestPotWonBb.toFixed(2)),
    biggestPunt,
    biggestPuntBb: Number(biggestPuntBb.toFixed(2)),
  };
}

interface ActionStatsInput {
  actions: StatAction[];
  actor: StatActor;
}

export interface StatActor {
  playerProfileId?: string | null;
  playerAlias: string;
}

export interface StatAction {
  playerProfileId?: string | null;
  playerAlias: string;
  street: string;
  actionType: string;
  sequence: number;
  amount?: number | null;
  occurredAt?: string | Date;
}

export function calculateActionStats(entries: ActionStatsInput[]) {
  return entries.reduce(
    (totals, entry) => {
      const stats = calculateHandActionStats(entry.actions, entry.actor);
      totals.threeBetOpportunities += stats.threeBetOpportunity ? 1 : 0;
      totals.threeBets += stats.threeBet ? 1 : 0;
      totals.fourBetOpportunities += stats.fourBetOpportunity ? 1 : 0;
      totals.fourBets += stats.fourBet ? 1 : 0;
      totals.cbetOpportunities += stats.cbetOpportunity ? 1 : 0;
      totals.cbets += stats.cbet ? 1 : 0;
      totals.foldToCbetOpportunities += stats.foldToCbetOpportunity ? 1 : 0;
      totals.foldsToCbet += stats.foldToCbet ? 1 : 0;
      return totals;
    },
    {
      threeBetOpportunities: 0,
      threeBets: 0,
      fourBetOpportunities: 0,
      fourBets: 0,
      cbetOpportunities: 0,
      cbets: 0,
      foldToCbetOpportunities: 0,
      foldsToCbet: 0,
    },
  );
}

export function calculateHandActionStats(actions: StatAction[], actor: StatActor) {
  const preflopActions = actions.filter((action) => action.street === "preflop").sort((left, right) => left.sequence - right.sequence);
  const preflopRaises = preflopActions.filter((action) => action.actionType === "raise" || action.actionType === "bet");
  const secondRaise = preflopRaises[1];
  const thirdRaise = preflopRaises[2];

  const threeBetOpportunity = hasActionAfter(preflopActions, actor, preflopRaises[0]?.sequence, secondRaise?.sequence);
  const fourBetOpportunity = hasActionAfter(preflopActions, actor, secondRaise?.sequence, thirdRaise?.sequence);

  const flopActions = actions.filter((action) => action.street === "flop").sort((left, right) => left.sequence - right.sequence);
  const preflopAggressor = preflopRaises.at(-1);
  const firstFlopAggression = flopActions.find((action) => action.actionType === "bet" || action.actionType === "raise");
  const playerFirstFlopAction = flopActions.find((action) => isActorAction(actor, action));
  const cbetOpportunity =
    Boolean(preflopAggressor) &&
    isActorAction(actor, preflopAggressor!) &&
    Boolean(playerFirstFlopAction) &&
    (!firstFlopAggression || playerFirstFlopAction!.sequence <= firstFlopAggression.sequence);
  const cbet = cbetOpportunity && Boolean(firstFlopAggression) && isActorAction(actor, firstFlopAggression!);

  const foldToCbetOpportunity =
    Boolean(firstFlopAggression) &&
    Boolean(preflopAggressor) &&
    sameActor(firstFlopAggression!, preflopAggressor!) &&
    !isActorAction(actor, preflopAggressor!) &&
    Boolean(flopActions.find((action) => isActorAction(actor, action) && action.sequence > firstFlopAggression!.sequence));
  const foldToCbet =
    foldToCbetOpportunity &&
    flopActions.find((action) => isActorAction(actor, action) && action.sequence > firstFlopAggression!.sequence)?.actionType === "fold";

  return {
    threeBetOpportunity,
    threeBet: secondRaise ? isActorAction(actor, secondRaise) : false,
    fourBetOpportunity,
    fourBet: thirdRaise ? isActorAction(actor, thirdRaise) : false,
    cbetOpportunity,
    cbet,
    foldToCbetOpportunity,
    foldToCbet,
  };
}

function hasActionAfter(actions: StatAction[], actor: StatActor, afterSequence: number | undefined, beforeSequence: number | undefined) {
  if (afterSequence === undefined) {
    return false;
  }

  return actions.some(
    (action) =>
      isActorAction(actor, action) &&
      action.sequence > afterSequence &&
      (beforeSequence === undefined || action.sequence <= beforeSequence),
  );
}

function isActorAction(actor: StatActor, action: StatAction) {
  return actor.playerProfileId && action.playerProfileId
    ? actor.playerProfileId === action.playerProfileId
    : actor.playerAlias === action.playerAlias;
}

function sameActor(left: StatAction, right: StatAction) {
  return left.playerProfileId && right.playerProfileId ? left.playerProfileId === right.playerProfileId : left.playerAlias === right.playerAlias;
}

function rate(count: number, opportunities: number) {
  return opportunities === 0 ? 0 : count / opportunities;
}

export function deriveStatsDimensions(hands: ReconstructedHand[]): StatsDimension[] {
  const dimensions = new Map<string, StatsDimension>();
  dimensions.set("overall", { scope: "OVERALL", dimensionKey: "overall" });

  for (const hand of hands) {
    if (hand.gameType) {
      const dimensionKey = `gameType:${hand.gameType}`;
      dimensions.set(dimensionKey, {
        scope: "BY_GAME_TYPE",
        gameType: hand.gameType,
        dimensionKey,
      });
    }

    const handednessBucket = toHandednessBucket(hand.handedness);
    const broadHandednessBucket = toBroadHandednessBucket(hand.handedness);
    if (handednessBucket) {
      const dimensionKey = `handedness:${handednessBucket}`;
      dimensions.set(dimensionKey, {
        scope: "BY_HANDEDNESS",
        handednessBucket,
        dimensionKey,
      });
    }

    if (broadHandednessBucket) {
      const dimensionKey = `handedness:${broadHandednessBucket}`;
      dimensions.set(dimensionKey, {
        scope: "BY_HANDEDNESS",
        handednessBucket: broadHandednessBucket,
        dimensionKey,
      });
    }

    if (hand.gameType && handednessBucket) {
      const dimensionKey = `gameType:${hand.gameType}|handedness:${handednessBucket}`;
      dimensions.set(dimensionKey, {
        scope: "BY_GAME_TYPE_HANDEDNESS",
        gameType: hand.gameType,
        handednessBucket,
        dimensionKey,
      });
    }

    if (hand.gameType && broadHandednessBucket) {
      const dimensionKey = `gameType:${hand.gameType}|handedness:${broadHandednessBucket}`;
      dimensions.set(dimensionKey, {
        scope: "BY_GAME_TYPE_HANDEDNESS",
        gameType: hand.gameType,
        handednessBucket: broadHandednessBucket,
        dimensionKey,
      });
    }
  }

  return [...dimensions.values()];
}

export function filterHandsForDimension(hands: ReconstructedHand[], dimension: StatsDimension) {
  return hands.filter((hand) => matchesDimension(hand, dimension));
}

export function toHandednessBucket(handedness: number | undefined): HandednessBucket | undefined {
  if (!handedness || handedness < 2) {
    return undefined;
  }

  if (handedness === 2) {
    return "HEADS_UP";
  }
  if (handedness === 3) {
    return "THREE_HANDED";
  }
  if (handedness === 4) {
    return "FOUR_HANDED";
  }
  if (handedness === 5) {
    return "FIVE_HANDED";
  }
  return "SIX_PLUS";
}

export function toBroadHandednessBucket(handedness: number | undefined): HandednessBucket | undefined {
  if (!handedness || handedness < 2) {
    return undefined;
  }

  return handedness === 2 ? "HEADS_UP" : "MULTIWAY";
}

function toBigBlinds(amount: number, bigBlindAmount: number | undefined, defaultBigBlind: number) {
  const divisor = bigBlindAmount && bigBlindAmount > 0 ? bigBlindAmount : defaultBigBlind;
  return divisor > 0 ? amount / divisor : 0;
}

function matchesDimension(hand: ReconstructedHand, dimension: StatsDimension) {
  switch (dimension.scope) {
    case "OVERALL":
      return true;
    case "BY_GAME_TYPE":
      return hand.gameType === dimension.gameType;
    case "BY_HANDEDNESS":
      return dimension.handednessBucket === "MULTIWAY"
        ? toBroadHandednessBucket(hand.handedness) === dimension.handednessBucket
        : toHandednessBucket(hand.handedness) === dimension.handednessBucket;
    case "BY_GAME_TYPE_HANDEDNESS":
      return (
        hand.gameType === dimension.gameType &&
        (dimension.handednessBucket === "MULTIWAY"
          ? toBroadHandednessBucket(hand.handedness) === dimension.handednessBucket
          : toHandednessBucket(hand.handedness) === dimension.handednessBucket)
      );
  }
}
