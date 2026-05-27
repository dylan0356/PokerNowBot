-- CreateEnum
CREATE TYPE "StatsScope" AS ENUM ('OVERALL', 'BY_GAME_TYPE', 'BY_HANDEDNESS', 'BY_GAME_TYPE_HANDEDNESS');

-- CreateEnum
CREATE TYPE "HandednessBucket" AS ENUM ('HEADS_UP', 'THREE_HANDED', 'FOUR_HANDED', 'FIVE_HANDED', 'SIX_PLUS');

-- AlterTable
ALTER TABLE "Hand"
ADD COLUMN "gameType" TEXT,
ADD COLUMN "handedness" INTEGER,
ADD COLUMN "smallBlindAmount" DECIMAL(12,2),
ADD COLUMN "bigBlindAmount" DECIMAL(12,2),
ADD COLUMN "anteAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "StatsSnapshot"
ADD COLUMN "profitTotalBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "biggestPotWonBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "biggestPuntBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "scope" "StatsScope" NOT NULL DEFAULT 'OVERALL',
ADD COLUMN "gameType" TEXT,
ADD COLUMN "handednessBucket" "HandednessBucket",
ADD COLUMN "dimensionKey" TEXT NOT NULL DEFAULT 'overall';

-- AlterTable
ALTER TABLE "MonthlyPlayerSnapshot"
ADD COLUMN "profitTotalBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "biggestPotWonBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "biggestPuntBb" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "scope" "StatsScope" NOT NULL DEFAULT 'OVERALL',
ADD COLUMN "gameType" TEXT,
ADD COLUMN "handednessBucket" "HandednessBucket",
ADD COLUMN "dimensionKey" TEXT NOT NULL DEFAULT 'overall';

-- DropIndex
DROP INDEX "StatsSnapshot_guildId_playerIdentityId_key";

-- DropIndex
DROP INDEX "MonthlyPlayerSnapshot_guildId_playerIdentityId_year_month_key";

-- CreateIndex
CREATE UNIQUE INDEX "StatsSnapshot_guildId_playerIdentityId_dimensionKey_key" ON "StatsSnapshot"("guildId", "playerIdentityId", "dimensionKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPlayerSnapshot_guildId_playerIdentityId_year_month_dimensionKey_key" ON "MonthlyPlayerSnapshot"("guildId", "playerIdentityId", "year", "month", "dimensionKey");
