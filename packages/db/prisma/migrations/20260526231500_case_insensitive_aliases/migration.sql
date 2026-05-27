ALTER TABLE "PlayerAlias" ADD COLUMN "normalizedAlias" TEXT;
UPDATE "PlayerAlias"
SET "normalizedAlias" = lower(regexp_replace(btrim("alias"), '\s+@\s+[A-Za-z0-9_-]+$', ''));
ALTER TABLE "PlayerAlias" ALTER COLUMN "normalizedAlias" SET NOT NULL;
CREATE INDEX "PlayerAlias_guildId_normalizedAlias_idx" ON "PlayerAlias"("guildId", "normalizedAlias");

ALTER TABLE "TrackedTablePlayerOverride" ADD COLUMN "normalizedAlias" TEXT;
UPDATE "TrackedTablePlayerOverride"
SET "normalizedAlias" = lower(regexp_replace(btrim("alias"), '\s+@\s+[A-Za-z0-9_-]+$', ''));
ALTER TABLE "TrackedTablePlayerOverride" ALTER COLUMN "normalizedAlias" SET NOT NULL;
CREATE INDEX "TrackedTablePlayerOverride_trackedTableId_normalizedAlias_idx" ON "TrackedTablePlayerOverride"("trackedTableId", "normalizedAlias");
