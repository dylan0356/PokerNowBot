import type { PokerNowLogEntry, ReconstructedAction, ReconstructedHand, ReconstructedHandPlayer, Street } from "@pokernow/shared";

interface MutablePlayer extends ReconstructedHandPlayer {
  contribution: number;
}

interface MutableHand {
  handId: string;
  handNumber: number;
  tableId: string;
  gameType?: string;
  handedness?: number;
  startedAt: string;
  finishedAt?: string;
  dealerAlias?: string;
  buttonSeat?: number;
  smallBlindAlias?: string;
  bigBlindAlias?: string;
  smallBlindAmount?: number;
  bigBlindAmount?: number;
  anteAmount?: number;
  boardCards: string[];
  winners: string[];
  players: Map<string, MutablePlayer>;
  actions: ReconstructedAction[];
  sourceEntries: PokerNowLogEntry[];
  street: Street;
  streetCommitted: Map<string, number>;
  collectedFromPot: number;
  unmatchedEntries: PokerNowLogEntry[];
}

export function parsePokerNowHandsFromLogs(tableId: string, entries: PokerNowLogEntry[]): ReconstructedHand[] {
  const chronological = [...entries].sort((left, right) => Number(left.createdAt) - Number(right.createdAt));
  const hands: ReconstructedHand[] = [];
  let current: MutableHand | null = null;

  for (const entry of chronological) {
    const startMatch = entry.msg.match(/^-- starting hand #(\d+) \(id: ([^)]+)\)\s+(.+?)\s+\(dealer: "(.+)"\) --$/);
    if (startMatch) {
      current = {
        handId: startMatch[2],
        handNumber: Number(startMatch[1]),
        tableId,
        gameType: startMatch[3],
        startedAt: normalizeCreatedAt(entry.createdAt),
        dealerAlias: startMatch[4],
        boardCards: [],
        winners: [],
        players: new Map(),
        actions: [],
        sourceEntries: [entry],
        street: "preflop",
        streetCommitted: new Map(),
        collectedFromPot: 0,
        unmatchedEntries: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.sourceEntries.push(entry);

    if (entry.msg.startsWith("Player stacks: ")) {
      parsePlayerStacks(current, entry.msg);
      continue;
    }

    if (entry.msg.startsWith("Flop:")) {
      current.street = "flop";
      current.streetCommitted = new Map();
      current.boardCards = parseBoardCards(entry.msg);
      continue;
    }

    if (entry.msg.startsWith("Turn:")) {
      current.street = "turn";
      current.streetCommitted = new Map();
      current.boardCards = parseBoardCards(entry.msg);
      continue;
    }

    if (entry.msg.startsWith("River:")) {
      current.street = "river";
      current.streetCommitted = new Map();
      current.boardCards = parseBoardCards(entry.msg);
      continue;
    }

    if (
      parseAliasChange(current, entry) ||
      parseBlind(current, entry) ||
      parseAction(current, entry) ||
      parseUncalledBet(current, entry) ||
      parseWinner(current, entry) ||
      parseShow(current, entry)
    ) {
      continue;
    }

    const endMatch = entry.msg.match(/^-- ending hand #(\d+) --$/);
    if (endMatch) {
      current.finishedAt = normalizeCreatedAt(entry.createdAt);
      finalizeProfits(current);
      validateHand(current);
      hands.push(toReconstructedHand(current));
      current = null;
      continue;
    }

    if (!isKnownInformationalMessage(entry.msg)) {
      current.unmatchedEntries.push(entry);
    }
  }

  return hands;
}

function parsePlayerStacks(hand: MutableHand, message: string) {
  const body = message.replace(/^Player stacks:\s*/, "");
  let handedness = 0;
  for (const segment of body.split(" | ")) {
    const match = segment.match(/^#(\d+) "(.+)" \(([\d.]+)\)$/);
    if (!match) {
      continue;
    }
    handedness += 1;

    const seat = Number(match[1]);
    const alias = match[2];
    const stackStart = Number(match[3]);
    const existing = hand.players.get(alias);

    hand.players.set(alias, {
      playerAlias: alias,
      seat,
      position: alias === hand.dealerAlias ? "BTN" : existing?.position,
      stackStart,
      stackEnd: existing?.stackEnd,
      vpip: existing?.vpip ?? false,
      pfr: existing?.pfr ?? false,
      profit: existing?.profit ?? 0,
      contribution: existing?.contribution ?? 0,
    });

    if (alias === hand.dealerAlias) {
      hand.buttonSeat = seat;
    }
  }

  if (handedness > 0) {
    hand.handedness = handedness;
  }
}

function parseBlind(hand: MutableHand, entry: PokerNowLogEntry) {
  const match = entry.msg.trim().match(/^"(.+)" posts a (?:(missing|missed) )?(small|big) blind of ([\d.]+)(?: and go all in)?$/);
  if (!match) {
    return false;
  }

  const alias = match[1];
  const blindModifier = match[2];
  const blindType = match[3];
  const amount = Number(match[4]);
  const player = hand.players.get(alias) ?? seedPlayer(alias);
  player.contribution += amount;
  hand.players.set(alias, player);
  if (blindModifier !== "missing") {
    hand.streetCommitted.set(alias, (hand.streetCommitted.get(alias) ?? 0) + amount);
  }

  if (!blindModifier && blindType === "small") {
    hand.smallBlindAlias = alias;
    hand.smallBlindAmount = amount;
  } else if (!blindModifier) {
    hand.bigBlindAlias = alias;
    hand.bigBlindAmount = amount;
  }

  hand.actions.push({
    sequence: hand.actions.length + 1,
    street: "preflop",
    playerAlias: alias,
    actionType: "post_blind",
    amount,
    occurredAt: normalizeCreatedAt(entry.createdAt),
  });

  return true;
}

function parseAliasChange(hand: MutableHand, entry: PokerNowLogEntry) {
  const match = entry.msg.match(/^The player "(.+)" changed the ID from (\S+) to (\S+) because authenticated login\.$/);
  if (!match) {
    return false;
  }

  const newAlias = match[1];
  const oldId = match[2];
  const oldAlias = [...hand.players.keys()].find((alias) => alias.endsWith(`@ ${oldId}`));
  if (!oldAlias || oldAlias === newAlias) {
    return true;
  }

  const oldPlayer = hand.players.get(oldAlias);
  if (!oldPlayer) {
    return true;
  }

  const existingNewPlayer = hand.players.get(newAlias);
  hand.players.set(newAlias, {
    ...oldPlayer,
    ...existingNewPlayer,
    playerAlias: newAlias,
    seat: existingNewPlayer?.seat ?? oldPlayer.seat,
    position: existingNewPlayer?.position ?? oldPlayer.position,
    stackStart: existingNewPlayer?.stackStart ?? oldPlayer.stackStart,
    stackEnd: existingNewPlayer?.stackEnd ?? oldPlayer.stackEnd,
    vpip: oldPlayer.vpip || existingNewPlayer?.vpip || false,
    pfr: oldPlayer.pfr || existingNewPlayer?.pfr || false,
    profit: roundMoney(oldPlayer.profit + (existingNewPlayer?.profit ?? 0)),
    contribution: roundMoney(oldPlayer.contribution + (existingNewPlayer?.contribution ?? 0)),
  });
  hand.players.delete(oldAlias);

  const oldCommitted = hand.streetCommitted.get(oldAlias) ?? 0;
  if (oldCommitted > 0) {
    hand.streetCommitted.set(newAlias, roundMoney((hand.streetCommitted.get(newAlias) ?? 0) + oldCommitted));
    hand.streetCommitted.delete(oldAlias);
  }

  hand.actions = hand.actions.map((action) => (action.playerAlias === oldAlias ? { ...action, playerAlias: newAlias } : action));
  hand.winners = hand.winners.map((winner) => (winner === oldAlias ? newAlias : winner));

  if (hand.dealerAlias === oldAlias) {
    hand.dealerAlias = newAlias;
  }
  if (hand.smallBlindAlias === oldAlias) {
    hand.smallBlindAlias = newAlias;
  }
  if (hand.bigBlindAlias === oldAlias) {
    hand.bigBlindAlias = newAlias;
  }

  return true;
}

function parseAction(hand: MutableHand, entry: PokerNowLogEntry) {
  const passiveMatch = entry.msg.match(/^"(.+)" (checks|folds)$/);
  if (passiveMatch) {
    hand.actions.push({
      sequence: hand.actions.length + 1,
      street: hand.street,
      playerAlias: passiveMatch[1],
      actionType: passiveMatch[2] === "folds" ? "fold" : "check",
      occurredAt: normalizeCreatedAt(entry.createdAt),
    });
    return true;
  }

  const amountMatch = entry.msg.match(/^"(.+)" (calls|bets|raises to) ([\d.]+)(?: and go all in)?$/);
  if (!amountMatch) {
    return false;
  }

  const alias = amountMatch[1];
  const verb = amountMatch[2];
  const amount = Number(amountMatch[3]);
  const player = hand.players.get(alias) ?? seedPlayer(alias);
  const currentStreetAmount = hand.streetCommitted.get(alias) ?? 0;
  const committed = Math.max(amount - currentStreetAmount, 0);

  player.contribution += committed;
  if (hand.street === "preflop" && (verb === "calls" || verb === "bets" || verb === "raises to")) {
    player.vpip = true;
  }
  if (hand.street === "preflop" && (verb === "bets" || verb === "raises to")) {
    player.pfr = true;
  }
  hand.players.set(alias, player);
  hand.streetCommitted.set(alias, amount);
  hand.actions.push({
    sequence: hand.actions.length + 1,
    street: hand.street,
    playerAlias: alias,
    actionType: verb === "raises to" ? "raise" : (verb.slice(0, -1) as ReconstructedAction["actionType"]),
    amount: committed,
    occurredAt: normalizeCreatedAt(entry.createdAt),
  });

  return true;
}

function parseWinner(hand: MutableHand, entry: PokerNowLogEntry) {
  const match = entry.msg.match(/^"(.+)" collected ([\d.]+) from pot/);
  if (!match) {
    return false;
  }

  const alias = match[1];
  const collected = Number(match[2]);
  const player = hand.players.get(alias) ?? seedPlayer(alias);
  player.profit += collected;
  hand.collectedFromPot += collected;
  hand.players.set(alias, player);
  if (!hand.winners.includes(alias)) {
    hand.winners.push(alias);
  }

  return true;
}

function parseUncalledBet(hand: MutableHand, entry: PokerNowLogEntry) {
  const match = entry.msg.match(/^Uncalled bet of ([\d.]+) returned to "(.+)"$/);
  if (!match) {
    return false;
  }

  const amount = Number(match[1]);
  const alias = match[2];
  const player = hand.players.get(alias) ?? seedPlayer(alias);
  player.contribution = Math.max(0, Number((player.contribution - amount).toFixed(2)));
  hand.players.set(alias, player);

  const currentStreetAmount = hand.streetCommitted.get(alias) ?? 0;
  hand.streetCommitted.set(alias, Math.max(0, Number((currentStreetAmount - amount).toFixed(2))));
  return true;
}

function parseShow(hand: MutableHand, entry: PokerNowLogEntry) {
  const match = entry.msg.match(/^"(.+)" shows a (.+)\.$/);
  if (!match) {
    return false;
  }

  hand.actions.push({
    sequence: hand.actions.length + 1,
    street: "showdown",
    playerAlias: match[1],
    actionType: "check",
    occurredAt: normalizeCreatedAt(entry.createdAt),
  });
  return true;
}

function finalizeProfits(hand: MutableHand) {
  for (const player of hand.players.values()) {
    player.profit = Number((player.profit - player.contribution).toFixed(2));
    if (player.stackStart !== undefined) {
      player.stackEnd = Number((player.stackStart + player.profit).toFixed(2));
    }
  }
}

function validateHand(hand: MutableHand) {
  const totalProfit = roundMoney([...hand.players.values()].reduce((sum, player) => sum + player.profit, 0));
  const totalContribution = roundMoney([...hand.players.values()].reduce((sum, player) => sum + player.contribution, 0));
  const totalCollected = roundMoney(hand.collectedFromPot);

  if (totalProfit === 0 && totalContribution === totalCollected && hand.unmatchedEntries.length === 0) {
    return;
  }

  const diagnostics = {
    tableId: hand.tableId,
    handId: hand.handId,
    handNumber: hand.handNumber,
    totalProfit,
    totalContribution,
    totalCollected,
    players: [...hand.players.values()].map((player) => ({
      alias: player.playerAlias,
      contribution: roundMoney(player.contribution),
      profit: roundMoney(player.profit),
      stackStart: player.stackStart,
      stackEnd: player.stackEnd,
    })),
    actions: hand.actions.map((action) => ({
      sequence: action.sequence,
      street: action.street,
      playerAlias: action.playerAlias,
      actionType: action.actionType,
      amount: action.amount,
    })),
    unmatchedEntries: hand.unmatchedEntries.map((entry) => entry.msg),
  };

  console.warn(`PokerNow hand parse validation warning: ${JSON.stringify(diagnostics)}`);
}

function toReconstructedHand(hand: MutableHand): ReconstructedHand {
  return {
    handId: hand.handId,
    handNumber: hand.handNumber,
    tableId: hand.tableId,
    gameType: hand.gameType,
    handedness: hand.handedness ?? hand.players.size,
    startedAt: hand.startedAt,
    finishedAt: hand.finishedAt ?? hand.startedAt,
    buttonSeat: hand.buttonSeat,
    smallBlindAlias: hand.smallBlindAlias,
    bigBlindAlias: hand.bigBlindAlias,
    smallBlindAmount: hand.smallBlindAmount,
    bigBlindAmount: hand.bigBlindAmount,
    anteAmount: hand.anteAmount,
    boardCards: hand.boardCards,
    winners: hand.winners,
    potSize: Number(hand.collectedFromPot.toFixed(2)),
    players: [...hand.players.values()].map((player) => ({
      playerAlias: player.playerAlias,
      seat: player.seat,
      position: player.position,
      stackStart: player.stackStart,
      stackEnd: player.stackEnd,
      vpip: player.vpip,
      pfr: player.pfr,
      profit: player.profit,
    })),
    actions: hand.actions,
    rawEvents: [],
    sourceEntries: hand.sourceEntries,
  };
}

function seedPlayer(alias: string): MutablePlayer {
  return {
    playerAlias: alias,
    vpip: false,
    pfr: false,
    profit: 0,
    contribution: 0,
  };
}

function parseBoardCards(message: string) {
  return [...message.matchAll(/[2-9TJQKA10]+[♠♥♦♣]/g)].map((match) => match[0].replace("10", "T"));
}

function normalizeCreatedAt(createdAt: string) {
  // PokerNow log_v3 timestamps are 100x epoch milliseconds, not microseconds.
  const scaledEpoch = BigInt(createdAt);
  return new Date(Number(scaledEpoch / 100n)).toISOString();
}

function isKnownInformationalMessage(message: string) {
  return (
    message.startsWith("Remaining players decide whether to run it twice.") ||
    message.startsWith("All players in hand choose to run it twice.") ||
    message.startsWith("Some players choose to not run it twice.") ||
    message === "Dead Small Blind" ||
    message === "Dead Big Blind" ||
    /^Your hand is .+$/.test(message) ||
    /^The player ".+" joined the game with a stack of [\d.]+\.$/.test(message) ||
    /^The player ".+" requested a seat\.$/.test(message) ||
    /^The player ".+" sit back with the stack of [\d.]+\.$/.test(message) ||
    /^The player ".+" stand up with the stack of [\d.]+\.$/.test(message) ||
    /^The admin approved the player ".+" participation with a stack of [\d.]+\.?$/.test(message) ||
    /^The admin ".+" rejected the seat request from the player ".+"\.$/.test(message) ||
    /^The admin ".+" forced the player ".+" to away mode in the next hand\.$/.test(message) ||
    /^The admin ".+" enqueued the removal of the player ".+"\.$/.test(message) ||
    /^The player ".+" passed the room ownership to ".+"\.$/.test(message) ||
    /^WARNING: the admin queued the stack change for the player ".+" adding [\d.]+ chips in the next hand\.$/.test(message) ||
    message.startsWith("Flop (second run):") ||
    message.startsWith("Turn (second run):") ||
    message.startsWith("River (second run):") ||
    /^".+" chooses to\s+(?:not )?run it twice\.$/.test(message)
  );
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}
