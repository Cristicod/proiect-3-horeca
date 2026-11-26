import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { setupSocketIO } from './socket.js';
import { startWorker } from './worker.js';
import { config } from './config.js';
import { db } from './db.js';

export { createApp };

export function createServer(customApp?: ReturnType<typeof createApp>) {
  const app = customApp || createApp();
  const server = http.createServer(app);
  const io = setupSocketIO(server);

  return { server, io, app };
}

// Rulare server dacă este entry point
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution || process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await db.init();

      // Auto-seed dacă baza este goală
      try {
        const staffCheck = await db.query('SELECT COUNT(*)::int AS count FROM staff_users;');
        if (staffCheck.rows[0].count === 0) {
          console.log('Populare automată date inițiale (Seed)...');
          const bcrypt = (await import('bcryptjs')).default;
          const hash = bcrypt.hashSync('parola123', 10);
          const rRes = await db.query("INSERT INTO restaurants (name) VALUES ('Trattoria Bella') RETURNING id;");
          const rId = rRes.rows[0].id;
          await db.query("INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 1, 'QR_STATIC_1'), ($1, 2, 'QR_STATIC_2'), ($1, 3, 'QR_STATIC_3');", [rId]);
          await db.query(`INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
            VALUES ($1, 'ospatar@demo.ro', $2, 'waiter', 'Ion Ospatarul'),
                   ($1, 'bucatar@demo.ro', $2, 'kitchen', 'Gheorghe Bucatarul'),
                   ($1, 'admin@demo.ro', $2, 'manager', 'Manager Restaurant');`, [rId, hash]);
          await db.query(`INSERT INTO menu_items (restaurant_id, name, description, price, available)
            VALUES ($1, 'Pizza Margherita', 'Sos de rosii, mozzarella, busuioc', 42.00, true),
                   ($1, 'Paste Carbonara', 'Guanciale, pecorino, ou', 45.00, true),
                   ($1, 'Tiramisu', 'Piscoturi, mascarpone, espresso', 25.00, true),
                   ($1, 'Apa plata 500ml', 'Apa minerala plata', 10.00, true);`, [rId]);
          console.log('Seed demonstrativ aplicat cu succes!');
        }
      } catch (e) {
        console.warn('Auto-seed info:', (e as any).message);
      }

      const { server } = createServer();

      // Pornire worker de dispatch automat
      startWorker(500);

      server.listen(config.port, () => {
        console.log(`====================================================`);
        console.log(`Server HoReCa QR pornit pe: ${config.appUrl}`);
        console.log(`Mediu: ${config.nodeEnv} | Cookie Secure: ${config.cookieSecure}`);
        console.log(`====================================================`);
      });
    } catch (err) {
      console.error('Eroare la pornirea serverului:', err);
      process.exit(1);
    }
  })();
}

