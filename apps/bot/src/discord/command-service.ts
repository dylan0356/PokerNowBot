import { normalizePokerNowAlias, prisma, resolveAliasOwnersForTable, syncPokerNowClubs, upsertPokerNowClub } from "@pokernow/db";
import { calculateActionStats } from "@pokernow/stats";
import { Queue } from "bullmq";
import { PokerNowInternalClient, pokerNowAccountAlias, queueNames, toBullConnection, toPokerNowChipCents } from "@pokernow/shared";
import type { HandednessBucket } from "@pokernow/shared";
import { buildProfitGraphUrl, formatPercent } from "./formatting.js";

export interface StatsFilter {
  handedness?: HandednessBucket;
  gameType?: string;
}

export interface PokerNowInternalConfig {
  baseUrl: string;
  cookieHeader?: string;
}

export class CommandService {
  async createPlayer(guildId: string, displayName: string) {
    throw new Error(`Players are Discord users now. Use /player-create user:<Discord user> display_name:${displayName.trim()}`);
  }

  async createPlayerForDiscordUser(guildId: string, discordUserId: string, fallbackDisplayName: string, displayName?: string) {
    await this.ensureGuild(guildId);
    const existing = await this.findProfileByDiscord(guildId, discordUserId);
    if (existing) {
      if (displayName?.trim() && displayName.trim() !== existing.displayName) {
        const availableDisplayName = await this.findAvailableDisplayName(guildId, displayName.trim(), discordUserId, existing.id);
        return prisma.playerProfile.update({
          where: { id: existing.id },
          data: { displayName: availableDisplayName },
        });
      }

      return existing;
    }

    const requestedDisplayName = displayName?.trim() || fallbackDisplayName.trim();
    const availableDisplayName = await this.findAvailableDisplayName(guildId, requestedDisplayName, discordUserId);
    return prisma.playerProfile.create({
      data: {
        guildId,
        displayName: availableDisplayName,
        discordUserId,
      },
    });
  }

  async linkAlias(guildId: string, discordUserId: string, alias: string, fallbackDisplayName: string) {
    await this.ensureGuild(guildId);
    const profile = await this.getOrCreateProfileForDiscord(guildId, discordUserId, fallbackDisplayName);
    await this.setAliasDefaultByProfileId(guildId, alias, profile.id);
    return profile;
  }

  async unlinkAlias(guildId: string, discordUserId: string, alias: string) {
    const profile = await this.findProfileByDiscord(guildId, discordUserId);
    if (!profile) {
      return false;
    }

    const result = await prisma.playerAlias.updateMany({
      where: {
        guildId,
        normalizedAlias: normalizePokerNowAlias(alias),
        defaultPlayerProfileId: profile.id,
      },
      data: {
        defaultPlayerProfileId: null,
      },
    });

    return result.count > 0;
  }

  async addAliasToPlayer(guildId: string, displayName: string, alias: string) {
    throw new Error(`Players are Discord users now. Use /player-alias-add user:<Discord user> alias:${alias}`);
  }

  async addAliasToDiscordUser(guildId: string, discordUserId: string, fallbackDisplayName: string, alias: string) {
    await this.ensureGuild(guildId);
    const profile = await this.getOrCreateProfileForDiscord(guildId, discordUserId, fallbackDisplayName);
    await this.setAliasDefaultByProfileId(guildId, alias, profile.id);
    return profile;
  }

  async addAliasesToDiscordUser(guildId: string, discordUserId: string, fallbackDisplayName: string, aliasesInput: string) {
    await this.ensureGuild(guildId);
    const aliases = parseAliasList(aliasesInput);
    if (aliases.length === 0) {
      throw new Error("Provide at least one PokerNow alias");
    }

    const profile = await this.getOrCreateProfileForDiscord(guildId, discordUserId, fallbackDisplayName);
    for (const alias of aliases) {
      await this.setAliasDefaultByProfileId(guildId, alias, profile.id);
    }

    return { profile, aliases };
  }

  async addPokerNowAccountAliasToDiscordUser(guildId: string, discordUserId: string, fallbackDisplayName: string, accountIdOrUrl: string) {
    const alias = pokerNowAccountAlias(accountIdOrUrl);
    const profile = await this.addAliasToDiscordUser(guildId, discordUserId, fallbackDisplayName, alias);
    return { profile, alias };
  }

  async removePokerNowAccountAlias(guildId: string, accountIdOrUrl: string) {
    return this.removeAlias(guildId, pokerNowAccountAlias(accountIdOrUrl));
  }

  async moveClubChips(config: PokerNowInternalConfig, action: "add" | "remove", clubId: string, pokerNowUserId: string, amount: number) {
    const client = new PokerNowInternalClient(config);
    const amountCents = toPokerNowChipCents(amount);
    const result =
      action === "add"
        ? await client.addClubChips(clubId.trim(), pokerNowUserId.trim(), amountCents)
        : await client.removeClubChips(clubId.trim(), pokerNowUserId.trim(), amountCents);
    return { ...result, amountCents };
  }

