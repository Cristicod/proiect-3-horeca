export async function runA1(baseUrl, db, n = 50) {
  // Creează o sesiune anterioară și o închide
  const res = await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state, closed_at) VALUES ((SELECT id FROM tables LIMIT 1), 'old_closed_token_1234567890abcdef', 'closed', NOW()) RETURNING session_token;"
  );
  const oldToken = res.rows[0].session_token;

  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < n; i++) {
    const r = await fetch(`${baseUrl}/s/${oldToken}`, { method: 'GET', redirect: 'manual' });
    if (r.status === 302) {
      accepted++;
    } else {
      rejected++;
    }
  }

  return { scenario: 'A1: QR fotografiat înainte de deschidere (sesiune închisă)', n, accepted, rejected, expectedAccepted: 0 };
}

