import test from "node:test";
import assert from "node:assert/strict";
import { calculateActionStats, calculatePlayerStats, deriveStatsDimensions, filterHandsForDimension, toHandednessBucket } from "@pokernow/stats";
import type { ReconstructedHand } from "@pokernow/shared";

test("calculatePlayerStats computes MVP metrics", () => {
  const hands: ReconstructedHand[] = [
    {
      handId: "1",
      tableId: "table",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bigBlindAmount: 2,
      boardCards: [],
      potSize: 10,
      winners: ["Dylan"],
      actions: [],
      rawEvents: [],
      players: [
        {
          playerAlias: "Dylan",
          vpip: true,
          pfr: true,
          profit: 6,
        },
      ],
    },
    {
      handId: "2",
      tableId: "table",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bigBlindAmount: 1,
      boardCards: [],
      potSize: 8,
      winners: ["Other"],
      actions: [],
      rawEvents: [],
      players: [
        {
          playerAlias: "Dylan",
          vpip: false,
          pfr: false,
          profit: -2,
        },
      ],
    },
  ];

  const stats = calculatePlayerStats({
    playerAlias: "Dylan",
    hands,
    defaultBigBlind: 1,
  });

  assert.equal(stats.handsPlayed, 2);
  assert.equal(stats.vpip, 0.5);
  assert.equal(stats.pfr, 0.5);
  assert.equal(stats.profitTotal, 4);
  assert.equal(stats.profitTotalBb, 1);
  assert.equal(stats.bbPerHundred, 50);
  assert.equal(stats.biggestPotWon, 6);
  assert.equal(stats.biggestPotWonBb, 3);
  assert.equal(stats.biggestPunt, -2);
  assert.equal(stats.biggestPuntBb, -2);
  assert.equal(stats.threeBet, 0);
  assert.equal(stats.fourBet, 0);
  assert.equal(stats.cbet, 0);
  assert.equal(stats.foldToCbet, 0);
});

test("calculatePlayerStats computes preflop and flop action rates", () => {
  const now = new Date().toISOString();
  const hands: ReconstructedHand[] = [
    {
      handId: "three-bet-cbet",
      tableId: "table",
      startedAt: now,
      finishedAt: now,
      boardCards: ["Ah", "Kd", "2c"],
      potSize: 20,
      winners: ["Dylan"],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: true, pfr: true, profit: 10 }],
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Other", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Dylan", actionType: "raise", amount: 9, occurredAt: now },
        { sequence: 3, street: "flop", playerAlias: "Dylan", actionType: "bet", amount: 8, occurredAt: now },
      ],
    },
    {
      handId: "call-fold-to-cbet",
      tableId: "table",
      startedAt: now,
      finishedAt: now,
      boardCards: ["Ah", "Kd", "2c"],
      potSize: 20,
      winners: ["Other"],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: true, pfr: false, profit: -5 }],
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Other", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Dylan", actionType: "call", amount: 3, occurredAt: now },
        { sequence: 3, street: "flop", playerAlias: "Other", actionType: "bet", amount: 5, occurredAt: now },
        { sequence: 4, street: "flop", playerAlias: "Dylan", actionType: "fold", occurredAt: now },
      ],
    },
    {
      handId: "four-bet",
      tableId: "table",
      startedAt: now,
      finishedAt: now,
      boardCards: [],
      potSize: 20,
      winners: ["Dylan"],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: true, pfr: true, profit: 7 }],
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Dylan", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Other", actionType: "raise", amount: 9, occurredAt: now },
        { sequence: 3, street: "preflop", playerAlias: "Dylan", actionType: "raise", amount: 24, occurredAt: now },
      ],
    },
  ];

  const stats = calculatePlayerStats({
    playerAlias: "Dylan",
    hands,
    defaultBigBlind: 1,
  });

  assert.equal(stats.threeBet, 0.5);
  assert.equal(stats.fourBet, 1);
  assert.equal(stats.cbet, 1);
  assert.equal(stats.foldToCbet, 1);
});

test("calculatePlayerStats includes bomb-pot profit and hands but excludes rate stats", () => {
  const now = new Date().toISOString();
  const hands: ReconstructedHand[] = [
    {
      handId: "normal-fold",
      tableId: "table",
      startedAt: now,
      finishedAt: now,
      bigBlindAmount: 1,
      boardCards: [],
      potSize: 3,
      winners: ["Other"],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: false, pfr: false, profit: -1 }],
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Other", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Dylan", actionType: "fold", occurredAt: now },
      ],
    },
    {
      handId: "bomb-pot",
      tableId: "table",
      startedAt: now,
      finishedAt: now,
      bigBlindAmount: 1,
      boardCards: [],
      isBombPot: true,
      potSize: 20,
      winners: ["Dylan"],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: true, pfr: true, profit: 10 }],
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Dylan", actionType: "bet", amount: 3, occurredAt: now },
        { sequence: 2, street: "flop", playerAlias: "Dylan", actionType: "bet", amount: 5, occurredAt: now },
      ],
    },
  ];

  const stats = calculatePlayerStats({
    playerAlias: "Dylan",
    hands,
    defaultBigBlind: 1,
  });

  assert.equal(stats.handsPlayed, 2);
  assert.equal(stats.profitTotal, 9);
  assert.equal(stats.profitTotalBb, 9);
  assert.equal(stats.biggestPotWon, 10);
  assert.equal(stats.biggestPunt, -1);
  assert.equal(stats.vpip, 0);
  assert.equal(stats.pfr, 0);
  assert.equal(stats.threeBet, 0);
  assert.equal(stats.cbet, 0);
});

