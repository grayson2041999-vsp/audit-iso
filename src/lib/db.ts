import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type DB = NeonHttpDatabase<typeof schema>;

let _db: DB | null = null;

/**
 * Khởi tạo lười (lazy): chỉ kết nối khi thực sự có truy vấn.
 * Nhờ vậy `next build` không vỡ khi máy build chưa có DATABASE_URL.
 */
function getDb(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Chưa cấu hình DATABASE_URL. Tạo file .env.local từ .env.example và điền connection string của Neon.',
    );
  }
  _db = drizzle(neon(url), { schema });
  return _db;
}

export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const target = getDb() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export { schema };
