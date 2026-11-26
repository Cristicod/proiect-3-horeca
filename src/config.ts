import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  cookieSecure: boolean;
  jwtSecret: string;
  databaseUrl: string;
  undoWindowSeconds: number;
  maxDevicesPerTable: number;
  maxActiveInvites: number;
  maxActiveCalls: number;
  callRateLimit: number;
  baselineMode: boolean;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const cookieSecure = process.env.COOKIE_SECURE === 'true';
  const baselineMode = process.env.BASELINE_MODE === 'true';

  // CFG-01: NODE_ENV=production cu COOKIE_SECURE=false: procesul refuză să pornească
  if (nodeEnv === 'production' && !cookieSecure) {
    throw new Error('CFG-01: COOKIE_SECURE must be true in production');
  }

  // CFG-02: Serverul refuză să pornească cu BASELINE_MODE=true când NODE_ENV=production
  if (nodeEnv === 'production' && baselineMode) {
    throw new Error('CFG-02: BASELINE_MODE is strictly forbidden in production');
  }

  return {
    nodeEnv,
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    cookieSecure,
    jwtSecret: process.env.JWT_SECRET || 'secret-jwt-key-horeca-platform-minimum-32-chars-long!',
    databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/qr_menu_dev',
    undoWindowSeconds: parseInt(process.env.UNDO_WINDOW_SECONDS || '25', 10),
    maxDevicesPerTable: parseInt(process.env.MAX_DEVICES_PER_TABLE || '4', 10),
    maxActiveInvites: parseInt(process.env.MAX_ACTIVE_INVITES || '3', 10),
    maxActiveCalls: parseInt(process.env.MAX_ACTIVE_CALLS || '3', 10),
    callRateLimit: parseInt(process.env.CALL_RATE_LIMIT || '6', 10),
    baselineMode
  };
}

export const config = loadConfig();

