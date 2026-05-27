import {
  EmbedBuilder,
  REST,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type User,
} from "discord.js";
import { extractPokerNowTables } from "@pokernow/shared";
import { CommandService, handednessLabel, statsDimensionKeyForFilter, statsFilterLabel, type StatsFilter } from "./command-service.js";
import type { HandednessBucket } from "@pokernow/shared";

const ADMIN_USER_IDS = new Set(["251557870603075586"]);
const embedColor = 0x1f8b4c;
const exactHandednessBuckets: HandednessBucket[] = ["THREE_HANDED", "FOUR_HANDED", "FIVE_HANDED", "SIX_PLUS"];
const handednessChoices: Array<{ name: string; value: HandednessBucket }> = [
  { name: "Heads Up", value: "HEADS_UP" },
  { name: "Multiway", value: "MULTIWAY" },
  { name: "3-Handed", value: "THREE_HANDED" },
  { name: "4-Handed", value: "FOUR_HANDED" },
  { name: "5-Handed", value: "FIVE_HANDED" },
  { name: "6+", value: "SIX_PLUS" },
];

const commands = [
  new SlashCommandBuilder().setName("link-pokernow").setDescription("Link your PokerNow alias").addStringOption((option) =>
    option.setName("alias").setDescription("PokerNow screen name").setRequired(true),
  ),
  new SlashCommandBuilder().setName("unlink-pokernow").setDescription("Unlink a PokerNow alias").addStringOption((option) =>
    option.setName("alias").setDescription("PokerNow screen name").setRequired(true),
  ),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show player stats")
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(false))
    .addStringOption((option) =>
      option.setName("handedness").setDescription("Heads up, multiway, or exact table size").setRequired(false).addChoices(...handednessChoices),
    )
    .addStringOption((option) => option.setName("game_type").setDescription("Exact game type, for example No Limit Hold'em").setRequired(false)),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show current leaderboard")
    .addStringOption((option) =>
      option.setName("handedness").setDescription("Heads up, multiway, or exact table size").setRequired(false).addChoices(...handednessChoices),
    )
    .addStringOption((option) => option.setName("game_type").setDescription("Exact game type, for example No Limit Hold'em").setRequired(false)),
  new SlashCommandBuilder().setName("sessions").setDescription("Show recent sessions").addUserOption((option) =>
    option.setName("user").setDescription("Discord user").setRequired(false),
  ),
  new SlashCommandBuilder()
    .setName("session-stats")
    .setDescription("Show all player stats for one PokerNow table/session")
    .addStringOption((option) => option.setName("link").setDescription("PokerNow game link or table id").setRequired(true)),
  new SlashCommandBuilder().setName("graph").setDescription("Show cumulative profit graph").addUserOption((option) =>
    option.setName("user").setDescription("Discord user").setRequired(false),
  ),
  new SlashCommandBuilder()
    .setName("players")
    .setDescription("Show players currently observed on tracked PokerNow tables")
    .addStringOption((option) => option.setName("table_id").setDescription("PokerNow table id").setRequired(false)),
  new SlashCommandBuilder().setName("tracking-status").setDescription("Show PokerNow tracking status for this server"),
  new SlashCommandBuilder()
    .setName("tracking-reset")
    .setDescription("Delete all PokerNow tracking for this server"),
  new SlashCommandBuilder().setName("tracking-debug").setDescription("Show queue and tracking debug info for this server"),
  new SlashCommandBuilder()
    .setName("player-create")
    .setDescription("Create or update a Discord player")
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(true))
    .addStringOption((option) => option.setName("display_name").setDescription("Optional player display name").setRequired(false)),
  new SlashCommandBuilder()
    .setName("player-alias-add")
    .setDescription("Assign one or more guild default alias owners")
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(true))
    .addStringOption((option) => option.setName("alias").setDescription("PokerNow alias, or comma-separated aliases").setRequired(true)),
  new SlashCommandBuilder()
    .setName("player-alias-remove")
    .setDescription("Remove a guild default alias mapping")
    .addStringOption((option) => option.setName("alias").setDescription("PokerNow alias").setRequired(true)),
  new SlashCommandBuilder()
    .setName("player-alias-set-default")
    .setDescription("Set the guild default owner for an alias")
    .addStringOption((option) => option.setName("alias").setDescription("PokerNow alias").setRequired(true))
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(true)),
  new SlashCommandBuilder()
    .setName("player-override-set")
    .setDescription("Override alias ownership for one tracked table")
    .addStringOption((option) => option.setName("table_id").setDescription("PokerNow table id").setRequired(true))
    .addStringOption((option) => option.setName("alias").setDescription("PokerNow alias").setRequired(true))
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(true)),
  new SlashCommandBuilder()
    .setName("player-override-clear")
    .setDescription("Clear a table-specific alias override")
    .addStringOption((option) => option.setName("table_id").setDescription("PokerNow table id").setRequired(true))
    .addStringOption((option) => option.setName("alias").setDescription("PokerNow alias").setRequired(true)),
  new SlashCommandBuilder()
    .setName("player-show")
    .setDescription("Show a Discord player")
    .addUserOption((option) => option.setName("user").setDescription("Discord user").setRequired(true)),
  new SlashCommandBuilder().setName("aliases").setDescription("List guild alias ownership"),
  new SlashCommandBuilder().setName("unresolved-aliases").setDescription("List aliases without a resolved player owner"),
  new SlashCommandBuilder()
    .setName("player-recompute")
    .setDescription("Recompute effective player attribution for historical hands")
    .addStringOption((option) => option.setName("table_id").setDescription("Optional PokerNow table id").setRequired(false)),
].map((command) => command.toJSON());

