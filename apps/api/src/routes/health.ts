import type { FastifyInstance } from "fastify";

export async function registerHealthRoute(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));
}