  async addClubTracking(
    redisUrl: string,
    config: PokerNowInternalConfig,
    guildId: string,
    createdById: string,
    clubId: string,
    refreshPlayerId: string,
    slug: string,
  ) {
    await upsertPokerNowClub({
      guildId,
      clubId: clubId.trim(),
      refreshPlayerId: refreshPlayerId.trim(),
      slug: slug.trim(),
      createdById,
    });

    return syncPokerNowClubs({
      redisUrl,
      baseUrl: config.baseUrl,
      cookieHeader: config.cookieHeader,
      guildId,
      clubId: clubId.trim(),
    });
  }

  async refreshClubTracking(redisUrl: string, config: PokerNowInternalConfig, guildId: string, clubId?: string) {
    return syncPokerNowClubs({
      redisUrl,
      baseUrl: config.baseUrl,
      cookieHeader: config.cookieHeader,
      guildId,
      clubId: clubId?.trim(),
    });
  }

  async listPokerNowClubs(guildId: string) {
    const clubs = await prisma.pokerNowClub.findMany({
      where: { guildId },
      orderBy: { createdAt: "asc" },
    });

    return clubs.map((club) => ({
      clubId: club.clubId,
      slug: club.slug,
      enabled: club.enabled,
      lastSyncedAt: club.lastSyncedAt,
      lastSyncStatus: club.lastSyncStatus,
      lastGameCount: gameCountFromSyncStatus(club.lastSyncStatus),
    }));
  }

  async removeAlias(guildId: string, alias: string) {
    const deleted = await prisma.playerAlias.deleteMany({
      where: {
        guildId,
        normalizedAlias: normalizePokerNowAlias(alias),
      },
    });
    return deleted.count > 0;
  }

  async setAliasDefault(guildId: string, alias: string, displayName: string) {
    throw new Error(`Players are Discord users now. Use /player-alias-set-default alias:${alias} user:<Discord user>`);
  }

  async setAliasDefaultForDiscordUser(guildId: string, alias: string, discordUserId: string, fallbackDisplayName: string) {
    await this.ensureGuild(guildId);
    const profile = await this.getOrCreateProfileForDiscord(guildId, discordUserId, fallbackDisplayName);
    await this.setAliasDefaultByProfileId(guildId, alias, profile.id);
    return profile;
  }

  async setTableOverride(guildId: string, tableId: string, alias: string, displayName: string) {
    throw new Error(`Players are Discord users now. Use /player-override-set table_id:${tableId} alias:${alias} user:<Discord user>`);
  }

  async setTableOverrideForDiscordUser(guildId: string, tableId: string, alias: string, discordUserId: string, fallbackDisplayName: string) {
    const [profile, trackedTable] = await Promise.all([
      this.getOrCreateProfileForDiscord(guildId, discordUserId, fallbackDisplayName),
      this.requireTrackedTable(guildId, tableId),
    ]);

    const normalizedAlias = normalizePokerNowAlias(alias);
    const existing = await prisma.trackedTablePlayerOverride.findFirst({
      where: {
        trackedTableId: trackedTable.id,
        normalizedAlias,
      },
    });

    if (existing) {
      await prisma.trackedTablePlayerOverride.update({
        where: { id: existing.id },
        data: { alias: alias.trim(), normalizedAlias, playerProfileId: profile.id },
      });
    } else {
      await prisma.trackedTablePlayerOverride.create({
        data: { trackedTableId: trackedTable.id, alias: alias.trim(), normalizedAlias, playerProfileId: profile.id },
      });
    }

    return { trackedTable, profile };
  }

  async clearTableOverride(guildId: string, tableId: string, alias: string) {
    const trackedTable = await this.requireTrackedTable(guildId, tableId);
    const deleted = await prisma.trackedTablePlayerOverride.deleteMany({
      where: {
        trackedTableId: trackedTable.id,
        normalizedAlias: normalizePokerNowAlias(alias),
      },
    });
    return deleted.count > 0;
  }

  async getPlayer(guildId: string, displayName: string) {
    return prisma.playerProfile.findUnique({
      where: {
        guildId_displayName: {
          guildId,
          displayName: displayName.trim(),
        },
      },
      include: {
        aliases: true,
        snapshots: {
          where: {
            OR: [
              {
                scope: "OVERALL",
                dimensionKey: "overall",
              },
              {
                scope: "BY_GAME_TYPE",
              },
            ],
          },
          orderBy: {
            dimensionKey: "asc",
          },
        },
      },
    });
  }

