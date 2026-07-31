import type { Config } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: './src/lib/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
