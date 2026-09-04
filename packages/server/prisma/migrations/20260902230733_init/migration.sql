-- CreateEnum
CREATE TYPE "GameEndReason" AS ENUM ('NORMAL', 'PLAYER_LEFT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "ranking" INTEGER NOT NULL DEFAULT 1000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "active_game_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_reason" "GameEndReason",
    "winning_team" INTEGER,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "team1_score" INTEGER NOT NULL,
    "team2_score" INTEGER NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_logs" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solo_games" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checkpoint_version" TEXT,
    "winning_team" INTEGER,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solo_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_nickname_key" ON "users"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_active_game_id_key" ON "rooms"("active_game_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_room_id_seat_key" ON "participants"("room_id", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "participants_room_id_user_id_key" ON "participants"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "games_room_id_idx" ON "games"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_game_id_round_number_key" ON "rounds"("game_id", "round_number");

-- CreateIndex
CREATE UNIQUE INDEX "game_logs_game_id_key" ON "game_logs"("game_id");

-- CreateIndex
CREATE INDEX "solo_games_user_id_idx" ON "solo_games"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_active_game_id_fkey" FOREIGN KEY ("active_game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_logs" ADD CONSTRAINT "game_logs_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solo_games" ADD CONSTRAINT "solo_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
