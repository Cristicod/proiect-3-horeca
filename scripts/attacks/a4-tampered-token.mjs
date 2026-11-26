import crypto from 'node:crypto';

export async function runA4(baseUrl, db, n = 50) {
  // Generare sesiune validă
  const origToken = 'valid_session_token_' + crypto.randomBytes(8).toString('hex');
  await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ((SELECT id FROM tables LIMIT 1), $1, 'active');",
    [origToken]
  );

  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < n; i++) {
    // Schimbare de bit/caracter sau token ghicit
    const charIndex = i % origToken.length;
    const replacementChar = String.fromCharCode(((origToken.charCodeAt(charIndex) + 1) % 26) + 97);
    const tampered = origToken.substring(0, charIndex) + replacementChar + origToken.substring(charIndex + 1);

    const r = await fetch(`${baseUrl}/s/${tampered}`, { method: 'GET', redirect: 'manual' });
    if (r.status === 302) {
      accepted++;
    } else {
      rejected++;
    }
  }

  return {
    scenario: 'A4: Token ghicit sau modificat (un bit schimbat)',
    n,
    accepted,
    rejected,
    expectedAccepted: 0
  };
}