test("deriveStatsDimensions includes game type and handedness splits", () => {
  const hands: ReconstructedHand[] = [
    {
      handId: "1",
      tableId: "table",
      handNumber: 1,
      gameType: "Pot Limit Omaha Hi",
      handedness: 2,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bigBlindAmount: 2,
      boardCards: [],
      potSize: 10,
      winners: ["Dylan"],
      actions: [],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: true, pfr: true, profit: 6 }],
    },
    {
      handId: "2",
      tableId: "table",
      handNumber: 2,
      gameType: "No Limit Hold'em",
      handedness: 4,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bigBlindAmount: 1,
      boardCards: [],
      potSize: 8,
      winners: ["Other"],
      actions: [],
      rawEvents: [],
      players: [{ playerAlias: "Dylan", vpip: false, pfr: false, profit: -2 }],
    },
  ];

  const dimensions = deriveStatsDimensions(hands);
  const keys = dimensions.map((dimension) => dimension.dimensionKey).sort();

  assert.deepEqual(keys, [
    "gameType:No Limit Hold'em",
    "gameType:No Limit Hold'em|handedness:FOUR_HANDED",
    "gameType:No Limit Hold'em|handedness:MULTIWAY",
    "gameType:Pot Limit Omaha Hi",
    "gameType:Pot Limit Omaha Hi|handedness:HEADS_UP",
    "handedness:FOUR_HANDED",
    "handedness:HEADS_UP",
    "handedness:MULTIWAY",
    "overall",
  ]);

  const huDimension = dimensions.find((dimension) => dimension.dimensionKey === "handedness:HEADS_UP");
  assert.ok(huDimension);
  const huHands = filterHandsForDimension(hands, huDimension);
  assert.equal(huHands.length, 1);
  assert.equal(huHands[0].handId, "1");
  assert.equal(toHandednessBucket(2), "HEADS_UP");
  assert.equal(toHandednessBucket(6), "SIX_PLUS");
});

test("calculateActionStats handles cbet misses and donk bets", () => {
  const now = new Date().toISOString();
  const actionStats = calculateActionStats([
    {
      actor: { playerAlias: "Dylan" },
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Dylan", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Other", actionType: "call", amount: 3, occurredAt: now },
        { sequence: 3, street: "flop", playerAlias: "Dylan", actionType: "check", occurredAt: now },
        { sequence: 4, street: "flop", playerAlias: "Other", actionType: "check", occurredAt: now },
      ],
    },
    {
      actor: { playerAlias: "Dylan" },
      actions: [
        { sequence: 1, street: "preflop", playerAlias: "Dylan", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerAlias: "Other", actionType: "call", amount: 3, occurredAt: now },
        { sequence: 3, street: "flop", playerAlias: "Other", actionType: "bet", amount: 4, occurredAt: now },
        { sequence: 4, street: "flop", playerAlias: "Dylan", actionType: "fold", occurredAt: now },
      ],
    },
  ]);

  assert.equal(actionStats.cbetOpportunities, 1);
  assert.equal(actionStats.cbets, 0);
  assert.equal(actionStats.foldToCbetOpportunities, 0);
});

test("calculateActionStats matches actions by player profile id across aliases", () => {
  const now = new Date().toISOString();
  const actionStats = calculateActionStats([
    {
      actor: { playerProfileId: "profile-1", playerAlias: "Dylan" },
      actions: [
        { sequence: 1, street: "preflop", playerProfileId: "profile-2", playerAlias: "Other", actionType: "raise", amount: 3, occurredAt: now },
        { sequence: 2, street: "preflop", playerProfileId: "profile-1", playerAlias: "DylanAlt", actionType: "raise", amount: 9, occurredAt: now },
        { sequence: 3, street: "flop", playerProfileId: "profile-1", playerAlias: "DylanAlt", actionType: "bet", amount: 8, occurredAt: now },
      ],
    },
  ]);

  assert.equal(actionStats.threeBetOpportunities, 1);
  assert.equal(actionStats.threeBets, 1);
  assert.equal(actionStats.cbetOpportunities, 1);
  assert.equal(actionStats.cbets, 1);
});