export async function registerSlashCommands(token: string, clientId: string, guildIds: string[]) {
  if (!token || !clientId) {
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);
  if (guildIds.length === 0) {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    return;
  }

  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  }
}

export function registerInteractionHandler(client: Client, commandService: CommandService, redisUrl: string) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.guildId) {
      return;
    }

    await routeCommand(interaction, commandService, redisUrl);
  });
}

async function routeCommand(interaction: ChatInputCommandInteraction, commandService: CommandService, redisUrl: string) {
  const guildId = interaction.guildId!;
  try {
    switch (interaction.commandName) {
      case "link-pokernow": {
        const alias = interaction.options.getString("alias", true);
        const displayName = interaction.user.globalName ?? interaction.user.username;
        await commandService.linkAlias(guildId, interaction.user.id, alias, displayName ?? interaction.user.username);
        await interaction.reply(`Linked PokerNow alias \`${alias}\``);
        return;
      }
      case "unlink-pokernow": {
        const alias = interaction.options.getString("alias", true);
        const removed = await commandService.unlinkAlias(guildId, interaction.user.id, alias);
        await interaction.reply(removed ? `Unlinked PokerNow alias \`${alias}\`` : `Alias \`${alias}\` was not linked to you`);
        return;
      }
      case "stats": {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const filter = statsFilterFromInteraction(interaction);
        if (filter.gameType) {
          const embed = await buildStatsEmbed(commandService, guildId, targetUser, filter.gameType, filter, 0, 1);
          await interaction.reply(embed ? { embeds: [embed] } : "No Discord player or stats found");
          return;
        }

        const gameTypes = await commandService.listStatsGameTypes(guildId, targetUser.id);
        if (gameTypes.length === 0) {
          const stats = await commandService.getStats(guildId, targetUser.id, filter);
          await interaction.reply(stats ? { embeds: [buildStatsFallbackEmbed(stats, filter)] } : "No Discord player or stats found");
          return;
        }

        const pages = await Promise.all(
          gameTypes.map(async (gameType, index) => {
            return buildStatsEmbed(commandService, guildId, targetUser, gameType, filter, index, gameTypes.length);
          }),
        );
        await replyWithReactionPages(interaction, pages.filter((page): page is EmbedBuilder => Boolean(page)));
        return;
      }
      case "leaderboard": {
        const filter = statsFilterFromInteraction(interaction);
        const gameTypes = filter.gameType ? [filter.gameType] : await commandService.listStatsGameTypes(guildId);
        if (gameTypes.length === 0) {
          await interaction.reply("No leaderboard game data yet");
          return;
        }

        const pages = await Promise.all(
          gameTypes.map(async (gameType, index) => {
            const pageFilter = { ...filter, gameType };
            return formatLeaderboardPage(commandService, guildId, pageFilter, index, gameTypes.length);
          }),
        );
        await replyWithReactionPages(interaction, pages);
        return;
      }
      case "sessions": {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const sessions = await commandService.getSessions(guildId, targetUser.id);
        if (!sessions || sessions.length === 0) {
          await interaction.reply("No sessions found");
          return;
        }

        const body = sessions
          .map(
            (session: (typeof sessions)[number]) =>
              `${session.startedAt.toISOString().slice(0, 16)} - ${session.finishedAt.toISOString().slice(0, 16)} | ${session.tableId} | ${session.handsPlayed} hands`,
          )
          .join("\n");
        await interaction.reply(body);
        return;
      }
      case "session-stats": {
        const tableInput = interaction.options.getString("link", true);
        const tableId = tableIdFromInput(tableInput);
        const sessionStats = await commandService.getSessionStats(guildId, tableId);
        if (!sessionStats) {
          await interaction.reply(`No tracked session found for \`${tableId}\``);
          return;
        }

        if (sessionStats.players.length === 0) {
          await interaction.reply(`No player stats found for \`${tableId}\``);
          return;
        }

        await interaction.reply({ embeds: [buildSessionStatsEmbed(sessionStats)] });
        return;
      }
      case "graph": {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const graphUrl = await commandService.getGraph(guildId, targetUser.id);
        if (!graphUrl) {
          await interaction.reply("No graph data found");
          return;
        }

        await interaction.reply(graphUrl.length <= 2000 ? graphUrl : "Graph data is too large to render as a Discord link");
        return;
      }
      case "players": {
        const tableId = interaction.options.getString("table_id") ?? undefined;
        const trackedPlayers = await commandService.getTrackedPlayers(guildId, tableId);
        if (trackedPlayers.length === 0) {
          await interaction.reply(tableId ? `No tracked table found for \`${tableId}\`` : "No tracked PokerNow tables found");
          return;
        }

        const body = trackedPlayers
          .map((table) => {
            const header = `${table.tableId} | ${table.state}`;
            if (table.players.length === 0) {
              return `${header}\nNo players observed yet`;
            }

            const players = table.players
              .map((player) =>
                player.playerDisplayName
                  ? `- ${player.playerAlias} -> ${player.playerDisplayName}${player.linkedDiscordUserId ? ` (<@${player.linkedDiscordUserId}>)` : ""}`
                  : `- ${player.playerAlias}`,
              )
              .join("\n");

            return `${header}\n${players}`;
          })
          .join("\n\n");

        await interaction.reply(body);
        return;
      }
      case "tracking-status": {
        const trackedTables = await commandService.getTrackingStatus(guildId);
        if (trackedTables.length === 0) {
          await interaction.reply("No PokerNow tables have been tracked in this server yet");
          return;
        }

        const body = trackedTables
          .map((table) => {
            const parts = [
              `${table.tableId}`,
              table.state,
              `detected ${table.detectedAt.toISOString().slice(0, 16)}`,
            ];

            if (table.lastHeartbeatAt) {
              parts.push(`heartbeat ${table.lastHeartbeatAt.toISOString().slice(0, 16)}`);
            }

            if (table.endedAt) {
              parts.push(`ended ${table.endedAt.toISOString().slice(0, 16)}`);
            }

            if (table.lastSessionStatus) {
              parts.push(`session ${table.lastSessionStatus}`);
            }

            return `- ${parts.join(" | ")}`;
          })
          .join("\n");

        await interaction.reply(body);
        return;
      }
      case "tracking-reset": {
        if (!isAdminUser(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "You need `Manage Server` to use this command",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const removedCount = await commandService.resetTracking(guildId, redisUrl);
        await interaction.reply({
          content: `Removed PokerNow tracking for ${removedCount} table(s) in this server`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case "tracking-debug": {
        if (!isAdminUser(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "You need `Manage Server` to use this command",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const debug = await commandService.getTrackingDebug(guildId, redisUrl);
        await interaction.reply({
          content: [
            `Tracked tables: ${debug.trackedTables}`,
            `track-table queue: waiting=${debug.trackCounts.waiting ?? 0}, active=${debug.trackCounts.active ?? 0}, delayed=${debug.trackCounts.delayed ?? 0}, failed=${debug.trackCounts.failed ?? 0}`,
            `reconcile queue: waiting=${debug.reconcileCounts.waiting ?? 0}, active=${debug.reconcileCounts.active ?? 0}, delayed=${debug.reconcileCounts.delayed ?? 0}, failed=${debug.reconcileCounts.failed ?? 0}`,
            debug.failedTrackJob
              ? `last track-table failure: ${debug.failedTrackJob.id} | ${debug.failedTrackJob.failedReason}`
              : "last track-table failure: none",
            debug.failedReconcileJob
              ? `last reconcile failure: ${debug.failedReconcileJob.id} | ${debug.failedReconcileJob.failedReason}`
              : "last reconcile failure: none",
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case "player-create": {
        ensureAdmin(interaction);
        const user = interaction.options.getUser("user", true);
        const displayName = interaction.options.getString("display_name") ?? undefined;
        const player = await commandService.createPlayerForDiscordUser(guildId, user.id, displayNameForUser(user), displayName);
        await interaction.reply(`Player \`${player.displayName}\` is <@${user.id}>`);
        return;
      }
      case "player-alias-add": {
        ensureAdmin(interaction);
        const user = interaction.options.getUser("user", true);
        const aliasesInput = interaction.options.getString("alias", true);
        const result = await commandService.addAliasesToDiscordUser(guildId, user.id, displayNameForUser(user), aliasesInput);
        await interaction.reply(
          `Assigned ${result.aliases.length} alias(es) to <@${user.id}> / \`${result.profile.displayName}\`: ${result.aliases.map((alias) => `\`${alias}\``).join(", ")}`,
        );
        return;
      }
      case "player-alias-remove": {
        ensureAdmin(interaction);
        const alias = interaction.options.getString("alias", true);
        const removed = await commandService.removeAlias(guildId, alias);
        await interaction.reply(removed ? `Removed guild default alias mapping for \`${alias}\`` : `Alias \`${alias}\` was not mapped`);
        return;
      }
      case "player-alias-set-default": {
        ensureAdmin(interaction);
        const alias = interaction.options.getString("alias", true);
        const user = interaction.options.getUser("user", true);
        const profile = await commandService.setAliasDefaultForDiscordUser(guildId, alias, user.id, displayNameForUser(user));
        await interaction.reply(`Set guild default owner for \`${alias}\` to <@${user.id}> / \`${profile.displayName}\``);
        return;
      }
      case "player-override-set": {
        ensureAdmin(interaction);
        const tableId = interaction.options.getString("table_id", true);
        const alias = interaction.options.getString("alias", true);
        const user = interaction.options.getUser("user", true);
        const result = await commandService.setTableOverrideForDiscordUser(guildId, tableId, alias, user.id, displayNameForUser(user));
        await interaction.reply(`Set table override for \`${alias}\` on \`${tableId}\` to <@${user.id}> / \`${result.profile.displayName}\``);
        return;
      }
      case "player-override-clear": {
        ensureAdmin(interaction);
        const tableId = interaction.options.getString("table_id", true);
        const alias = interaction.options.getString("alias", true);
        const cleared = await commandService.clearTableOverride(guildId, tableId, alias);
        await interaction.reply(cleared ? `Cleared table override for \`${alias}\` on \`${tableId}\`` : `No table override found for \`${alias}\` on \`${tableId}\``);
        return;
      }
      case "player-show": {
        const user = interaction.options.getUser("user", true);
        const profile = await commandService.getPlayerByDiscordUser(guildId, user.id);
        await interaction.reply(profile ? commandService.formatPlayerResponse(profile) : `No player record for <@${user.id}>`);
        return;
      }
      case "aliases": {
        const aliases = await commandService.listAliases(guildId);
        await interaction.reply(
          aliases.length === 0
            ? "No aliases configured"
            : aliases
                .map((alias) => `${alias.alias} -> ${alias.defaultPlayerProfile?.displayName ?? "unassigned"}`)
                .join("\n"),
        );
        return;
      }
      case "unresolved-aliases": {
        const aliases = await commandService.listUnresolvedAliases(guildId);
        await interaction.reply(aliases.length === 0 ? "No unresolved aliases" : `Unresolved aliases:\n${aliases.join("\n")}`);
        return;
      }
      case "player-recompute": {
        ensureAdmin(interaction);
        const tableId = interaction.options.getString("table_id") ?? undefined;
        const result = await commandService.recomputeAliasAttribution(guildId, redisUrl, tableId);
        await interaction.reply(
          `Recomputed attribution for ${result.trackedTables} tracked table(s); updated ${result.updatedHands} hand rows and ${result.updatedActions} action rows; queued stats refresh`,
        );
        return;
      }
      default:
        await interaction.reply("Unknown command");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
}

function isAdminUser(userId: string) {
  return ADMIN_USER_IDS.has(userId);
}

function ensureAdmin(interaction: ChatInputCommandInteraction) {
  if (!isAdminUser(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error("You need `Manage Server` to use this command");
  }
}

function displayNameForUser(user: User) {
  return user.globalName ?? user.username;
}

function statsFilterFromInteraction(interaction: ChatInputCommandInteraction): StatsFilter {
  return {
    handedness: (interaction.options.getString("handedness") as HandednessBucket | null) ?? undefined,
    gameType: interaction.options.getString("game_type")?.trim() || undefined,
  };
}

function tableIdFromInput(input: string) {
  return extractPokerNowTables(input)[0]?.tableId ?? input.trim();
}

function buildSessionStatsEmbed(sessionStats: NonNullable<Awaited<ReturnType<CommandService["getSessionStats"]>>>) {
  const description = [
    sessionStats.startedAt && sessionStats.finishedAt
      ? `${sessionStats.startedAt.toISOString().slice(0, 16)} - ${sessionStats.finishedAt.toISOString().slice(0, 16)}`
      : null,
    `${sessionStats.handCount} hands`,
  ]
    .filter(Boolean)
    .join("\n");
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${sessionStats.tableId} | ${sessionStats.state}`)
    .setDescription(description);

  for (const player of sessionStats.players.slice(0, 25)) {
    embed.addFields({
      name: `${player.displayName}${player.discordUserId ? ` (<@${player.discordUserId}>)` : ""}`,
      value: [
        `Aliases: ${player.aliases.join(", ")}`,
        `Hands: ${player.stats.handsPlayed}`,
        `VPIP: ${percent(player.stats.vpip)} | PFR: ${percent(player.stats.pfr)}`,
        `3Bet: ${percent(player.stats.threeBet)} | 4Bet: ${percent(player.stats.fourBet)}`,
        `CBet: ${percent(player.stats.cbet)} | Fold to CBet: ${percent(player.stats.foldToCbet)}`,
      ].join("\n"),
    });
  }

  if (sessionStats.players.length > 25) {
    embed.setFooter({ text: `Showing 25 of ${sessionStats.players.length} players` });
  }

  return embed;
}

async function buildStatsEmbed(
  commandService: CommandService,
  guildId: string,
  targetUser: User,
  gameType: string,
  filter: StatsFilter,
  pageIndex: number,
  pageCount: number,
) {
  const stats = await commandService.getStats(guildId, targetUser.id, { ...filter, gameType });
  if (!stats) {
    return null;
  }

  const aliases = stats.aliases.map((alias) => alias.alias).join(", ") || "none";
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(gameType)
    .setAuthor({ name: stats.displayName })
    .setDescription(`Aliases: ${aliases}`);

  const mainBuckets: HandednessBucket[] = filter.handedness ? [filter.handedness] : ["HEADS_UP", "MULTIWAY"];
  for (const bucket of mainBuckets) {
    addStatsField(embed, handednessLabel(bucket), snapshotFor(stats, gameType, bucket), !filter.handedness);
  }

  if (!filter.handedness || filter.handedness === "MULTIWAY") {
    embed.addFields({ name: "\u200b", value: "------------\nMultiway breakdown" });
    for (const bucket of exactHandednessBuckets) {
      addStatsField(embed, handednessLabel(bucket), snapshotFor(stats, gameType, bucket), true);
    }
  }

  return embed;
}

function buildStatsFallbackEmbed(stats: NonNullable<Awaited<ReturnType<CommandService["getStats"]>>>, filter: StatsFilter) {
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(statsFilterLabel(filter) || "Stats")
    .setAuthor({ name: stats.displayName })
    .setDescription(`Aliases: ${stats.aliases.map((alias) => alias.alias).join(", ") || "none"}`);

  for (const snapshot of stats.snapshots) {
    addStatsField(embed, handednessLabel(snapshot.handednessBucket ?? "HEADS_UP"), snapshot);
  }

  return embed;
}

function snapshotFor(stats: NonNullable<Awaited<ReturnType<CommandService["getStats"]>>>, gameType: string, handedness: HandednessBucket) {
  return stats.snapshots.find((snapshot) => snapshot.dimensionKey === statsDimensionKeyForFilter({ gameType, handedness }));
}

function addStatsField(
  embed: EmbedBuilder,
  label: string,
  snapshot: { handsPlayed: number; vpip: number; pfr: number; threeBet: number; fourBet: number; cbet: number; foldToCbet: number } | undefined,
  inline = false,
) {
  embed.addFields({
    name: label,
    value: snapshot ? statsValue(snapshot) : statsValue(),
    inline,
  });
}

function statsValue(snapshot?: { handsPlayed: number; vpip: number; pfr: number; threeBet: number; fourBet: number; cbet: number; foldToCbet: number }) {
  const row = snapshot ?? { handsPlayed: 0, vpip: 0, pfr: 0, threeBet: 0, fourBet: 0, cbet: 0, foldToCbet: 0 };
  return [
    `Hands ${row.handsPlayed}`,
    `VPIP ${percent(row.vpip)} | PFR ${percent(row.pfr)}`,
    `3B ${percent(row.threeBet)} | 4B ${percent(row.fourBet)}`,
    `CB ${percent(row.cbet)} | FvCB ${percent(row.foldToCbet)}`,
  ].join("\n");
}

async function formatLeaderboardPage(commandService: CommandService, guildId: string, filter: StatsFilter, pageIndex: number, pageCount: number) {
  const sections = filter.handedness
    ? [{ label: statsFilterLabel(filter), rows: await commandService.getLeaderboard(guildId, filter) }]
    : [
        { label: handednessLabel("HEADS_UP"), rows: await commandService.getLeaderboard(guildId, { ...filter, handedness: "HEADS_UP" }) },
        { label: handednessLabel("MULTIWAY"), rows: await commandService.getLeaderboard(guildId, { ...filter, handedness: "MULTIWAY" }) },
      ];

  const title = pageCount > 1 && filter.gameType ? `${filter.gameType} (${pageIndex + 1}/${pageCount})` : filter.gameType || "Leaderboard";
  const embed = new EmbedBuilder().setColor(embedColor).setTitle(title);

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      embed.addFields({ name: "\u200b", value: "\u200b\n\u200b\n\u200b" });
    }

    embed.addFields({
      name: section.label,
      value:
        section.rows.length === 0
          ? "No data"
          : section.rows
              .map(
                (entry: (typeof section.rows)[number], index: number) =>
                  `**${index + 1}. ${entry.playerProfile.displayName}** (<@${entry.playerProfile.discordUserId}>) - ${entry.handsPlayed} hands | VPIP ${percent(entry.vpip)} | PFR ${percent(entry.pfr)}`,
              )
              .join("\n"),
    });
  });

  return embed;
}

async function replyWithReactionPages(interaction: ChatInputCommandInteraction, pages: EmbedBuilder[]) {
  if (pages.length <= 1) {
    await interaction.reply(pages[0] ? { embeds: [pages[0]] } : "No data");
    return;
  }

  let pageIndex = 0;
  await interaction.reply({ embeds: [pages[pageIndex]] });
  const message = await interaction.fetchReply();
  await message.react("⬅️").catch(() => undefined);
  await message.react("➡️").catch(() => undefined);

  const collector = message.createReactionCollector({
    filter: (reaction, user) => ["⬅️", "➡️"].includes(reaction.emoji.name ?? "") && user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on("collect", async (reaction, user) => {
    pageIndex = reaction.emoji.name === "⬅️" ? (pageIndex - 1 + pages.length) % pages.length : (pageIndex + 1) % pages.length;
    await interaction.editReply({ embeds: [pages[pageIndex]] });
    await reaction.users.remove(user).catch(() => undefined);
  });
}

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}