  async getPlayerByDiscordUser(guildId: string, discordUserId: string) {
    return prisma.playerProfile.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId,
        },
      },
      include: {
        aliases: true,
        snapshots: {
          where: {
            OR: [
              {
                scope: "OVERALL",
                dimensionKey: "overall",
              },
              {
                scope: "BY_GAME_TYPE",
              },
            ],
          },
          orderBy: {
            dimensionKey: "asc",
          },
        },
      },
    });
  }

  async listAliases(guildId: string) {
    return prisma.playerAlias.findMany({
      where: { guildId },
      include: {
        defaultPlayerProfile: true,
      },
      orderBy: {
        alias: "asc",
      },
    });
  }

  async listUnresolvedAliases(guildId: string) {
    const [unassignedDefaults, handPlayers, handActions] = await Promise.all([
      prisma.playerAlias.findMany({
        where: {
          guildId,
          defaultPlayerProfileId: null,
        },
        select: {
          alias: true,
        },
      }),
      prisma.handPlayer.findMany({
        where: {
          hand: {
            trackingSession: {
              trackedTable: {
                guildId,
              },
            },
          },
        },
        select: {
          playerAlias: true,
          hand: {
            select: {
              trackingSession: {
                select: {
                  trackedTableId: true,
                },
              },
            },
          },
        },
      }),
      prisma.handAction.findMany({
        where: {
          hand: {
            trackingSession: {
              trackedTable: {
                guildId,
              },
            },
          },
        },
        select: {
          playerAlias: true,
          hand: {
            select: {
              trackingSession: {
                select: {
                  trackedTableId: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const aliasesByTable = new Map<string, Set<string>>();
    for (const entry of [...handPlayers, ...handActions]) {
      const trackedTableId = entry.hand.trackingSession.trackedTableId;
      const aliases = aliasesByTable.get(trackedTableId) ?? new Set<string>();
      aliases.add(entry.playerAlias);
      aliasesByTable.set(trackedTableId, aliases);
    }

    const unresolved = new Set(unassignedDefaults.map((entry) => normalizePokerNowAlias(entry.alias)));
    for (const [trackedTableId, aliases] of aliasesByTable) {
      const resolvedAliases = await resolveAliasOwnersForTable(
        {
          guildId,
          trackedTableId,
        },
        [...aliases],
      );

      for (const resolvedAlias of resolvedAliases) {
        if (!resolvedAlias.playerProfileId) {
          unresolved.add(normalizePokerNowAlias(resolvedAlias.alias));
        }
      }
    }

    return [...unresolved].sort();
  }

  async recomputeAliasAttribution(guildId: string, redisUrl: string, tableId?: string) {
    const trackedTables = await prisma.trackedTable.findMany({
      where: {
        guildId,
        ...(tableId ? { tableId } : {}),
      },
      select: {
        id: true,
        tableId: true,
      },
    });

    let updatedHands = 0;
    let updatedActions = 0;

    for (const trackedTable of trackedTables) {
      const [handPlayers, handActions] = await Promise.all([
        prisma.handPlayer.findMany({
          where: {
            hand: {
              trackingSession: {
                trackedTableId: trackedTable.id,
              },
            },
          },
          select: {
            playerAlias: true,
          },
          distinct: ["playerAlias"],
        }),
        prisma.handAction.findMany({
          where: {
            hand: {
              trackingSession: {
                trackedTableId: trackedTable.id,
              },
            },
          },
          select: {
            playerAlias: true,
          },
          distinct: ["playerAlias"],
        }),
      ]);

      const aliases = [...new Set([...handPlayers.map((entry) => entry.playerAlias), ...handActions.map((entry) => entry.playerAlias)])];
      const resolvedAliases = await resolveAliasOwnersForTable(
        {
          guildId,
          trackedTableId: trackedTable.id,
        },
        aliases,
      );

      for (const resolved of resolvedAliases) {
        const [hands, actions] = await Promise.all([
          prisma.handPlayer.updateMany({
            where: {
              playerAlias: resolved.alias,
              hand: {
                trackingSession: {
                  trackedTableId: trackedTable.id,
                },
              },
            },
            data: {
              playerProfileId: resolved.playerProfileId,
            },
          }),
          prisma.handAction.updateMany({
            where: {
              playerAlias: resolved.alias,
              hand: {
                trackingSession: {
                  trackedTableId: trackedTable.id,
                },
              },
            },
            data: {
              playerProfileId: resolved.playerProfileId,
            },
          }),
        ]);

        updatedHands += hands.count;
        updatedActions += actions.count;
      }
    }

    const refreshStatsQueue = new Queue(queueNames.refreshStats, {
      connection: toBullConnection(redisUrl),
    });
    await refreshStatsQueue.add("refresh-stats", { guildId });
    await refreshStatsQueue.close();

    return { trackedTables: trackedTables.length, updatedHands, updatedActions };
  }

  async getStats(guildId: string, discordUserId: string, filter: StatsFilter = {}) {
    const dimensionKeys = statsDimensionKeysForFilter(filter);
    return prisma.playerProfile.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId,
        },
      },
      include: {
        aliases: true,
        snapshots: {
          where: {
            dimensionKey: { in: dimensionKeys },
          },
          orderBy: {
            dimensionKey: "asc",
          },
        },
      },
    });
  }

  async listStatsGameTypes(guildId: string, discordUserId?: string) {
    const profile = discordUserId ? await this.findProfileByDiscord(guildId, discordUserId) : null;
    if (discordUserId && !profile) {
      return [];
    }

    const rows = await prisma.statsSnapshot.findMany({
      where: {
        guildId,
        gameType: { not: null },
        ...(profile ? { playerProfileId: profile.id } : {}),
      },
      select: {
        gameType: true,
      },
      distinct: ["gameType"],
      orderBy: {
        gameType: "asc",
      },
    });

    return rows.map((row) => row.gameType).filter((gameType): gameType is string => Boolean(gameType));
  }

  async getLeaderboard(guildId: string, filter: StatsFilter = { handedness: "HEADS_UP" }) {
    return prisma.statsSnapshot.findMany({
      where: {
        guildId,
        dimensionKey: statsDimensionKeyForFilter(filter),
        handsPlayed: { gt: 0 },
      },
      include: {
        playerProfile: true,
      },
      orderBy: {
        handsPlayed: "desc",
      },
      take: 10,
    });
  }

  async getSessions(guildId: string, discordUserId: string) {
    const profile = await this.findProfileByDiscord(guildId, discordUserId);
    if (!profile) {
      return null;
    }

    const handPlayers = await prisma.handPlayer.findMany({
      where: {
        playerProfileId: profile.id,
        hand: {
          trackingSession: {
            trackedTable: {
              guildId,
            },
          },
        },
      },
      select: {
        hand: {
          select: {
            tableId: true,
            startedAt: true,
            finishedAt: true,
            trackingSession: {
              select: {
                trackedTable: {
                  select: {
                    tableId: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        hand: {
          finishedAt: "desc",
        },
      },
      take: 20,
    });

    const sessions = new Map<string, { tableId: string; startedAt: Date; finishedAt: Date; handsPlayed: number }>();
    for (const entry of handPlayers) {
      const tableId = entry.hand.trackingSession.trackedTable.tableId || entry.hand.tableId;
      const existing = sessions.get(tableId);
      if (!existing) {
        sessions.set(tableId, {
          tableId,
          startedAt: entry.hand.startedAt,
          finishedAt: entry.hand.finishedAt,
          handsPlayed: 1,
        });
        continue;
      }

      existing.startedAt = entry.hand.startedAt < existing.startedAt ? entry.hand.startedAt : existing.startedAt;
      existing.finishedAt = entry.hand.finishedAt > existing.finishedAt ? entry.hand.finishedAt : existing.finishedAt;
      existing.handsPlayed += 1;
    }

    return [...sessions.values()].sort((left, right) => right.finishedAt.getTime() - left.finishedAt.getTime()).slice(0, 20);
  }

  async getSessionStats(guildId: string, tableId: string) {
    const trackedTable = await prisma.trackedTable.findUnique({
      where: {
        guildId_tableId: {
          guildId,
          tableId,
        },
      },
      include: {
        sessions: {
          include: {
            hands: {
              include: {
                players: {
                  include: {
                    playerProfile: true,
                  },
                },
                actions: true,
              },
            },
          },
        },
      },
    });

    if (!trackedTable) {
      return null;
    }

    const hands = trackedTable.sessions.flatMap((session) => session.hands);
    const entriesByPlayer = new Map<
      string,
      {
        displayName: string;
        discordUserId: string | null;
        aliases: Set<string>;
        entries: SessionHandEntry[];
      }
    >();

    for (const hand of hands) {
      for (const player of hand.players) {
        const key = player.playerProfileId ?? `alias:${player.playerAlias}`;
        const existing =
          entriesByPlayer.get(key) ??
          {
            displayName: player.playerProfile?.displayName ?? player.playerAlias,
            discordUserId: player.playerProfile?.discordUserId ?? null,
            aliases: new Set<string>(),
            entries: [],
          };

        existing.aliases.add(player.playerAlias);
        existing.entries.push({
          vpip: player.vpip,
          pfr: player.pfr,
          profit: Number(player.profit),
          bigBlindAmount: hand.bigBlindAmount ? Number(hand.bigBlindAmount) : undefined,
          isBombPot: hand.isBombPot,
          playerProfileId: player.playerProfileId,
          playerAlias: player.playerAlias,
          actions: hand.actions,
        });
        entriesByPlayer.set(key, existing);
      }
    }

    const players = [...entriesByPlayer.values()]
      .map((entry) => ({
        displayName: entry.displayName,
        discordUserId: entry.discordUserId,
        aliases: [...entry.aliases].sort(),
        stats: calculateSessionStats(entry.entries),
      }))
      .filter((entry) => entry.stats.handsPlayed > 0)
      .sort((left, right) => right.stats.handsPlayed - left.stats.handsPlayed || left.displayName.localeCompare(right.displayName));

    const startedAt = hands.reduce<Date | null>((earliest, hand) => (!earliest || hand.startedAt < earliest ? hand.startedAt : earliest), null);
    const finishedAt = hands.reduce<Date | null>((latest, hand) => (!latest || hand.finishedAt > latest ? hand.finishedAt : latest), null);

    return {
      tableId: trackedTable.tableId,
      state: trackedTable.state,
      startedAt,
      finishedAt,
      handCount: hands.length,
      players,
    };
  }

  async getGraph(guildId: string, discordUserId: string) {
    const profile = await this.findProfileByDiscord(guildId, discordUserId);
    if (!profile) {
      return null;
    }

    const handPlayers = await prisma.handPlayer.findMany({
      where: {
        playerProfileId: profile.id,
        hand: {
          trackingSession: {
            trackedTable: {
              guildId,
            },
          },
        },
      },
      include: {
        hand: true,
      },
      orderBy: {
        hand: {
          finishedAt: "asc",
        },
      },
    });

    let runningProfit = 0;
    const labels: string[] = [];
    const series: number[] = [];

    for (const [index, handPlayer] of handPlayers.entries()) {
      runningProfit += Number(handPlayer.profit);
      labels.push(String(index + 1));
      series.push(Number(runningProfit.toFixed(2)));
    }

    return buildProfitGraphUrl(labels, series);
  }

  async getHeadToHead(guildId: string, firstDiscordUserId: string, secondDiscordUserId: string) {
    const [firstProfile, secondProfile] = await Promise.all([
      this.findProfileByDiscord(guildId, firstDiscordUserId),
      this.findProfileByDiscord(guildId, secondDiscordUserId),
    ]);
    if (!firstProfile || !secondProfile) {
      return null;
    }

    const sharedHands = await prisma.hand.findMany({
      where: {
        trackingSession: {
          trackedTable: {
            guildId,
          },
        },
        AND: [
          {
            players: {
              some: {
                playerProfileId: firstProfile.id,
              },
            },
          },
          {
            players: {
              some: {
                playerProfileId: secondProfile.id,
              },
            },
          },
        ],
      },
      include: {
        trackingSession: {
          select: {
            id: true,
          },
        },
        players: true,
        actions: true,
      },
      orderBy: {
        finishedAt: "asc",
      },
    });

    const firstEntries: HeadToHeadHandEntry[] = [];
    const secondEntries: HeadToHeadHandEntry[] = [];
    const sharedSessionIds = new Set<string>();
    let biggestPot:
      | {
          handId: string;
          tableId: string;
          potSize: number;
          boardCards: string[];
          winners: string[];
        }
      | null = null;

    for (const hand of sharedHands) {
      const firstPlayer = hand.players.find((player) => player.playerProfileId === firstProfile.id);
      const secondPlayer = hand.players.find((player) => player.playerProfileId === secondProfile.id);
      if (!firstPlayer || !secondPlayer) {
        continue;
      }

      sharedSessionIds.add(hand.trackingSession.id);
      const potSize = Number(hand.potSize);
      if (!biggestPot || potSize > biggestPot.potSize) {
        biggestPot = {
          handId: hand.id,
          tableId: hand.tableId,
          potSize,
          boardCards: Array.isArray(hand.boardCards) ? hand.boardCards.map(String) : [],
          winners: Array.isArray(hand.winners) ? hand.winners.map(String) : [],
        };
      }

      firstEntries.push(toHeadToHeadEntry(firstPlayer, hand));
      secondEntries.push(toHeadToHeadEntry(secondPlayer, hand));
    }

    return {
      sharedHands: firstEntries.length,
      sharedSessions: sharedSessionIds.size,
      biggestPot,
      players: [
        summarizeHeadToHeadPlayer(firstProfile, firstEntries),
        summarizeHeadToHeadPlayer(secondProfile, secondEntries),
      ],
    };
  }

  async getTrackingStatus(guildId: string) {
    const trackedTables = await prisma.trackedTable.findMany({
      where: { guildId },
      include: {
        sessions: {
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        detectedAt: "desc",
      },
      take: 10,
    });

    return trackedTables.map((table) => ({
      tableId: table.tableId,
      state: table.state,
      detectedAt: table.detectedAt,
      lastHeartbeatAt: table.lastHeartbeatAt,
      endedAt: table.endedAt,
      sessionId: table.sessions[0]?.id ?? null,
      lastSessionStatus: table.sessions[0]?.status ?? null,
      sourceUrl: table.sourceUrl,
    }));
  }

  async getTrackedPlayers(guildId: string, tableId?: string) {
    const trackedTables = await prisma.trackedTable.findMany({
      where: {
        guildId,
        ...(tableId ? { tableId } : {}),
      },
      include: {
        sessions: {
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
          include: {
            rawEvents: {
              where: {
                eventType: {
                  in: ["socket_rup", "socket_registered"],
                },
              },
              orderBy: {
                occurredAt: "desc",
              },
              take: 10,
            },
          },
        },
      },
      orderBy: {
        detectedAt: "desc",
      },
      take: tableId ? 1 : 10,
    });

    const [defaultAliases, overrides] = await Promise.all([
      prisma.playerAlias.findMany({
        where: { guildId },
        include: { defaultPlayerProfile: true },
      }),
      prisma.trackedTablePlayerOverride.findMany({
        where: {
          trackedTableId: {
            in: trackedTables.map((table) => table.id),
          },
        },
        include: {
          playerProfile: true,
        },
      }),
    ]);

    const defaultAliasMap = new Map(
      defaultAliases.map((alias) => [
        alias.alias,
        alias.defaultPlayerProfile
          ? {
              displayName: alias.defaultPlayerProfile.displayName,
              discordUserId: alias.defaultPlayerProfile.discordUserId,
            }
          : null,
      ]),
    );
    const overrideMap = new Map(
      overrides.map((override) => [
        `${override.trackedTableId}:${override.alias}`,
        {
          displayName: override.playerProfile.displayName,
          discordUserId: override.playerProfile.discordUserId,
        },
      ]),
    );

    return trackedTables.map((table) => {
      const latestSession = table.sessions[0];
      const latestSnapshot = latestSession?.rawEvents.find((event) => extractPlayersFromRawEvent(event.payload).length > 0);
      const players = latestSnapshot ? extractPlayersFromRawEvent(latestSnapshot.payload) : [];

      return {
        tableId: table.tableId,
        state: table.state,
        players: players.map((playerAlias) => {
          const override = overrideMap.get(`${table.id}:${playerAlias}`);
          const fallback = defaultAliasMap.get(playerAlias) ?? null;
          const resolved = override ?? fallback;

          return {
            playerAlias,
            playerDisplayName: resolved?.displayName ?? null,
            linkedDiscordUserId: resolved?.discordUserId ?? null,
          };
        }),
      };
    });
  }

  async resetTracking(guildId: string, redisUrl: string) {
    const queueConnection = toBullConnection(redisUrl);
    const trackQueue = new Queue(queueNames.trackTable, { connection: queueConnection });
    const reconcileQueue = new Queue(queueNames.reconcilePokerNowHand, { connection: queueConnection });

    const deleted = await prisma.trackedTable.deleteMany({
      where: { guildId },
    });

    await trackQueue.drain(true);
    await reconcileQueue.drain(true);
    await trackQueue.close();
    await reconcileQueue.close();

    return deleted.count;
  }

  async removeTrackedTable(guildId: string, tableId: string, redisUrl: string) {
    const queueConnection = toBullConnection(redisUrl);
    const trackQueue = new Queue(queueNames.trackTable, { connection: queueConnection });
    const reconcileQueue = new Queue(queueNames.reconcilePokerNowHand, { connection: queueConnection });

    const trackJobId = `track-${guildId}-${tableId}`;
    const trackJob = await trackQueue.getJob(trackJobId);
    const trackJobState = trackJob ? await trackJob.getState() : null;
    let removedTrackJob = false;

    if (trackJob && trackJobState !== "active") {
      await trackJob.remove();
      removedTrackJob = true;
    }

    const reconcileJobs = await reconcileQueue.getJobs(["waiting", "delayed", "failed"], 0, 1000, false);
    let removedReconcileJobs = 0;
    for (const job of reconcileJobs) {
      if (job.data?.guildId === guildId && job.data?.tableId === tableId) {
        await job.remove();
        removedReconcileJobs += 1;
      }
    }

    const deleted = await prisma.trackedTable.deleteMany({
      where: {
        guildId,
        tableId,
      },
    });

    await trackQueue.close();
    await reconcileQueue.close();

    return {
      removed: deleted.count > 0,
      removedTrackJob,
      trackJobState,
      removedReconcileJobs,
    };
  }

  async getTrackingDebug(guildId: string, redisUrl: string) {
    const queueConnection = toBullConnection(redisUrl);
    const trackQueue = new Queue(queueNames.trackTable, { connection: queueConnection });
    const reconcileQueue = new Queue(queueNames.reconcilePokerNowHand, { connection: queueConnection });

    const [trackedTables, trackCounts, reconcileCounts] = await Promise.all([
      prisma.trackedTable.count({ where: { guildId } }),
      trackQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused"),
      reconcileQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused"),
    ]);

    const [failedTrackJob] = await trackQueue.getJobs(["failed"], 0, 0, false);
    const [failedReconcileJob] = await reconcileQueue.getJobs(["failed"], 0, 0, false);

    await trackQueue.close();
    await reconcileQueue.close();

    return {
      trackedTables,
      trackCounts,
      reconcileCounts,
      failedTrackJob: failedTrackJob
        ? {
            id: failedTrackJob.id,
            name: failedTrackJob.name,
            failedReason: failedTrackJob.failedReason ?? "unknown",
            finishedOn: failedTrackJob.finishedOn ?? null,
          }
        : null,
      failedReconcileJob: failedReconcileJob
        ? {
            id: failedReconcileJob.id,
            name: failedReconcileJob.name,
            failedReason: failedReconcileJob.failedReason ?? "unknown",
            finishedOn: failedReconcileJob.finishedOn ?? null,
          }
        : null,
    };
  }

  formatStatsResponse(stats: NonNullable<Awaited<ReturnType<CommandService["getStats"]>>>, filter: StatsFilter = {}) {
    if (stats.snapshots.length === 0) {
      return `No stats yet for player \`${stats.displayName}\` with aliases: ${stats.aliases.map((alias: (typeof stats.aliases)[number]) => alias.alias).join(", ") || "none linked"}`;
    }

    const lines = [
      `Player: ${stats.displayName}`,
      `Aliases: ${stats.aliases.map((alias: (typeof stats.aliases)[number]) => alias.alias).join(", ") || "none"}`,
    ];

    for (const snapshot of stats.snapshots) {
      lines.push(formatStatsLine(statsLabel(snapshot.gameType, snapshot.handednessBucket, filter), snapshot));
    }

    return lines.join("\n");
  }

  formatPlayerResponse(player: NonNullable<Awaited<ReturnType<CommandService["getPlayer"]>>>) {
    const snapshot = player.snapshots[0];
    return [
      `Player: ${player.displayName}`,
      `Discord: <@${player.discordUserId}>`,
      `Aliases: ${player.aliases.map((alias) => alias.alias).join(", ") || "none"}`,
      snapshot ? `Hands: ${snapshot.handsPlayed}` : "Hands: 0",
    ].join("\n");
  }

  private async ensureGuild(guildId: string) {
    await prisma.guild.upsert({
      where: { id: guildId },
      update: {},
      create: { id: guildId },
    });
  }

  private async getOrCreateProfileForDiscord(guildId: string, discordUserId: string, fallbackDisplayName: string) {
    const existing = await this.findProfileByDiscord(guildId, discordUserId);
    if (existing) {
      return existing;
    }

    const displayName = await this.findAvailableDisplayName(guildId, fallbackDisplayName.trim(), discordUserId);
    return prisma.playerProfile.create({
      data: {
        guildId,
        displayName,
        discordUserId,
      },
    });
  }

  private async setAliasDefaultByProfileId(guildId: string, alias: string, playerProfileId: string) {
    const normalizedAlias = normalizePokerNowAlias(alias);
    const existing = await prisma.playerAlias.findFirst({
      where: { guildId, normalizedAlias },
    });

    if (existing) {
      await prisma.playerAlias.update({
        where: { id: existing.id },
        data: { alias: alias.trim(), normalizedAlias, defaultPlayerProfileId: playerProfileId },
      });
      return;
    }

    await prisma.playerAlias.create({
      data: { guildId, alias: alias.trim(), normalizedAlias, defaultPlayerProfileId: playerProfileId },
    });
  }

  private async findProfileByDiscord(guildId: string, discordUserId: string) {
    return prisma.playerProfile.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId,
        },
      },
    });
  }

  private async requireProfileByDiscord(guildId: string, discordUserId: string) {
    const profile = await this.findProfileByDiscord(guildId, discordUserId);
    if (!profile) {
      throw new Error(`Discord user <@${discordUserId}> does not have a player record yet`);
    }

    return profile;
  }

  private async requireProfileByDisplayName(guildId: string, displayName: string) {
    const profile = await prisma.playerProfile.findUnique({
      where: {
        guildId_displayName: {
          guildId,
          displayName: displayName.trim(),
        },
      },
    });

    if (!profile) {
      throw new Error(`Player \`${displayName.trim()}\` not found`);
    }

    return profile;
  }

  private async requireTrackedTable(guildId: string, tableId: string) {
    const trackedTable = await prisma.trackedTable.findUnique({
      where: {
        guildId_tableId: {
          guildId,
          tableId: tableId.trim(),
        },
      },
    });

    if (!trackedTable) {
      throw new Error(`Tracked table \`${tableId.trim()}\` not found`);
    }

    return trackedTable;
  }

  private async findAvailableDisplayName(guildId: string, requestedDisplayName: string, discriminator: string, currentProfileId?: string) {
    const existing = await prisma.playerProfile.findUnique({
      where: {
        guildId_displayName: {
          guildId,
          displayName: requestedDisplayName,
        },
      },
    });

    return existing && existing.id !== currentProfileId ? `${requestedDisplayName} (${discriminator.slice(-4)})` : requestedDisplayName;
  }
}

function extractPlayersFromRawEvent(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (typeof data !== "object" || data === null) {
    return [];
  }

  const players = findPlayersRecord(data);
  if (!players) {
    return [];
  }

  return Object.values(players)
    .flatMap((player) => {
      if (typeof player !== "object" || player === null) {
        return [];
      }

      const record = player as Record<string, unknown>;
      const alias =
        typeof record.name === "string"
          ? record.name
          : typeof record.playerName === "string"
            ? record.playerName
            : typeof record.id === "string"
              ? record.id
              : null;
      return alias ? [alias] : [];
    })
    .filter(Boolean);
}

function parseAliasList(input: string) {
  const aliases = input
    .split(/[\n,]+/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  const normalizedAliases = new Set<string>();
  const uniqueAliases: string[] = [];

  for (const alias of aliases) {
    const normalizedAlias = normalizePokerNowAlias(alias);
    if (!normalizedAliases.has(normalizedAlias)) {
      normalizedAliases.add(normalizedAlias);
      uniqueAliases.push(alias);
    }
  }

  return uniqueAliases;
}

function findPlayersRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directPlayers = record.players;
  if (directPlayers && typeof directPlayers === "object" && !Array.isArray(directPlayers)) {
    return directPlayers as Record<string, unknown>;
  }

  for (const nested of Object.values(record)) {
    const found = findPlayersRecord(nested);
    if (found) {
      return found;
    }
  }

  return null;
}

export function statsDimensionKeyForFilter(filter: StatsFilter) {
  const gameType = filter.gameType?.trim();
  if (gameType && filter.handedness) {
    return `gameType:${gameType}|handedness:${filter.handedness}`;
  }
  if (gameType) {
    return `gameType:${gameType}`;
  }
  if (filter.handedness) {
    return `handedness:${filter.handedness}`;
  }
  return "overall";
}

function statsDimensionKeysForFilter(filter: StatsFilter) {
  if (filter.gameType && !filter.handedness) {
    return [
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "HEADS_UP" }),
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "MULTIWAY" }),
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "THREE_HANDED" }),
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "FOUR_HANDED" }),
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "FIVE_HANDED" }),
      statsDimensionKeyForFilter({ gameType: filter.gameType, handedness: "SIX_PLUS" }),
    ];
  }

  if (filter.gameType || filter.handedness) {
    return [statsDimensionKeyForFilter(filter)];
  }

  return ["handedness:HEADS_UP", "handedness:MULTIWAY"];
}

