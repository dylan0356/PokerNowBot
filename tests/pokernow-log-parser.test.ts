import test from "node:test";
import assert from "node:assert/strict";
import type { PokerNowLogEntry } from "@pokernow/shared";
import { parsePokerNowHandsFromLogs } from "../apps/tracker/src/parser/log-parser.js";

test("parsePokerNowHandsFromLogs reconstructs a complete hand from log_v3 entries", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #1 --", createdAt: "177982150477502" },
    {
      msg: "\"michael @ h5FgiJLsGT\" collected 6.00 from pot with Two Pair, K's & Q's (combination: 7♣, Q♠, Q♥, K♠, K♥)",
      createdAt: "177982150477501",
    },
    { msg: "\"michael @ h5FgiJLsGT\" shows a 3♦, K♠, 2♠, 7♣.", createdAt: "177982150477500" },
    { msg: "\"ridley @ U-9YrwDlW3\" checks", createdAt: "177982150390100" },
    { msg: "\"michael @ h5FgiJLsGT\" checks", createdAt: "177982150254900" },
    { msg: "River: 8♥, 6♣, Q♠, Q♥ [K♥]", createdAt: "177982149957600" },
    { msg: "\"ridley @ U-9YrwDlW3\" checks", createdAt: "177982149873900" },
    { msg: "\"michael @ h5FgiJLsGT\" checks", createdAt: "177982149550400" },
    { msg: "Turn: 8♥, 6♣, Q♠ [Q♥]", createdAt: "177982149336000" },
    { msg: "\"ridley @ U-9YrwDlW3\" checks", createdAt: "177982149252800" },
    { msg: "\"michael @ h5FgiJLsGT\" checks", createdAt: "177982148349000" },
    { msg: "Flop:  [8♥, 6♣, Q♠]", createdAt: "177982148143800" },
    { msg: "\"michael @ h5FgiJLsGT\" calls 3.00", createdAt: "177982148061800" },
    { msg: "\"ridley @ U-9YrwDlW3\" raises to 3.00", createdAt: "177982147510700" },
    { msg: "\"michael @ h5FgiJLsGT\" posts a big blind of 1.00", createdAt: "177982146914207" },
    { msg: "\"ridley @ U-9YrwDlW3\" posts a small blind of 0.50", createdAt: "177982146914206" },
    { msg: "Player stacks: #1 \"ridley @ U-9YrwDlW3\" (100.00) | #2 \"michael @ h5FgiJLsGT\" (100.00)", createdAt: "177982146914203" },
    { msg: "-- starting hand #1 (id: dql6mv4yubwk)  Pot Limit Omaha Hi (dealer: \"ridley @ U-9YrwDlW3\") --", createdAt: "177982146914200" },
  ];

  const hands = parsePokerNowHandsFromLogs("table-1", entries);

  assert.equal(hands.length, 1);
  assert.equal(hands[0].handId, "dql6mv4yubwk");
  assert.equal(hands[0].handNumber, 1);
  assert.equal(hands[0].gameType, "Pot Limit Omaha Hi");
  assert.equal(hands[0].handedness, 2);
  assert.deepEqual(hands[0].boardCards, ["8♥", "6♣", "Q♠", "Q♥", "K♥"]);
  assert.deepEqual(hands[0].winners, ["michael @ h5FgiJLsGT"]);

  const michael = hands[0].players.find((player) => player.playerAlias === "michael @ h5FgiJLsGT");
  const ridley = hands[0].players.find((player) => player.playerAlias === "ridley @ U-9YrwDlW3");

  assert.ok(michael);
  assert.ok(ridley);
  assert.equal(michael?.vpip, true);
  assert.equal(michael?.pfr, false);
  assert.equal(michael?.profit, 3);
  assert.equal(ridley?.pfr, true);
  assert.equal(ridley?.profit, -3);
  assert.equal(hands[0].potSize, 6);
});

