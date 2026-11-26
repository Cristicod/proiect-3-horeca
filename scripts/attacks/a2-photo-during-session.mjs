import crypto from 'node:crypto';

export async function runA2(baseUrl, db, n = 50) {
  // Creează o masă nouă și o sesiune activă proaspătă fără membri
  const tRes = await db.query(
    "INSERT INTO tables (restaurant_id, table_number) VALUES ((SELECT id FROM restaurants LIMIT 1), 999) RETURNING id;"
  );
  const tableId = tRes.rows[0].id;
  const activeToken = 'act_' + crypto.randomBytes(16).toString('hex');

  await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, $2, 'active');",
    [tableId, activeToken]
  );

  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < n; i++) {
    // Fiecare încercare vine de la un dispozitiv distinct (fără cookie existent)
    const r = await fetch(`${baseUrl}/s/${activeToken}`, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': `Attacker-Device-${i}`
      }
    });

    if (r.status === 302) {
      accepted++;
    } else {
      rejected++;
    }
  }

  // Se așteaptă exact 4 acceptate (plafonul de 4 dispozitive pe masă), restul de 46 respinse cu 403
  return {
    scenario: 'A2: QR fotografiat în timpul sesiunii (dispozitive străine)',
    n,
    accepted,
    rejected,
    expectedAccepted: 4
  };
}

