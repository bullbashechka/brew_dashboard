DROP INDEX "auth"."auth_two_factor_secret_idx";--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ALTER COLUMN "verified" SET DEFAULT false;