import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

export interface AliasResolutionContext {
  guildId: string;
  trackedTableId: string;
}

export interface ResolvedAliasOwner {
  alias: string;
  playerProfileId: string | null;
}

let hasWarnedAboutLegacyAliasSchema = false;

export function resolveAliasOwner(
  alias: string,
  overrideMap: ReadonlyMap<string, string>,
  defaultMap: ReadonlyMap<string, string | null>,
) {
  const normalizedAlias = normalizePokerNowAlias(alias);
  return overrideMap.get(normalizedAlias) ?? defaultMap.get(normalizedAlias) ?? null;
}

export function normalizePokerNowAlias(alias: string) {
  return alias.trim().replace(/\s+@\s+[A-Za-z0-9_-]+$/, "").toLowerCase();
}

export async function resolveAliasOwnersForTable(
  context: AliasResolutionContext,
  aliases: string[],
): Promise<ResolvedAliasOwner[]> {
  const uniqueAliases = [...new Set(aliases)];
  if (uniqueAliases.length === 0) {
    return [];
  }
  const aliasesToQuery = [...new Set(uniqueAliases.map((alias) => normalizePokerNowAlias(alias)))];

  let overrides: Array<{ normalizedAlias: string; playerProfileId: string }> = [];
  let defaultAliases: Array<{ normalizedAlias: string; defaultPlayerProfileId: string | null }> = [];

  try {
    [overrides, defaultAliases] = await Promise.all([
      prisma.trackedTablePlayerOverride.findMany({
        where: {
          trackedTableId: context.trackedTableId,
          normalizedAlias: { in: aliasesToQuery },
        },
        select: {
          normalizedAlias: true,
          playerProfileId: true,
        },
      }),
      prisma.playerAlias.findMany({
        where: {
          guildId: context.guildId,
          normalizedAlias: { in: aliasesToQuery },
        },
        select: {
          normalizedAlias: true,
          defaultPlayerProfileId: true,
        },
      }),
    ]);
  } catch (error) {
    if (!isLegacyAliasSchemaError(error)) {
      throw error;
    }

    if (!hasWarnedAboutLegacyAliasSchema) {
      hasWarnedAboutLegacyAliasSchema = true;
      console.warn(
        "Player profile alias resolution skipped because the database schema is outdated. Apply the latest Prisma migration to enable profile/override ownership.",
      );
    }
  }

  const overrideMap = new Map(overrides.map((entry) => [entry.normalizedAlias, entry.playerProfileId]));
  const defaultMap = new Map(defaultAliases.map((entry) => [entry.normalizedAlias, entry.defaultPlayerProfileId]));

  return uniqueAliases.map((alias) => ({
    alias,
    playerProfileId: resolveAliasOwner(alias, overrideMap, defaultMap),
  }));
}

function isLegacyAliasSchemaError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return (
    (error.code === "P2021" && error.meta?.modelName === "TrackedTablePlayerOverride") ||
    (error.code === "P2022" &&
      (error.meta?.column === "PlayerAlias.defaultPlayerProfileId" ||
        error.meta?.column === "PlayerAlias.normalizedAlias" ||
        error.meta?.column === "TrackedTablePlayerOverride.normalizedAlias"))
  );
}
