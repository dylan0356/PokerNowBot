import { prisma } from "./client.js";
import { ensurePokerNowTableTracking } from "./tracking.js";
import { PokerNowInternalClient, type PokerNowClubGame } from "@pokernow/shared";

export interface UpsertPokerNowClubInput {
  guildId: string;
  clubId: string;
  slug: string;
  refreshPlayerId: string;
  createdById: string;
}

export interface SyncPokerNowClubInput {
  redisUrl: string;
  baseUrl: string;
  cookieHeader?: string;
  guildId?: string;
  clubId?: string;
}

export interface SyncedPokerNowClub {
  clubId: string;
  slug: string;
  gameCount: number;
  newlyTracked: number;
  games: PokerNowClubGame[];
}

export async function upsertPokerNowClub(input: UpsertPokerNowClubInput) {
  await prisma.guild.upsert({
    where: { id: input.guildId },
    update: {},
    create: { id: input.guildId },
  });

  return prisma.pokerNowClub.upsert({
    where: {
      guildId_clubId: {
        guildId: input.guildId,
        clubId: input.clubId,
      },
    },
    update: {
      slug: input.slug,
      refreshPlayerId: input.refreshPlayerId,
      createdById: input.createdById,
      enabled: true,
    },
    create: {
      guildId: input.guildId,
      clubId: input.clubId,
      slug: input.slug,
      refreshPlayerId: input.refreshPlayerId,
      createdById: input.createdById,
    },
  });
}

export async function syncPokerNowClubs(input: SyncPokerNowClubInput): Promise<SyncedPokerNowClub[]> {
  const clubs = await prisma.pokerNowClub.findMany({
    where: {
      enabled: true,
      ...(input.guildId ? { guildId: input.guildId } : {}),
      ...(input.clubId ? { clubId: input.clubId } : {}),
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const client = new PokerNowInternalClient({
    baseUrl: input.baseUrl,
    cookieHeader: input.cookieHeader,
  });

  const synced: SyncedPokerNowClub[] = [];
  for (const club of clubs) {
    try {
      const games = await client.refreshClubGames(club.clubId, club.refreshPlayerId);
      let newlyTracked = 0;
      for (const game of games) {
        const result = await ensurePokerNowTableTracking(input.redisUrl, club.guildId, club.createdById, {
          tableId: game.tableId,
          normalizedUrl: game.normalizedUrl,
          sourceUrl: game.sourceUrl,
        });
        if (result.tracked) {
          newlyTracked += 1;
        }
      }

      await prisma.pokerNowClub.update({
        where: { id: club.id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: `ok:${games.length}:${newlyTracked}`,
        },
      });

      synced.push({
        clubId: club.clubId,
        slug: club.slug,
        gameCount: games.length,
        newlyTracked,
        games,
      });
    } catch (error) {
      await prisma.pokerNowClub.update({
        where: { id: club.id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: error instanceof Error ? `error:${error.message.slice(0, 180)}` : "error:unknown",
        },
      });
      throw error;
    }
  }

  return synced;
}
