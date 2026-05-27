import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __pokernowPrisma__: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    log: ["warn", "error"],
  });
}

function getPrismaClient() {
  // In watch-mode, tsx reloads modules in-process. Reusing a cached PrismaClient
  // across schema/client regenerations can leave us with stale model delegates.
  if (process.env.NODE_ENV !== "production") {
    return createPrismaClient();
  }

  return globalThis.__pokernowPrisma__ ?? createPrismaClient();
}

export const prisma = getPrismaClient();

if (process.env.NODE_ENV === "production") {
  globalThis.__pokernowPrisma__ = prisma;
}