test("parsePokerNowHandsFromLogs handles uncalled bets and fold-to-turn-bet pots", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #309 --", createdAt: "177983259032002" },
    { msg: "\"ridley @ U-9YrwDlW3\" collected 28.00 from pot", createdAt: "177983259032001" },
    { msg: "Uncalled bet of 23.00 returned to \"ridley @ U-9YrwDlW3\"", createdAt: "177983259032000" },
    { msg: "\"michael @ Mjfl6P6jzI\" folds", createdAt: "177983258951400" },
    { msg: "\"ridley @ U-9YrwDlW3\" bets 23.00", createdAt: "177983258760200" },
    { msg: "\"michael @ Mjfl6P6jzI\" checks", createdAt: "177983258062300" },
    { msg: "Turn: 7♠, Q♥, 8♥ [K♠]", createdAt: "177983257931500" },
    { msg: "\"michael @ Mjfl6P6jzI\" calls 8.00", createdAt: "177983257848400" },
    { msg: "\"ridley @ U-9YrwDlW3\" bets 8.00", createdAt: "177983257659500" },
    { msg: "\"michael @ Mjfl6P6jzI\" checks", createdAt: "177983257216900" },
    { msg: "Flop:  [7♠, Q♥, 8♥]", createdAt: "177983257027400" },
    { msg: "\"michael @ Mjfl6P6jzI\" calls 6.00", createdAt: "177983256945400" },
    { msg: "\"ridley @ U-9YrwDlW3\" raises to 6.00", createdAt: "177983256740400" },
    { msg: "\"michael @ Mjfl6P6jzI\" posts a big blind of 2.00", createdAt: "177983256367805" },
    { msg: "\"ridley @ U-9YrwDlW3\" posts a small blind of 1.00", createdAt: "177983256367804" },
    { msg: "Player stacks: #1 \"ridley @ U-9YrwDlW3\" (645.49) | #2 \"michael @ Mjfl6P6jzI\" (650.00)", createdAt: "177983256367801" },
    { msg: "-- starting hand #309 (id: dldaejxmoa6n)  Pot Limit Omaha Hi (dealer: \"ridley @ U-9YrwDlW3\") --", createdAt: "177983256367800" },
  ];

  const hands = parsePokerNowHandsFromLogs("table-1", entries);
  assert.equal(hands.length, 1);
  assert.equal(hands[0].handNumber, 309);
  assert.equal(hands[0].potSize, 28);

  const ridley = hands[0].players.find((player) => player.playerAlias === "ridley @ U-9YrwDlW3");
  const michael = hands[0].players.find((player) => player.playerAlias === "michael @ Mjfl6P6jzI");

  assert.ok(ridley);
  assert.ok(michael);
  assert.equal(ridley?.profit, 14);
  assert.equal(michael?.profit, -14);
  assert.deepEqual(hands[0].winners, ["ridley @ U-9YrwDlW3"]);
});

