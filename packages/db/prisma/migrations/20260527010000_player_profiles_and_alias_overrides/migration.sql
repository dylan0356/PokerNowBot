CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "discordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

WITH base_profiles AS (
    SELECT
        pi."id",
        pi."guildId",
        COALESCE(
            (
                SELECT pa."alias"
                FROM "PlayerAlias" pa
                WHERE pa."playerIdentityId" = pi."id"
                ORDER BY pa."createdAt" ASC, pa."id" ASC
                LIMIT 1
            ),
            pi."discordUserId"
        ) AS base_name,
        pi."discordUserId",
        pi."createdAt"
    FROM "PlayerIdentity" pi
),
ranked_profiles AS (
    SELECT
        "id",
        "guildId",
        "discordUserId",
        "createdAt",
        base_name,
        ROW_NUMBER() OVER (PARTITION BY "guildId", base_name ORDER BY "id") AS duplicate_index
    FROM base_profiles
)
INSERT INTO "PlayerProfile" ("id", "guildId", "displayName", "discordUserId", "createdAt", "updatedAt")
SELECT
    "id",
    "guildId",
    CASE
        WHEN duplicate_index = 1 THEN base_name
        ELSE base_name || ' (' || duplicate_index::TEXT || ')'
    END,
    "discordUserId",
    "createdAt",
    "createdAt"
FROM ranked_profiles;

ALTER TABLE "PlayerAlias" ADD COLUMN "defaultPlayerProfileId" TEXT;
ALTER TABLE "PlayerAlias" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HandPlayer" ADD COLUMN "playerProfileId" TEXT;
ALTER TABLE "HandAction" ADD COLUMN "playerProfileId" TEXT;
ALTER TABLE "StatsSnapshot" ADD COLUMN "playerProfileId" TEXT;
ALTER TABLE "MonthlyPlayerSnapshot" ADD COLUMN "playerProfileId" TEXT;

UPDATE "PlayerAlias"
SET "defaultPlayerProfileId" = "playerIdentityId";

UPDATE "HandPlayer"
SET "playerProfileId" = "playerIdentityId";

UPDATE "HandAction"
SET "playerProfileId" = "playerIdentityId";

UPDATE "StatsSnapshot"
SET "playerProfileId" = "playerIdentityId";

UPDATE "MonthlyPlayerSnapshot"
SET "playerProfileId" = "playerIdentityId";

CREATE TABLE "TrackedTablePlayerOverride" (
    "id" TEXT NOT NULL,
    "trackedTableId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "playerProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedTablePlayerOverride_pkey" PRIMARY KEY ("id")
);

DROP INDEX "StatsSnapshot_guildId_playerIdentityId_dimensionKey_key";
DROP INDEX "MonthlyPlayerSnapshot_guildId_playerIdentityId_year_month_dimensionKey_key";

ALTER TABLE "PlayerAlias" DROP CONSTRAINT "PlayerAlias_playerIdentityId_fkey";
ALTER TABLE "HandPlayer" DROP CONSTRAINT "HandPlayer_playerIdentityId_fkey";
ALTER TABLE "HandAction" DROP CONSTRAINT "HandAction_playerIdentityId_fkey";
ALTER TABLE "StatsSnapshot" DROP CONSTRAINT "StatsSnapshot_playerIdentityId_fkey";
ALTER TABLE "MonthlyPlayerSnapshot" DROP CONSTRAINT "MonthlyPlayerSnapshot_playerIdentityId_fkey";

ALTER TABLE "PlayerAlias" DROP COLUMN "playerIdentityId";
ALTER TABLE "HandPlayer" DROP COLUMN "playerIdentityId";
ALTER TABLE "HandAction" DROP COLUMN "playerIdentityId";
ALTER TABLE "StatsSnapshot" DROP COLUMN "playerIdentityId";
ALTER TABLE "MonthlyPlayerSnapshot" DROP COLUMN "playerIdentityId";

DROP TABLE "PlayerIdentity";

CREATE UNIQUE INDEX "PlayerProfile_guildId_displayName_key" ON "PlayerProfile"("guildId", "displayName");
CREATE UNIQUE INDEX "PlayerProfile_guildId_discordUserId_key" ON "PlayerProfile"("guildId", "discordUserId");
CREATE UNIQUE INDEX "TrackedTablePlayerOverride_trackedTableId_alias_key" ON "TrackedTablePlayerOverride"("trackedTableId", "alias");
CREATE UNIQUE INDEX "StatsSnapshot_guildId_playerProfileId_dimensionKey_key" ON "StatsSnapshot"("guildId", "playerProfileId", "dimensionKey");
CREATE UNIQUE INDEX "MonthlyPlayerSnapshot_guildId_playerProfileId_year_month_dimensionKey_key" ON "MonthlyPlayerSnapshot"("guildId", "playerProfileId", "year", "month", "dimensionKey");

ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_defaultPlayerProfileId_fkey" FOREIGN KEY ("defaultPlayerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackedTablePlayerOverride" ADD CONSTRAINT "TrackedTablePlayerOverride_trackedTableId_fkey" FOREIGN KEY ("trackedTableId") REFERENCES "TrackedTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackedTablePlayerOverride" ADD CONSTRAINT "TrackedTablePlayerOverride_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StatsSnapshot" ADD CONSTRAINT "StatsSnapshot_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyPlayerSnapshot" ADD CONSTRAINT "MonthlyPlayerSnapshot_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
