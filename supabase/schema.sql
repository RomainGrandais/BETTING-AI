-- BettingAI Database Schema
-- Run this in your Supabase SQL editor

-- Bankroll history (one row per event that changes the bankroll)
CREATE TABLE IF NOT EXISTS bankroll_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount decimal(10, 2) NOT NULL,
  event text NOT NULL DEFAULT 'Événement',
  created_at timestamptz DEFAULT now()
);

-- Insert initial bankroll
INSERT INTO bankroll_history (amount, event)
VALUES (100.00, 'Bankroll initiale');

-- Bets placed by the AI
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL,
  sport text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  competition text DEFAULT '',
  start_time timestamptz NOT NULL,
  bet_label text NOT NULL,
  bet_type text NOT NULL DEFAULT '1X2',
  odds decimal(6, 2) NOT NULL,
  estimated_probability decimal(4, 3) NOT NULL,
  expected_value decimal(6, 4) NOT NULL,
  stake decimal(8, 2) NOT NULL,
  potential_win decimal(8, 2) NOT NULL,
  ai_reasoning text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void')),
  created_at timestamptz DEFAULT now(),
  settled_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS bets_status_idx ON bets(status);
CREATE INDEX IF NOT EXISTS bets_sport_idx ON bets(sport);
CREATE INDEX IF NOT EXISTS bets_created_at_idx ON bets(created_at DESC);
CREATE INDEX IF NOT EXISTS bankroll_created_at_idx ON bankroll_history(created_at ASC);

-- RLS (Row Level Security) - allow all for now (local dev)
ALTER TABLE bankroll_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

-- Policies: allow all operations (tighten for production)
CREATE POLICY "Allow all bankroll" ON bankroll_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all bets" ON bets FOR ALL USING (true) WITH CHECK (true);