test("parsePokerNowHandsFromLogs counts all-in raise suffixes and run-it-twice pots", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #444 --", createdAt: "177964919999999" },
    { msg: "\"michael @ h5FgiJLsGT\" collected 716.54 from pot", createdAt: "177964919999998" },
    { msg: "\"michael @ h5FgiJLsGT\" collected 716.54 from pot", createdAt: "177964919999997" },
    { msg: "River: A♣, K♣, 4♥, 7♦ [2♠]", createdAt: "177964919999996" },
    { msg: "River (second run): A♣, K♣, 4♥, 7♦ [3♠]", createdAt: "177964919999995" },
    { msg: "\"michael @ h5FgiJLsGT\" shows a A♦, A♥, K♦, K♥.", createdAt: "177964919999994" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" shows a Q♦, Q♥, J♦, J♥.", createdAt: "177964919999993" },
    { msg: "All players in hand choose to run it twice.", createdAt: "177964919999992" },
    { msg: "\"michael @ h5FgiJLsGT\" chooses to run it twice.", createdAt: "177964919999991" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" chooses to run it twice.", createdAt: "177964919999990" },
    { msg: "Remaining players decide whether to run it twice.", createdAt: "177964919999989" },
    { msg: "\"michael @ h5FgiJLsGT\" calls 632.54", createdAt: "177964919999988" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" raises to 632.54 and go all in", createdAt: "177964919999987" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" checks", createdAt: "177964919999986" },
    { msg: "Turn: A♣, K♣, 4♥ [7♦]", createdAt: "177964919999985" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" calls 56.00", createdAt: "177964919999984" },
    { msg: "\"Dylan @ zYSQI6FUHX\" folds", createdAt: "177964919999983" },
    { msg: "\"Luke @ tPKgOjVVvF\" folds", createdAt: "177964919999982" },
    { msg: "\"michael @ h5FgiJLsGT\" raises to 56.00", createdAt: "177964919999981" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" bets 28.00", createdAt: "177964919999980" },
    { msg: "\"Dylan @ zYSQI6FUHX\" checks", createdAt: "177964919999979" },
    { msg: "Flop:  [A♣, K♣, 4♥]", createdAt: "177964919999978" },
    { msg: "\"Dylan @ zYSQI6FUHX\" calls 14.00", createdAt: "177964919999977" },
    { msg: "\"Luke @ tPKgOjVVvF\" calls 14.00", createdAt: "177964919999976" },
    { msg: "\"michael @ h5FgiJLsGT\" calls 14.00", createdAt: "177964919999975" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" raises to 14.00", createdAt: "177964919999974" },
    { msg: "\"Dylan @ zYSQI6FUHX\" calls 3.50", createdAt: "177964919999973" },
    { msg: "\"Luke @ tPKgOjVVvF\" calls 3.50", createdAt: "177964919999972" },
    { msg: "\"michael @ h5FgiJLsGT\" raises to 3.50", createdAt: "177964919999971" },
    { msg: "\"Ridley @ 9M-rjxbUl8\" posts a big blind of 1.00", createdAt: "177964919999970" },
    { msg: "\"Dylan @ zYSQI6FUHX\" posts a small blind of 0.50", createdAt: "177964919999969" },
    {
      msg: "Player stacks: #1 \"Dylan @ zYSQI6FUHX\" (100.00) | #2 \"Ridley @ 9M-rjxbUl8\" (1000.00) | #3 \"michael @ h5FgiJLsGT\" (1000.00) | #4 \"Luke @ tPKgOjVVvF\" (100.00)",
      createdAt: "177964919999968",
    },
    { msg: "-- starting hand #444 (id: qu93okpmz9np)  Pot Limit Omaha Hi (dealer: \"Luke @ tPKgOjVVvF\") --", createdAt: "177964919999967" },
  ];

  const hands = parsePokerNowHandsFromLogs("table-1", entries);
  const hand = hands[0];
  const michael = hand.players.find((player) => player.playerAlias === "michael @ h5FgiJLsGT");
  const ridley = hand.players.find((player) => player.playerAlias === "Ridley @ 9M-rjxbUl8");

  assert.equal(hand.potSize, 1433.08);
  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(michael?.profit, 730.54);
  assert.equal(ridley?.profit, -702.54);
  assert.equal(hand.actions.some((action) => action.playerAlias === "Ridley @ 9M-rjxbUl8" && action.actionType === "raise" && action.amount === 632.54), true);
});

test("parsePokerNowHandsFromLogs counts all-in call and bet suffixes", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #2 --", createdAt: "177982150477515" },
    { msg: "\"Alice\" collected 44.00 from pot", createdAt: "177982150477514" },
    { msg: "\"Bob\" calls 20.00 and go all in", createdAt: "177982150477513" },
    { msg: "\"Alice\" bets 20.00 and go all in", createdAt: "177982150477512" },
    { msg: "Flop:  [8♥, 6♣, Q♠]", createdAt: "177982150477511" },
    { msg: "\"Bob\" calls 2.00", createdAt: "177982150477510" },
    { msg: "\"Alice\" posts a big blind of 2.00", createdAt: "177982150477509" },
    { msg: "\"Bob\" posts a small blind of 1.00", createdAt: "177982150477508" },
    { msg: "Player stacks: #1 \"Alice\" (100.00) | #2 \"Bob\" (100.00)", createdAt: "177982150477507" },
    { msg: "-- starting hand #2 (id: allin-call-bet)  No Limit Hold'em (dealer: \"Bob\") --", createdAt: "177982150477506" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const alice = hand.players.find((player) => player.playerAlias === "Alice");
  const bob = hand.players.find((player) => player.playerAlias === "Bob");

  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(alice?.profit, 22);
  assert.equal(bob?.profit, -22);
  assert.equal(hand.actions.filter((action) => action.actionType === "bet" || action.actionType === "call").length, 3);
});

