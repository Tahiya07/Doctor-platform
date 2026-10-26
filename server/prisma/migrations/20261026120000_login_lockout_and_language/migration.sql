-- Admin sign-in lockout (4 wrong passwords) and each person's language, so emails reach them in Bengali or English.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "locked_until" TIMESTAMPTZ(3);

-- AddConstraint
ALTER TABLE "users" ADD CONSTRAINT "users_language_check" CHECK ("language" IN ('en', 'bn'));
