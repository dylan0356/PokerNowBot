import { prisma } from "@pokernow/db";
import type { FastifyInstance } from "fastify";

export async function registerStatsRoutes(app: FastifyInstance) {
  app.get("/guilds/:guildId/players/:discordUserId/stats", async (request, reply) => {
    const { guildId, discordUserId } = request.params as { guildId: string; discordUserId: string };

    const profile = await prisma.playerProfile.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId,
        },
      },
      include: {
        snapshots: {
          where: {
            scope: "OVERALL",
            dimensionKey: "overall",
          },
        },
        aliases: true,
      },
    });

    if (!profile) {
      return reply.code(404).send({ error: "Discord user not found" });
    }

    return {
      playerProfileId: profile.id,
      displayName: profile.displayName,
      aliases: profile.aliases.map((alias: (typeof profile.aliases)[number]) => alias.alias),
      snapshot: profile.snapshots[0] ?? null,
    };
  });
}
