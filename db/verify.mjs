import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runVerification() {
  console.log('--- Verificare Bază de Date (PGlite / PostgreSQL) ---');
  const db = new PGlite();
  
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Execută schema completă
  await db.exec(schemaSql);
  console.log('✓ Schema SQL aplicată cu succes.');

  let passedTests = 0;
  function assert(condition, message) {
    if (!condition) {
      throw new Error(`FAIL: ${message}`);
    }
    passedTests++;
    console.log(`  [OK ${passedTests}] ${message}`);
  }

  // Creare date inițiale pentru teste
  const resRest = await db.query(
    "INSERT INTO restaurants (name) VALUES ('La Cuptorul cu Lemne') RETURNING id;"
  );
  const restaurantId = resRest.rows[0].id;
  assert(Boolean(restaurantId), 'Creare restaurant');

  const resTable = await db.query(
    "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 1, 'QR_STATIC_TBL_1') RETURNING id;",
    [restaurantId]
  );
  const tableId = resTable.rows[0].id;
  assert(Boolean(tableId), 'Creare masă');

  const resTable2 = await db.query(
    "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 2, 'QR_STATIC_TBL_2') RETURNING id;",
    [restaurantId]
  );
  const table2Id = resTable2.rows[0].id;
  assert(Boolean(table2Id), 'Creare masa 2');

  // Teste Varianta A
  // 1. O singură sesiune activă per masă
  const s1 = await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, 'tok_sess_1', 'active') RETURNING id;",
    [tableId]
  );
  assert(Boolean(s1.rows[0].id), 'Inserare sesiune activa masă 1');

  let failedSecondActive = false;
  try {
    await db.query(
      "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, 'tok_sess_2', 'active');",
      [tableId]
    );
  } catch (err) {
    failedSecondActive = true;
  }
  assert(failedSecondActive, 'Constrângere unică: Refuz a doua sesiune activă pe aceeași masă');

  // 2. Închiderea primei sesiuni permite o nouă sesiune
  await db.query(
    "UPDATE table_sessions SET state = 'closed', closed_at = NOW() WHERE id = $1;",
    [s1.rows[0].id]
  );
  const s2 = await db.query(
    "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, 'tok_sess_2', 'active') RETURNING id;",
    [tableId]
  );
  assert(Boolean(s2.rows[0].id), 'Permitere sesiune activă nouă după închiderea celei vechi');

  // 3. Adăugare membru sesiune
  const m1 = await db.query(
    "INSERT INTO session_members (session_id, device_token, is_owner, nickname) VALUES ($1, 'dev_tok_1', true, 'Client 1') RETURNING id;",
    [s2.rows[0].id]
  );
  assert(Boolean(m1.rows[0].id), 'Inserare membru (owner)');

  // 4. Meniu și disponibilitate
  const mItem = await db.query(
    "INSERT INTO menu_items (restaurant_id, name, price, available) VALUES ($1, 'Pizza Margherita', 42.00, true) RETURNING id;",
    [restaurantId]
  );
  assert(Boolean(mItem.rows[0].id), 'Inserare produs meniu');

  // 5. Comandă cu client_request_id unic per sesiune
  const o1 = await db.query(
    "INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after) VALUES ($1, $2, 'req-001', 'queued', NOW() + INTERVAL '25 seconds') RETURNING id;",
    [s2.rows[0].id, m1.rows[0].id]
  );
  assert(Boolean(o1.rows[0].id), 'Creare comandă în starea queued');

  let duplicateReqFailed = false;
  try {
    await db.query(
      "INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after) VALUES ($1, $2, 'req-001', 'queued', NOW() + INTERVAL '25 seconds');",
      [s2.rows[0].id, m1.rows[0].id]
    );
  } catch (err) {
    duplicateReqFailed = true;
  }
  assert(duplicateReqFailed, 'Idempotență comandă: Refuz duplicate client_request_id per sesiune');

  // 6. Vederea v_table_status
  const vStatus = await db.query(
    "SELECT status_derivat, active_devices_count, pending_orders_count FROM v_table_status WHERE table_id = $1;",
    [tableId]
  );
  assert(
    vStatus.rows[0].status_derivat === 'OCUPATA' &&
    Number(vStatus.rows[0].active_devices_count) === 1 &&
    Number(vStatus.rows[0].pending_orders_count) === 1,
    'v_table_status reflectă starea OCUPATA, 1 dispozitiv activ, 1 comandă pending'
  );

  // 7. Cantitate linie de comandă (validare DB: 1 <= quantity <= 20)
  let invalidQtyFailed = false;
  try {
    await db.query(
      "INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES ($1, $2, 0, 42.00);",
      [o1.rows[0].id, mItem.rows[0].id]
    );
  } catch (err) {
    invalidQtyFailed = true;
  }
  assert(invalidQtyFailed, 'Validare DB order_items quantity > 0');

  // ===================================================================
  // T00: TESTE DE STARE PENTRU VARIANTA B
  // ===================================================================
  console.log('\n--- Rulare Teste Stare Varianta B (T00) ---');

  // T00-1: Două candidaturi cu același ecuson pe aceeași masă: a doua e respinsă (duplicate key)
  const cand1 = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ROSU_12', 'candidate', NOW() + INTERVAL '2 minutes') RETURNING id;",
    [table2Id]
  );
  assert(Boolean(cand1.rows[0].id), 'T00-1a: Inserare prima candidatură cu ecuson ROSU_12');

  let duplicateBadgeFailed = false;
  try {
    await db.query(
      "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ROSU_12', 'candidate', NOW() + INTERVAL '2 minutes');",
      [table2Id]
    );
  } catch (err) {
    duplicateBadgeFailed = true;
  }
  assert(duplicateBadgeFailed, 'T00-1b: Constrângere unică: A doua candidatură cu același ecuson pe aceeași masă este respinsă');

  // T00-2: Candidat → activ (update state = 'active', activated_at), iar ecusonul se eliberează din indexul unic
  await db.query(
    "UPDATE candidate_sessions SET state = 'active', activated_at = NOW() WHERE id = $1;",
    [cand1.rows[0].id]
  );
  // Acum ecusonul 'ROSU_12' poate fi reutilizat de un alt candidat pentru aceeași masă, deoarece idx_unique_candidate_badge_per_table are WHERE state = 'candidate'
  const candReuse = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ROSU_12', 'candidate', NOW() + INTERVAL '2 minutes') RETURNING id;",
    [table2Id]
  );
  assert(Boolean(candReuse.rows[0].id), 'T00-2: Candidat -> activ eliberează ecusonul din indexul unic (reutilizare permisă)');

  // T00-3: Candidat expirat → marcat expirat prin expire_stale_candidates()
  // Creăm un candidat deja expirat în trecut
  const staleCand = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'VERDE_05', 'candidate', NOW() - INTERVAL '10 seconds') RETURNING id;",
    [table2Id]
  );
  const expRes = await db.query("SELECT expire_stale_candidates() AS affected;");
  const affected = Number(expRes.rows[0].affected);
  assert(affected >= 1, 'T00-3a: expire_stale_candidates() actualizează candidații stătăuți');

  const staleCheck = await db.query("SELECT state FROM candidate_sessions WHERE id = $1;", [staleCand.rows[0].id]);
  assert(staleCheck.rows[0].state === 'expired', 'T00-3b: Starea candidatului stătăuț devine expired');

  // T00-4: Candidat → închis fără activare; comanda pe sesiune închisă este respinsă
  const candClosed = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, closed_at) VALUES ($1, 'ALBASTRU_01', 'closed', NOW()) RETURNING id;",
    [table2Id]
  );
  let orderOnClosedFailed = false;
  try {
    await db.query(
      "INSERT INTO candidate_orders (session_id, order_data) VALUES ($1, '{\"items\": [1]}');",
      [candClosed.rows[0].id]
    );
  } catch (err) {
    orderOnClosedFailed = true;
  }
  assert(orderOnClosedFailed, 'T00-4a: Comanda pe sesiune candidat închisă este respinsă de trigger');

  // Comandă pe sesiune activă este permisă
  const orderOnActive = await db.query(
    "INSERT INTO candidate_orders (session_id, order_data) VALUES ($1, '{\"items\": [1]}') RETURNING id;",
    [cand1.rows[0].id]
  );
  assert(Boolean(orderOnActive.rows[0].id), 'T00-4b: Comanda pe sesiune candidat activă este acceptată');

  // T00-5: Plafonul de 3 candidați ignoră cei expirați (extindere test)
  // Curățăm candidații de test pentru table_id
  await db.query("DELETE FROM candidate_sessions WHERE table_id = $1;", [tableId]);
  
  // Inserăm 2 candidați expirați
  await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'EXP_1', 'expired', NOW() - INTERVAL '5 minutes');",
    [tableId]
  );
  await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'EXP_2', 'candidate', NOW() - INTERVAL '1 minute');",
    [tableId]
  );

  // Inserăm 3 candidați activi valabili (plafonul de 3)
  const cA = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ACT_1', 'candidate', NOW() + INTERVAL '5 minutes') RETURNING id;",
    [tableId]
  );
  const cB = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ACT_2', 'candidate', NOW() + INTERVAL '5 minutes') RETURNING id;",
    [tableId]
  );
  const cC = await db.query(
    "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ACT_3', 'candidate', NOW() + INTERVAL '5 minutes') RETURNING id;",
    [tableId]
  );
  assert(Boolean(cA.rows[0].id && cB.rows[0].id && cC.rows[0].id), 'T00-5a: Inserare 3 candidați activi (ignorând cei 2 expirați)');

  // Al 4-lea candidat activ trebuie respins conform trg_check_candidate_cap
  let capExceededFailed = false;
  try {
    await db.query(
      "INSERT INTO candidate_sessions (table_id, badge_code, state, expires_at) VALUES ($1, 'ACT_4', 'candidate', NOW() + INTERVAL '5 minutes');",
      [tableId]
    );
  } catch (err) {
    capExceededFailed = true;
  }
  assert(capExceededFailed, 'T00-5b: Plafonul de 3 candidați atins: al 4-lea candidat este respins');

  console.log(`\n======================================================`);
  console.log(`TOTAL TESTE REUȘITE: ${passedTests}`);
  console.log(`======================================================`);

  // Salvare rezultat în results/db-verify.txt
  const resultsDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(resultsDir, 'db-verify.txt'),
    `Total teste db:verify trecute: ${passedTests}\nData: ${new Date().toISOString()}\nStatus: PASS\n`,
    'utf8'
  );

  await db.close();
  return passedTests;
}

runVerification()
  .then((count) => {
    console.log(`db:verify finalizat cu succes (${count} teste).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('db:verify a eșuat:', err);
    process.exit(1);
  });

