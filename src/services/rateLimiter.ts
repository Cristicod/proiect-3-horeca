import { db } from '../db.js';

interface RateRecord {
  timestamps: number[];
  rateLimitedCount: number;
  lastRateLimitedAt: number;
}

class InMemoryRateLimiter {
  private records = new Map<string, RateRecord>();

  isRateLimited(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [], rateLimitedCount: 0, lastRateLimitedAt: 0 };
      this.records.set(key, record);
    }

    // Filtrăm timestamps mai vechi decât windowMs
    record.timestamps = record.timestamps.filter(t => now - t < windowMs);

    if (record.timestamps.length >= limit) {
      // Monitorizare pentru înghețare dispozitiv (T07)
      if (now - record.lastRateLimitedAt < 5 * 60 * 1000) {
        record.rateLimitedCount++;
      } else {
        record.rateLimitedCount = 1;
      }
      record.lastRateLimitedAt = now;
      return true;
    }

    record.timestamps.push(now);
    return false;
  }

  getRateLimitedCount(key: string): number {
    const record = this.records.get(key);
    return record ? record.rateLimitedCount : 0;
  }

  reset(key: string) {
    this.records.delete(key);
  }
}

export const rateLimiter = new InMemoryRateLimiter();

/**
 * T07: Înghețare dispozitiv abuziv
 * Dacă membrul a fost respins de 3 ori în 5 minute, se setează frozen_until = NOW() + 10 min
 */
export async function checkAndApplyDeviceFreeze(memberId: string): Promise<boolean> {
  const countOrder = rateLimiter.getRateLimitedCount(`order:${memberId}`);
  const countCall = rateLimiter.getRateLimitedCount(`call:${memberId}`);
  const count = Math.max(countOrder, countCall);

  if (count >= 3) {
    await db.query(
      "UPDATE session_members SET frozen_until = NOW() + INTERVAL '10 minutes' WHERE id = $1;",
      [memberId]
    );
    return true;
  }
  return false;
}

