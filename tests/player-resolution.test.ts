import test from "node:test";
import assert from "node:assert/strict";
import { normalizePokerNowAlias, resolveAliasOwner } from "@pokernow/db";

test("resolveAliasOwner prefers per-table overrides over guild defaults", () => {
  const owner = resolveAliasOwner("michael", new Map([["michael", "override-profile"]]), new Map([["michael", "default-profile"]]));
  assert.equal(owner, "override-profile");
});

test("resolveAliasOwner falls back to guild default and then unresolved", () => {
  assert.equal(resolveAliasOwner("michael", new Map(), new Map([["michael", "default-profile"]])), "default-profile");
  assert.equal(resolveAliasOwner("unknown", new Map(), new Map()), null);
});

test("resolveAliasOwner resolves PokerNow log aliases through the display name", () => {
  assert.equal(resolveAliasOwner("michael @ Mjfl6P6jzI", new Map(), new Map([["michael", "default-profile"]])), "default-profile");
  assert.equal(resolveAliasOwner("michael @ Mjfl6P6jzI", new Map([["michael", "override-profile"]]), new Map([["michael", "default-profile"]])), "override-profile");
  assert.equal(resolveAliasOwner("Michael @ Mjfl6P6jzI", new Map(), new Map([["michael", "default-profile"]])), "default-profile");
});

test("normalizePokerNowAlias strips PokerNow session suffixes", () => {
  assert.equal(normalizePokerNowAlias("michael @ Mjfl6P6jzI"), "michael");
  assert.equal(normalizePokerNowAlias("ridley @ U-9YrwDlW3"), "ridley");
  assert.equal(normalizePokerNowAlias("Ridley @ U-9YrwDlW3"), "ridley");
  assert.equal(normalizePokerNowAlias("plain-name"), "plain-name");
});
