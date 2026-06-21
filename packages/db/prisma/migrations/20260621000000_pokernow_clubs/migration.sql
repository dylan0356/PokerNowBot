CREATE TABLE "PokerNowClub" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "refreshPlayerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PokerNowClub_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PokerNowClub_guildId_clubId_key" ON "PokerNowClub"("guildId", "clubId");
CREATE INDEX "PokerNowClub_enabled_idx" ON "PokerNowClub"("enabled");

ALTER TABLE "PokerNowClub" ADD CONSTRAINT "PokerNowClub_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
