import test from "node:test";
import assert from "node:assert/strict";
import { extractPokerNowTables } from "@pokernow/shared";

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
