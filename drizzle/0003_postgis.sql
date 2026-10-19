CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
ALTER TABLE "lowongan" ADD COLUMN "titik" geography(Point,4326) GENERATED ALWAYS AS (CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography END) STORED;--> statement-breakpoint
CREATE INDEX "lowongan_titik_idx" ON "lowongan" USING gist ("titik");
