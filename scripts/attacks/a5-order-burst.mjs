import crypto from 'node:crypto';

export async function runA5(baseUrl, db, n = 50) {
  // Masă nouă cu sesiune activă
  const tRes = await db.query(
    "INSERT INTO tables (restaurant_id, table_number) VALUES ((SELECT id FROM restaurants LIMIT 1), 997) RETURNING id;"
  );
  const tableId = tRes.rows[0].id;
  const sTok = 'a5_' + crypto.randomBytes(16).toString('hex');

  await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, $2, 'active');",
    [tableId, sTok]
  );

  // Scanare pentru cookie
  const scanRes = await fetch(`${baseUrl}/s/${sTok}`, { method: 'GET', redirect: 'manual' });
  const cookie = scanRes.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

  const mRes = await db.query('SELECT id FROM menu_items WHERE available = true LIMIT 1;');
  const menuItemId = mRes.rows[0].id;

  let accepted = 0;
  let rejected = 0;

  // Rafală rapidă de comenzi de pe același dispozitiv
  for (let i = 0; i < n; i++) {
    const r = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        clientRequestId: `burst_${i}_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }]
      })
    });

    if (r.status === 201) {
      accepted++;
    } else {
      rejected++;
    }
  }

  // Rate limiter permite 10 comenzi per minut, restul de 40 primesc 429 / 403
  return {
    scenario: 'A5: Rafală de comenzi de pe un singur dispozitiv',
    n,
    accepted,
    rejected,
    expectedAccepted: 10
  };
}

