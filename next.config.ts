import type { NextConfig } from "next";

const nextConfig = {
  crons: [
    {
      path: '/api/cron/daily',
      schedule: '0 6 * * *', // Every day at 6:00 AM UTC
    },
  ],
} as unknown as NextConfig;

export default nextConfig;