export function statsFilterLabel(filter: StatsFilter = {}) {
  const parts = [];
  if (filter.gameType?.trim()) {
    parts.push(filter.gameType.trim());
  }
  if (filter.handedness) {
    parts.push(handednessLabel(filter.handedness));
  }
  return parts.join(" ");
}

function statsLabel(gameType: string | null, handednessBucket: HandednessBucket | null, filter: StatsFilter) {
  if (gameType || handednessBucket) {
    return [gameType, handednessBucket ? handednessLabel(handednessBucket) : null].filter(Boolean).join(" ");
  }

  return statsFilterLabel(filter) || "Overall";
}

export function handednessLabel(bucket: HandednessBucket) {
  switch (bucket) {
    case "HEADS_UP":
      return "Heads Up";
    case "MULTIWAY":
      return "Multiway";
    case "THREE_HANDED":
      return "3-Handed";
    case "FOUR_HANDED":
      return "4-Handed";
    case "FIVE_HANDED":
      return "5-Handed";
    case "SIX_PLUS":
      return "6+";
  }
}

function formatStatsLine(label: string, snapshot: { handsPlayed: number; vpip: number; pfr: number; threeBet: number; fourBet: number; cbet: number; foldToCbet: number }) {
  return `${label}: ${snapshot.handsPlayed} hands | VPIP ${formatPercent(snapshot.vpip)} | PFR ${formatPercent(snapshot.pfr)} | 3Bet ${formatPercent(snapshot.threeBet)} | 4Bet ${formatPercent(snapshot.fourBet)} | CBet ${formatPercent(snapshot.cbet)} | Fold to CBet ${formatPercent(snapshot.foldToCbet)}`;
}

