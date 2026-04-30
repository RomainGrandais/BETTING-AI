# Deployment Guide

## Prerequisites
- GitHub account
- Vercel account (linked to GitHub)

## Step 1: Push to GitHub

```bash
# Create a new repository on GitHub (don't initialize with README)
# Then from the betting-ai directory:

git remote add origin https://github.com/YOUR_USERNAME/betting-ai.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Connect your GitHub account if not already done
4. Select the `betting-ai` repository
5. Click "Import"

## Step 3: Configure Environment Variables

In the Vercel project settings, add these environment variables:

```
ANTHROPIC_API_KEY = sk-ant-api03-...  (your Anthropic API key)
ODDS_API_KEY = 3de70f88b53dd38e97b292a438f3fc61
NEXT_PUBLIC_SUPABASE_URL = https://djuoclalgcqhvfesrztm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
CRON_SECRET = (generate a random strong secret, e.g., 64-char random string)
NEXT_PUBLIC_APP_URL = https://your-vercel-domain.vercel.app
```

**Important**: 
- Copy values from `.env.local` exactly (Supabase keys are long JWT tokens)
- Generate a secure CRON_SECRET (used to protect the `/api/cron/daily` endpoint from unauthorized calls)
- Replace NEXT_PUBLIC_APP_URL with your actual Vercel domain (shown after first deployment)

## Step 4: Test the Daily Routine

After deployment, test the cron with:

```bash
curl -X POST https://your-vercel-domain.vercel.app/api/test-daily \
  -H "Content-Type: application/json"
```

This endpoint:
- Simulates the 6 AM UTC daily routine
- Auto-settles bets from previous day
- Analyzes matches in the 48-hour window
- Places new bets if any pass Claude's analysis
- Returns JSON with results

Expected response:
```json
{
  "success": true,
  "autoSettled": {
    "wonBets": 0,
    "lostBets": 0,
    "totalDelta": 0
  },
  "matchesAnalyzed": 12,
  "betsPlaced": 2,
  "totalStakePlaced": 15.50
}
```

## Step 5: Monitor Automatic Execution

The cron runs automatically **every day at 6 AM UTC**.

To verify it ran:
- Check Vercel Deployments → Function Logs
- Check Supabase → `bets` and `bankroll_history` tables for new entries

## Troubleshooting

### "401 Unauthorized" on /api/test-daily
- Check CRON_SECRET is set on Vercel
- Ensure NEXT_PUBLIC_APP_URL is correct

### "Supabase connection failed"
- Verify NEXT_PUBLIC_SUPABASE_URL and keys are correct
- Test locally: run `npm run dev` and check `/api/bets` works

### No matches found
- The 48-hour window may have no upcoming matches
- Check The Odds API has active matches in that period
- Verify ODDS_API_KEY is correct

### "NEXT_PUBLIC_APP_URL undefined"
- This is set in the test endpoint - it uses localhost for local testing, vercel domain for production
- If still seeing errors, manually set it to your domain in environment variables