test("parsePokerNowHandsFromLogs counts missed and missing blind posts", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #3 --", createdAt: "177982150477625" },
    { msg: "\"Bob\" collected 9.50 from pot", createdAt: "177982150477624" },
    { msg: "\"Alice\" checks", createdAt: "177982150477623" },
    { msg: "\"Bob\" checks", createdAt: "177982150477622" },
    { msg: "Flop:  [8♥, 6♣, Q♠]", createdAt: "177982150477621" },
    { msg: "\"Alice\" calls 4.50", createdAt: "177982150477620" },
    { msg: "\"Bob\" raises to 4.50", createdAt: "177982150477619" },
    { msg: "\"Alice\" posts a big blind of 1.00", createdAt: "177982150477618" },
    { msg: "\"Bob\" posts a missed big blind of 1.00", createdAt: "177982150477617" },
    { msg: "\"Bob\" posts a missing small blind of 0.50", createdAt: "177982150477616" },
    { msg: "Player stacks: #1 \"Alice\" (100.00) | #2 \"Bob\" (100.00)", createdAt: "177982150477615" },
    { msg: "-- starting hand #3 (id: missing-blinds)  No Limit Hold'em (dealer: \"Bob\") --", createdAt: "177982150477614" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const alice = hand.players.find((player) => player.playerAlias === "Alice");
  const bob = hand.players.find((player) => player.playerAlias === "Bob");

  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(alice?.profit, -4.5);
  assert.equal(bob?.profit, 4.5);
});

test("parsePokerNowHandsFromLogs counts all-in blind posts with trailing whitespace", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #63 --", createdAt: "177982150477705" },
    { msg: "\"Anton @ 9XnRvBoWhs\" collected 79.60 from pot", createdAt: "177982150477704" },
    { msg: "\"good samaritan @ M2K9HYdLWd\" shows a A♠, A♥.", createdAt: "177982150477703" },
    { msg: "\"Anton @ 9XnRvBoWhs\" shows a K♠, K♥.", createdAt: "177982150477702" },
    { msg: "\"good samaritan @ M2K9HYdLWd\" raises to 39.80", createdAt: "177982150477701" },
    { msg: "\"Anton @ 9XnRvBoWhs\" posts a big blind of 39.80 and go all in ", createdAt: "177982150477700" },
    { msg: "Player stacks: #1 \"good samaritan @ M2K9HYdLWd\" (305.21) | #2 \"Anton @ 9XnRvBoWhs\" (39.80)", createdAt: "177982150477699" },
    { msg: "-- starting hand #63 (id: huceommgpw3t)  No Limit Hold'em (dealer: \"good samaritan @ M2K9HYdLWd\") --", createdAt: "177982150477698" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const goodSamaritan = hand.players.find((player) => player.playerAlias === "good samaritan @ M2K9HYdLWd");
  const anton = hand.players.find((player) => player.playerAlias === "Anton @ 9XnRvBoWhs");

  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(hand.potSize, 79.6);
  assert.equal(goodSamaritan?.profit, -39.8);
  assert.equal(anton?.profit, 39.8);
});

test("parsePokerNowHandsFromLogs merges a player id change inside a hand", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #4 --", createdAt: "177982150477735" },
    { msg: "\"michael @ newId\" collected 18.00 from pot", createdAt: "177982150477734" },
    { msg: "Uncalled bet of 9.00 returned to \"michael @ newId\"", createdAt: "177982150477733" },
    { msg: "\"ridley @ U-9YrwDlW3\" folds", createdAt: "177982150477732" },
    { msg: "\"michael @ newId\" bets 9.00", createdAt: "177982150477731" },
    { msg: "Flop:  [8♥, 6♣, Q♠]", createdAt: "177982150477730" },
    { msg: "\"michael @ newId\" calls 9.00", createdAt: "177982150477729" },
    { msg: "The player \"michael @ newId\" changed the ID from oldId to newId because authenticated login.", createdAt: "177982150477728" },
    { msg: "\"ridley @ U-9YrwDlW3\" raises to 9.00", createdAt: "177982150477727" },
    { msg: "\"michael @ oldId\" raises to 3.00", createdAt: "177982150477726" },
    { msg: "\"ridley @ U-9YrwDlW3\" posts a big blind of 1.00", createdAt: "177982150477725" },
    { msg: "\"michael @ oldId\" posts a small blind of 0.50", createdAt: "177982150477724" },
    { msg: "Player stacks: #1 \"ridley @ U-9YrwDlW3\" (100.00) | #2 \"michael @ oldId\" (100.00)", createdAt: "177982150477723" },
    { msg: "-- starting hand #4 (id: id-change)  Pot Limit Omaha Hi (dealer: \"michael @ oldId\") --", createdAt: "177982150477722" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const michael = hand.players.find((player) => player.playerAlias === "michael @ newId");
  const oldMichael = hand.players.find((player) => player.playerAlias === "michael @ oldId");

  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.ok(michael);
  assert.equal(oldMichael, undefined);
  assert.equal(michael?.profit, 9);
  assert.equal(hand.actions.some((action) => action.playerAlias === "michael @ oldId"), false);
});

