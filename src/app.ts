import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: true,
    credentials: true
  }));

  // Servire frontend din public/
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Rute API și scanare
  app.use('/', router);

  // Rute fallback pentru paginile frontend
  app.get('/', (_req, res) => {
    res.sendFile('index.html', { root: publicDir });
  });
  app.get('/menu', (_req, res) => {
    res.sendFile('menu.html', { root: publicDir });
  });
  app.get('/kitchen', (_req, res) => {
    res.sendFile('kitchen.html', { root: publicDir });
  });
  app.get('/waiter', (_req, res) => {
    res.sendFile('waiter.html', { root: publicDir });
  });

  return app;
}

