import bcrypt from 'bcryptjs';
import { db } from '../dist/db.js';

export async function seedDatabase() {
  console.log('Seeding database...');
  await db.init();

  // Curățare date anterioare
  await db.query('DELETE FROM session_calls;');
  await db.query('DELETE FROM order_items;');
  await db.query('DELETE FROM orders;');
  await db.query('DELETE FROM session_invites;');
  await db.query('DELETE FROM session_members;');
  await db.query('DELETE FROM table_sessions;');
  await db.query('DELETE FROM menu_items;');
  await db.query('DELETE FROM staff_users;');
  await db.query('DELETE FROM tables;');
  await db.query('DELETE FROM restaurants;');

  // 1. Restaurant
  const restRes = await db.query(
    "INSERT INTO restaurants (name) VALUES ('Trattoria Bella') RETURNING id;"
  );
  const restaurantId = restRes.rows[0].id;

  // 2. Mese
  const tbl1 = await db.query(
    "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 1, 'QR_STATIC_TBL_1') RETURNING id;",
    [restaurantId]
  );
  const tbl2 = await db.query(
    "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 2, 'QR_STATIC_TBL_2') RETURNING id;",
    [restaurantId]
  );
  const tbl3 = await db.query(
    "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 3, 'QR_STATIC_TBL_3') RETURNING id;",
    [restaurantId]
  );

  // 3. Personal
  const hash = bcrypt.hashSync('parola123', 10);
  await db.query(
    `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
     VALUES ($1, 'ospatar@demo.ro', $2, 'waiter', 'Ion Ospatarul'),
            ($1, 'bucatar@demo.ro', $2, 'kitchen', 'Gheorghe Bucatarul'),
            ($1, 'admin@demo.ro', $2, 'manager', 'Manager Restaurant');`,
    [restaurantId, hash]
  );

  // 4. Meniu
  await db.query(
    `INSERT INTO menu_items (restaurant_id, name, description, price, available)
     VALUES ($1, 'Pizza Margherita', 'Sos de rosii, mozzarella, busuioc proaspat', 42.00, true),
            ($1, 'Paste Carbonara', 'Spaghetti, guanciale, ou, pecorino romano', 45.00, true),
            ($1, 'Tiramisu', 'Piscoturi, cafea espresso, mascarpone, cacao', 25.00, true),
            ($1, 'Apa plata 500ml', 'Apa minerala plata Dorna', 10.00, true),
            ($1, 'Desert Special (Epuizat)', 'Editie limitata de sezon', 35.00, false);`,
    [restaurantId]
  );

  console.log('Seed realizat cu succes!');
  return { restaurantId, table1Id: tbl1.rows[0].id, table2Id: tbl2.rows[0].id, table3Id: tbl3.rows[0].id };
}

// Rulare directă dacă e executat din terminal
if (process.argv[1]?.endsWith('seed.mjs')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Eroare la seed:', err);
      process.exit(1);
    });
}