test("parsePokerNowHandsFromLogs tracks five-card double-board bomb pots without VPIP/PFR", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "-- ending hand #328 --", createdAt: "177982160000024" },
    { msg: "Bacon collected 9.00 from pot with Straight, A High on the second board  (combination: 10♦, J♣, Q♣, K♦, A♣)", createdAt: "177982160000023" },
    { msg: "Bacon collected 9.00 from pot with Two Pair, Q's & J's (combination: 6♦, J♦, J♣, Q♠, Q♦)", createdAt: "177982160000022" },
    { msg: "Bacon shows a 4♣, J♦, J♣, 9♠, K♦.", createdAt: "177982160000021" },
    { msg: "Dylan shows a 4♠, 6♠, 3♦, 10♥, 10♠.", createdAt: "177982160000020" },
    { msg: "Bacon checks", createdAt: "177982160000019" },
    { msg: "Dylan checks", createdAt: "177982160000018" },
    { msg: "River (second board): 10♦, J♠, 5♦, Q♣ [A♣]", createdAt: "177982160000017" },
    { msg: "River: 6♦, 3♠, Q♠, Q♦ [2♣]", createdAt: "177982160000016" },
    { msg: "Bacon checks", createdAt: "177982160000015" },
    { msg: "Dylan checks", createdAt: "177982160000014" },
    { msg: "Turn (second board): 10♦, J♠, 5♦ [Q♣]", createdAt: "177982160000013" },
    { msg: "Turn: 6♦, 3♠, Q♠ [Q♦]", createdAt: "177982160000012" },
    { msg: "Ridley folds", createdAt: "177982160000011" },
    { msg: "Dylan calls 4.50", createdAt: "177982160000010" },
    { msg: "Bacon bets 4.50", createdAt: "177982160000009" },
    { msg: "Ridley checks", createdAt: "177982160000008" },
    { msg: "Dylan checks", createdAt: "177982160000007" },
    { msg: "Flop (second board):  [10♦, J♠, 5♦]", createdAt: "177982160000006" },
    { msg: "Flop:  [6♦, 3♠, Q♠]", createdAt: "177982160000005" },
    { msg: "Ridley calls 3.00 (bomb pot bet)", createdAt: "177982160000004" },
    { msg: "Dylan calls 3.00 (bomb pot bet)", createdAt: "177982160000003" },
    { msg: "Bacon posts a bet of 3.00 (bomb pot bet)", createdAt: "177982160000002" },
    { msg: "Player stacks: #1 Ridley (327.91) | #2 Bacon (355.54) | #10 Dylan (240.68)", createdAt: "177982160000001" },
    { msg: "-- starting hand #328 (id: zbls2qv5dxml)  Pot Limit Omaha 5 Hi (dealer: Bacon) --", createdAt: "177982160000000" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const bacon = hand.players.find((player) => player.playerAlias === "Bacon");
  const dylan = hand.players.find((player) => player.playerAlias === "Dylan");
  const ridley = hand.players.find((player) => player.playerAlias === "Ridley");

  assert.equal(hand.isBombPot, true);
  assert.deepEqual(hand.boardCards, ["6♦", "3♠", "Q♠", "Q♦", "2♣"]);
  assert.deepEqual(hand.boardRunouts, [
    ["6♦", "3♠", "Q♠", "Q♦", "2♣"],
    ["T♦", "J♠", "5♦", "Q♣", "A♣"],
  ]);
  assert.equal(hand.potSize, 18);
  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(bacon?.profit, 10.5);
  assert.equal(dylan?.profit, -7.5);
  assert.equal(ridley?.profit, -3);
  assert.equal(bacon?.vpip, false);
  assert.equal(dylan?.vpip, false);
  assert.equal(ridley?.vpip, false);
  assert.equal(bacon?.pfr, false);
});

