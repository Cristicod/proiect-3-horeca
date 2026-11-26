import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbInterface {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
  isPgLite: boolean;
}

class DatabaseManager implements DbInterface {
  private pool: pg.Pool | null = null;
  private pglite: PGlite | null = null;
  public isPgLite = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Încercare conectare la PostgreSQL real dacă nu suntem forțați pe PGlite
      if (process.env.USE_PGLITE === 'true') {
        await this.initPgLite();
        return;
      }

      try {
        const poolCandidate = new Pool({
          connectionString: config.databaseUrl,
          connectionTimeoutMillis: 1500,
          max: 10
        });

        // Test conexiune
        await poolCandidate.query('SELECT 1;');
        this.pool = poolCandidate;
        this.isPgLite = false;
        // console.log('Conectat la PostgreSQL extern:', config.databaseUrl);
      } catch (err) {
        // Fallback transparent la PGlite dacă nu există server PostgreSQL local activ
        // console.warn('PostgreSQL extern indisponibil. Se utilizează motorul PGlite WASM:', (err as any).message);
        await this.initPgLite();
      }
    })();

    return this.initPromise;
  }

  private async initPgLite() {
    let dataDir: string | undefined;
    if (process.env.USE_MEMORY_DB !== 'true') {
      dataDir = path.resolve(__dirname, '../data/pgdata');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    }

    this.pglite = dataDir ? new PGlite(dataDir) : new PGlite();
    this.isPgLite = true;

    // Aplică schema SQL în instanța PGlite
    const possibleSchemaPaths = [
      path.resolve(process.cwd(), 'db/schema.sql'),
      path.resolve(__dirname, '../db/schema.sql'),
      path.resolve(__dirname, '../../db/schema.sql')
    ];

    let schemaPath = possibleSchemaPaths.find(p => fs.existsSync(p));
    if (schemaPath) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await this.pglite.exec(sql);
    }
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    await this.init();

    if (this.pool) {
      const res = await this.pool.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount ?? res.rows.length
      };
    } else if (this.pglite) {
      const res = await this.pglite.query<T>(text, params);
      const rowCount = res.rows.length > 0 ? res.rows.length : ((res as any).affectedRows ?? 0);
      return {
        rows: res.rows,
        rowCount
      };
    }

    throw new Error('Database not initialized');
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
    }
    this.initPromise = null;
  }
}

export const db = new DatabaseManager();
