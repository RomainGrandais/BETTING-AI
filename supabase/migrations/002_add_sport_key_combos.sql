-- Migration 002: add sport_key and combo_legs columns
ALTER TABLE bets ADD COLUMN IF NOT EXISTS sport_key text DEFAULT '';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS combo_legs jsonb DEFAULT NULL;