interface SessionHandEntry {
  vpip: boolean;
  pfr: boolean;
  profit: number;
  bigBlindAmount?: number;
  isBombPot: boolean;
  playerProfileId: string | null;
  playerAlias: string;
  actions: Array<{
    playerProfileId: string | null;
    playerAlias: string;
    street: string;
    actionType: string;
    sequence: number;
  }>;
}

interface HeadToHeadHandEntry extends SessionHandEntry {
  profitTotalBb: number;
}

function calculateSessionStats(entries: SessionHandEntry[]) {
  const handsPlayed = entries.length;
  const rateEntries = entries.filter((entry) => !entry.isBombPot);
  const vpipCount = rateEntries.filter((entry) => entry.vpip).length;
  const pfrCount = rateEntries.filter((entry) => entry.pfr).length;
  const actionStats = calculateActionStats(
    rateEntries.map((entry) => ({
      actions: entry.actions,
      actor: {
        playerProfileId: entry.playerProfileId,
        playerAlias: entry.playerAlias,
      },
    })),
  );

  return {
    handsPlayed,
    vpip: rateEntries.length === 0 ? 0 : vpipCount / rateEntries.length,
    pfr: rateEntries.length === 0 ? 0 : pfrCount / rateEntries.length,
    threeBet: rate(actionStats.threeBets, actionStats.threeBetOpportunities),
    fourBet: rate(actionStats.fourBets, actionStats.fourBetOpportunities),
    cbet: rate(actionStats.cbets, actionStats.cbetOpportunities),
    foldToCbet: rate(actionStats.foldsToCbet, actionStats.foldToCbetOpportunities),
  };
}

