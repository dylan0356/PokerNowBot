-- CreateEnum
CREATE TYPE "TrackingState" AS ENUM ('DETECTED', 'ACTIVE', 'RECONNECTING', 'ENDED', 'FAILED');

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedTable" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "state" "TrackingState" NOT NULL DEFAULT 'DETECTED',
    "detectedById" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "TrackedTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingSession" (
    "id" TEXT NOT NULL,
    "trackedTableId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "status" "TrackingState" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "TrackingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerIdentity" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAlias" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerIdentityId" TEXT,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTableEvent" (
    "id" TEXT NOT NULL,
    "trackingSessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tableId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTableEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hand" (
    "id" TEXT NOT NULL,
    "trackingSessionId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "buttonSeat" INTEGER,
    "smallBlindAlias" TEXT,
    "bigBlindAlias" TEXT,
    "boardCards" JSONB NOT NULL,
    "winners" JSONB NOT NULL,
    "potSize" DECIMAL(12,2) NOT NULL,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandPlayer" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "playerIdentityId" TEXT,
    "playerAlias" TEXT NOT NULL,
    "seat" INTEGER,
    "position" TEXT,
    "stackStart" DECIMAL(12,2),
    "stackEnd" DECIMAL(12,2),
    "vpip" BOOLEAN NOT NULL DEFAULT false,
    "pfr" BOOLEAN NOT NULL DEFAULT false,
    "profit" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "HandPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandAction" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "playerIdentityId" TEXT,
    "playerAlias" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "sequence" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsSnapshot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerIdentityId" TEXT NOT NULL,
    "handsPlayed" INTEGER NOT NULL,
    "vpip" DOUBLE PRECISION NOT NULL,
    "pfr" DOUBLE PRECISION NOT NULL,
    "profitTotal" DECIMAL(12,2) NOT NULL,
    "bbPerHundred" DOUBLE PRECISION NOT NULL,
    "biggestPotWon" DECIMAL(12,2) NOT NULL,
    "biggestPunt" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPlayerSnapshot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerIdentityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "handsPlayed" INTEGER NOT NULL,
    "vpip" DOUBLE PRECISION NOT NULL,
    "pfr" DOUBLE PRECISION NOT NULL,
    "profitTotal" DECIMAL(12,2) NOT NULL,
    "bbPerHundred" DOUBLE PRECISION NOT NULL,
    "biggestPotWon" DECIMAL(12,2) NOT NULL,
    "biggestPunt" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyPlayerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedTable_guildId_tableId_key" ON "TrackedTable"("guildId", "tableId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerIdentity_guildId_discordUserId_key" ON "PlayerIdentity"("guildId", "discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_guildId_alias_key" ON "PlayerAlias"("guildId", "alias");

-- CreateIndex
CREATE INDEX "RawTableEvent_tableId_occurredAt_idx" ON "RawTableEvent"("tableId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawTableEvent_trackingSessionId_sequence_key" ON "RawTableEvent"("trackingSessionId", "sequence");

-- CreateIndex
CREATE INDEX "Hand_tableId_startedAt_idx" ON "Hand"("tableId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandPlayer_handId_playerAlias_key" ON "HandPlayer"("handId", "playerAlias");

-- CreateIndex
CREATE UNIQUE INDEX "HandAction_handId_sequence_key" ON "HandAction"("handId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "StatsSnapshot_guildId_playerIdentityId_key" ON "StatsSnapshot"("guildId", "playerIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPlayerSnapshot_guildId_playerIdentityId_year_month_key" ON "MonthlyPlayerSnapshot"("guildId", "playerIdentityId", "year", "month");

-- AddForeignKey
ALTER TABLE "TrackedTable" ADD CONSTRAINT "TrackedTable_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingSession" ADD CONSTRAINT "TrackingSession_trackedTableId_fkey" FOREIGN KEY ("trackedTableId") REFERENCES "TrackedTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerIdentity" ADD CONSTRAINT "PlayerIdentity_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerIdentityId_fkey" FOREIGN KEY ("playerIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawTableEvent" ADD CONSTRAINT "RawTableEvent_trackingSessionId_fkey" FOREIGN KEY ("trackingSessionId") REFERENCES "TrackingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_trackingSessionId_fkey" FOREIGN KEY ("trackingSessionId") REFERENCES "TrackingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_playerIdentityId_fkey" FOREIGN KEY ("playerIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_playerIdentityId_fkey" FOREIGN KEY ("playerIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatsSnapshot" ADD CONSTRAINT "StatsSnapshot_playerIdentityId_fkey" FOREIGN KEY ("playerIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPlayerSnapshot" ADD CONSTRAINT "MonthlyPlayerSnapshot_playerIdentityId_fkey" FOREIGN KEY ("playerIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