test("parsePokerNowHandsFromLogs tracks four-card double-board bomb pots with missing blinds", () => {
  const entries: PokerNowLogEntry[] = [
    { msg: "luke shows a 8♦.", createdAt: "177982170000024" },
    { msg: "luke shows a J♦.", createdAt: "177982170000023" },
    { msg: "-- ending hand #330 --", createdAt: "177982170000022" },
    { msg: "luke collected 27.50 from pot", createdAt: "177982170000021" },
    { msg: "Uncalled bet of 20.00 returned to luke", createdAt: "177982170000020" },
    { msg: "Bacon folds", createdAt: "177982170000019" },
    { msg: "luke bets 20.00", createdAt: "177982170000018" },
    { msg: "Bacon checks", createdAt: "177982170000017" },
    { msg: "River (second board): 6♦, 9♣, Q♦, K♦ [2♥]", createdAt: "177982170000016" },
    { msg: "River: Q♥, 5♣, 5♥, J♠ [7♣]", createdAt: "177982170000015" },
    { msg: "Bacon calls 7.50", createdAt: "177982170000014" },
    { msg: "Dylan folds", createdAt: "177982170000013" },
    { msg: "luke bets 7.50", createdAt: "177982170000012" },
    { msg: "Bacon checks", createdAt: "177982170000011" },
    { msg: "Turn (second board): 6♦, 9♣, Q♦ [K♦]", createdAt: "177982170000010" },
    { msg: "Turn: Q♥, 5♣, 5♥ [J♠]", createdAt: "177982170000009" },
    { msg: "Ridley folds", createdAt: "177982170000008" },
    { msg: "Dylan checks", createdAt: "177982170000007" },
    { msg: "luke checks", createdAt: "177982170000006" },
    { msg: "Bacon checks", createdAt: "177982170000005" },
    { msg: "Flop (second board):  [6♦, 9♣, Q♦]", createdAt: "177982170000004" },
    { msg: "Flop:  [Q♥, 5♣, 5♥]", createdAt: "177982170000003" },
    { msg: "luke calls 3.00 (bomb pot bet)", createdAt: "177982170000002" },
    { msg: "Bacon calls 3.00 (bomb pot bet)", createdAt: "177982170000001" },
    { msg: "Ridley calls 3.00 (bomb pot bet)", createdAt: "177982170000000" },
    { msg: "Dylan posts a bet of 3.00 (bomb pot bet)", createdAt: "177982169999999" },
    { msg: "luke posts a missing small blind of 0.50", createdAt: "177982169999998" },
    { msg: "Player stacks: #1 Ridley (321.91) | #2 Bacon (372.04) | #9 luke (126.26) | #10 Dylan (230.18)", createdAt: "177982169999997" },
    { msg: "-- starting hand #330 (id: hhy4sitaafxo)  Pot Limit Omaha Hi (dealer: Ridley) --", createdAt: "177982169999996" },
  ];

  const hand = parsePokerNowHandsFromLogs("table-1", entries)[0];
  const luke = hand.players.find((player) => player.playerAlias === "luke");
  const bacon = hand.players.find((player) => player.playerAlias === "Bacon");
  const dylan = hand.players.find((player) => player.playerAlias === "Dylan");
  const ridley = hand.players.find((player) => player.playerAlias === "Ridley");

  assert.equal(hand.isBombPot, true);
  assert.deepEqual(hand.boardRunouts, [
    ["Q♥", "5♣", "5♥", "J♠", "7♣"],
    ["6♦", "9♣", "Q♦", "K♦", "2♥"],
  ]);
  assert.equal(hand.potSize, 27.5);
  assert.equal(round(hand.players.reduce((sum, player) => sum + player.profit, 0)), 0);
  assert.equal(luke?.profit, 16.5);
  assert.equal(bacon?.profit, -10.5);
  assert.equal(dylan?.profit, -3);
  assert.equal(ridley?.profit, -3);
  assert.equal(luke?.vpip, false);
  assert.equal(dylan?.vpip, false);
});

function round(value: number) {
  return Number(value.toFixed(2));
}
