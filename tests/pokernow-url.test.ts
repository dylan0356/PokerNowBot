import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPokerNowPlayerId,
  extractPokerNowTables,
  parsePokerNowClubGames,
  pokerNowAccountAlias,
  toPokerNowChipCents,
} from "@pokernow/shared";

test("extractPokerNowTables finds and deduplicates table links", () => {
  const result = extractPokerNowTables(`
    first https://www.pokernow.com/games/abc123
    duplicate https://www.pokernow.club/games/abc123?foo=bar
    second https://www.pokernow.com/games/xyz789
  `);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((table) => table.tableId), ["abc123", "xyz789"]);
  assert.deepEqual(result.map((table) => table.normalizedUrl), [
    "https://www.pokernow.com/games/abc123",
    "https://www.pokernow.com/games/xyz789",
  ]);
});

test("extractPokerNowPlayerId accepts ids and player URLs", () => {
  assert.equal(extractPokerNowPlayerId("U-9YrwDlW3"), "U-9YrwDlW3");
  assert.equal(extractPokerNowPlayerId("https://www.pokernow.com/players/U-9YrwDlW3"), "U-9YrwDlW3");
  assert.equal(pokerNowAccountAlias("https://www.pokernow.com/players/U-9YrwDlW3"), "pokernow:U-9YrwDlW3");
});

test("toPokerNowChipCents converts displayed chips to cents", () => {
  assert.equal(toPokerNowChipCents(100), 10000);
  assert.equal(toPokerNowChipCents(0.5), 50);
  assert.throws(() => toPokerNowChipCents(0), /greater than 0/);
});

test("parsePokerNowClubGames extracts active table references", () => {
  const result = parsePokerNowClubGames(
    {
      success: true,
      games: [
        {
          id: "club-game-id",
          club_id: "club-id",
          poker_now_game_id: "pgl-SJRgfUPTj3r8DsoXSfQCf",
          custom_table_name: "0.50/1 Holdem",
          expired: false,
          game: {
            status: "waiting",
          },
        },
      ],
    },
    "https://www.pokernow.com",
  );

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: "club-game-id",
    clubId: "club-id",
    tableId: "pgl-SJRgfUPTj3r8DsoXSfQCf",
    name: "0.50/1 Holdem",
    sourceUrl: "https://www.pokernow.com/games/pgl-SJRgfUPTj3r8DsoXSfQCf",
    normalizedUrl: "https://www.pokernow.com/games/pgl-SJRgfUPTj3r8DsoXSfQCf",
    expired: false,
    status: "waiting",
  });
});
