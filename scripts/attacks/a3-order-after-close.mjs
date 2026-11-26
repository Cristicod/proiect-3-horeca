import crypto from 'node:crypto';

export async function runA3(baseUrl, db, n = 50) {
  // Masă cu sesiune activă, obținem cookie membru, apoi închidem sesiunea
  const tRes = await db.query(
    "INSERT INTO tables (restaurant_id, table_number) VALUES ((SELECT id FROM restaurants LIMIT 1), 998) RETURNING id;"
  );
  const tableId = tRes.rows[0].id;
  const sTok = 'a3_' + crypto.randomBytes(16).toString('hex');

  const sessRes = await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, $2, 'active') RETURNING id;",
    [tableId, sTok]
  );
  const sessionId = sessRes.rows[0].id;

  // Scanare pentru a deveni membru cu cookie valid
  const scanRes = await fetch(`${baseUrl}/s/${sTok}`, { method: 'GET', redirect: 'manual' });
  const cookie = scanRes.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

  // Acum personalul închide sesiunea
  await db.query("UPDATE table_sessions SET state = 'closed', closed_at = NOW() WHERE id = $1;", [sessionId]);

  // Produs din meniu
  const mRes = await db.query('SELECT id FROM menu_items WHERE available = true LIMIT 1;');
  const menuItemId = mRes.rows[0].id;

  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < n; i++) {
    const r = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        clientRequestId: `a3_req_${i}_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }]
      })
    });

    if (r.status === 201) {
      accepted++;
    } else {
      rejected++;
    }
  }

  return {
    scenario: 'A3: Comandă după închiderea sesiunii',
    n,
    accepted,
    rejected,
    expectedAccepted: 0
  };
}

