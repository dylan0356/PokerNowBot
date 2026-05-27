DELETE FROM "PlayerProfile"
WHERE "discordUserId" IS NULL;

ALTER TABLE "PlayerProfile"
ALTER COLUMN "discordUserId" SET NOT NULL;