function rate(count: number, opportunities: number) {
  return opportunities === 0 ? 0 : count / opportunities;
}

function gameCountFromSyncStatus(status: string | null) {
  const match = status?.match(/^ok:(\d+):\d+$/);
  return match ? Number(match[1]) : null;
}

function toHeadToHeadEntry(
  player: {
    playerProfileId: string | null;
    playerAlias: string;
    vpip: boolean;
    pfr: boolean;
    profit: unknown;
  },
  hand: {
    bigBlindAmount: unknown;
    isBombPot: boolean;
    actions: Array<{
      playerProfileId: string | null;
      playerAlias: string;
      street: string;
      actionType: string;
      sequence: number;
    }>;
  },
): HeadToHeadHandEntry {
  const profit = Number(player.profit);
  const bigBlindAmount = hand.bigBlindAmount ? Number(hand.bigBlindAmount) : undefined;
  return {
    vpip: player.vpip,
    pfr: player.pfr,
    profit,
    profitTotalBb: bigBlindAmount && bigBlindAmount > 0 ? profit / bigBlindAmount : profit,
    bigBlindAmount,
    isBombPot: hand.isBombPot,
    playerProfileId: player.playerProfileId,
    playerAlias: player.playerAlias,
    actions: hand.actions,
  };
}

function summarizeHeadToHeadPlayer(
  profile: { displayName: string; discordUserId: string },
  entries: HeadToHeadHandEntry[],
) {
  const profitTotal = entries.reduce((sum, entry) => sum + entry.profit, 0);
  const profitTotalBb = entries.reduce((sum, entry) => sum + entry.profitTotalBb, 0);
  return {
    displayName: profile.displayName,
    discordUserId: profile.discordUserId,
    profitTotal: Number(profitTotal.toFixed(2)),
    profitTotalBb: Number(profitTotalBb.toFixed(2)),
    biggestWin: Math.max(0, ...entries.map((entry) => entry.profit)),
    biggestLoss: Math.min(0, ...entries.map((entry) => entry.profit)),
    stats: calculateSessionStats(entries),
  };
}
