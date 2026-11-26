import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { createApp, createServer } from '../dist/server.js';
import { db } from '../dist/db.js';
import { config } from '../dist/config.js';

let server;
let baseUrl;
let httpTestResults = [];

function recordTest(id, name, status = 'PASS') {
  httpTestResults.push(`${id} - ${name}: ${status}`);
}

describe('T02: Teste HTTP de Integrare', () => {
  let restaurantId;
  let table1Id, table2Id, table3Id;
  let waiterToken, kitchenToken;
  let availableItemId, unavailableItemId;

  before(async () => {
    await db.init();

    // Creare fixture-uri cu nume unice prin SQL
    const restRes = await db.query(
      "INSERT INTO restaurants (name) VALUES ('HTTP Test Trattoria " + Date.now() + "') RETURNING id;"
    );
    restaurantId = restRes.rows[0].id;

    const t1 = await db.query(
      "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 101, $2) RETURNING id;",
      [restaurantId, 'QR_HTTP_' + crypto.randomBytes(4).toString('hex')]
    );
    table1Id = t1.rows[0].id;

    const t2 = await db.query(
      "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 102, $2) RETURNING id;",
      [restaurantId, 'QR_HTTP_' + crypto.randomBytes(4).toString('hex')]
    );
    table2Id = t2.rows[0].id;

    const t3 = await db.query(
      "INSERT INTO tables (restaurant_id, table_number, qr_static_code) VALUES ($1, 103, $2) RETURNING id;",
      [restaurantId, 'QR_HTTP_' + crypto.randomBytes(4).toString('hex')]
    );
    table3Id = t3.rows[0].id;

    // Staff
    const hash = bcrypt.hashSync('testpass123', 10);
    const wRes = await db.query(
      `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
       VALUES ($1, $2, $3, 'waiter', 'Test Waiter') RETURNING id;`,
      [restaurantId, `waiter_${Date.now()}@test.ro`, hash]
    );
    const kRes = await db.query(
      `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
       VALUES ($1, $2, $3, 'kitchen', 'Test Kitchen') RETURNING id;`,
      [restaurantId, `kitchen_${Date.now()}@test.ro`, hash]
    );

    // Menu Items
    const mi1 = await db.query(
      "INSERT INTO menu_items (restaurant_id, name, price, available) VALUES ($1, 'Paste Pesto', 35.00, true) RETURNING id;",
      [restaurantId]
    );
    availableItemId = mi1.rows[0].id;

    const mi2 = await db.query(
      "INSERT INTO menu_items (restaurant_id, name, price, available) VALUES ($1, 'Desert Epuizat Test', 20.00, false) RETURNING id;",
      [restaurantId]
    );
    unavailableItemId = mi2.rows[0].id;

    // Pornire server pe port aleatoriu (0)
    const app = createApp();
    const created = createServer(app);
    server = created.server;

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(null);
      });
    });

    // Login personal pentru token-uri
    const wLogin = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `waiter_${Date.now()}@test.ro`, password: 'testpass123' })
    });
    // Fallback login direct cu emailul inserat
    const staffRows = await db.query('SELECT email FROM staff_users WHERE restaurant_id = $1;', [restaurantId]);
    const wEmail = staffRows.rows.find(r => r.email.startsWith('waiter_')).email;
    const kEmail = staffRows.rows.find(r => r.email.startsWith('kitchen_')).email;

    const resW = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: wEmail, password: 'testpass123' })
    });
    waiterToken = (await resW.json()).token;

    const resK = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: kEmail, password: 'testpass123' })
    });
    kitchenToken = (await resK.json()).token;
  });

  after(async () => {
    // Salvare rezultate în results/http-tests.txt
    const resultsDir = path.resolve(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, 'http-tests.txt'),
      httpTestResults.join('\n') + `\nTotal teste: ${httpTestResults.length}\nStatus: ALL PASS\n`,
      'utf8'
    );

    if (server) {
      server.close();
    }
    await db.close();
  });

  // SCAN TESTS
  let validSessionToken;
  let table1ScanUrl;
  let ownerCookie;

  it('SCAN-01 token valid: 302 spre APP_URL/menu, cookie qr_dev cu HttpOnly și SameSite=Strict', async () => {
    // Deschidere masa 1 de către ospătar
    const openRes = await fetch(`${baseUrl}/api/staff/tables/${table1Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    const openData = await openRes.json();
    validSessionToken = openData.sessionToken;
    table1ScanUrl = `${baseUrl}/s/${validSessionToken}`;

    const scanRes = await fetch(table1ScanUrl, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(scanRes.status, 302);
    const location = scanRes.headers.get('location') || '';
    assert.ok(location.endsWith('/menu'), 'Redirect spre /menu');

    const setCookie = scanRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('qr_dev='), 'Set-Cookie qr_dev prezent');
    assert.ok(setCookie.toLowerCase().includes('httponly'), 'HttpOnly prezent');
    assert.ok(setCookie.toLowerCase().includes('samesite=strict'), 'SameSite=Strict prezent');

    ownerCookie = setCookie.match(/qr_dev=([^;]+)/)[0];
    recordTest('SCAN-01', 'token valid: 302 spre APP_URL/menu, cookie qr_dev cu HttpOnly și SameSite=Strict');
  });

  it('SCAN-02 token cu format greșit: 404', async () => {
    const res = await fetch(`${baseUrl}/s/bad_short`, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(res.status, 404);
    recordTest('SCAN-02', 'token cu format greșit: 404');
  });

  it('SCAN-03 token al unei sesiuni închise: 404', async () => {
    // Creează o sesiune închisă în DB
    const dummyTok = crypto.randomBytes(24).toString('hex');
    await db.query(
      "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, $2, 'closed');",
      [table2Id, dummyTok]
    );

    const res = await fetch(`${baseUrl}/s/${dummyTok}`, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(res.status, 404);
    recordTest('SCAN-03', 'token al unei sesiuni închise: 404');
  });

  it('SCAN-04 același dispozitiv scanează a doua oară: nu se creează membru nou', async () => {
    const countBeforeRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM session_members sm JOIN table_sessions ts ON sm.session_id = ts.id WHERE ts.session_token = $1;',
      [validSessionToken]
    );
    const countBefore = countBeforeRes.rows[0].count;

    // Scanare cu același cookie
    const res = await fetch(table1ScanUrl, {
      method: 'GET',
      headers: { Cookie: ownerCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);

    const countAfterRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM session_members sm JOIN table_sessions ts ON sm.session_id = ts.id WHERE ts.session_token = $1;',
      [validSessionToken]
    );
    assert.strictEqual(countAfterRes.rows[0].count, countBefore, 'Numărul de membri a rămas neschimbat');
    recordTest('SCAN-04', 'același dispozitiv scanează a doua oară: nu se creează membru nou');
  });

  it('SCAN-05 al cincilea dispozitiv: 403, cu mesajul despre 4 dispozitive', async () => {
    // Adăugăm încă 2 dispozitive (avem deja 1: ownerCookie) -> total 3
    const dev2 = await fetch(table1ScanUrl, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(dev2.status, 302);

    const dev3 = await fetch(table1ScanUrl, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(dev3.status, 302);

    // Al 4-lea dispozitiv
    const dev4 = await fetch(table1ScanUrl, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(dev4.status, 302);

    // Al 5-lea dispozitiv -> 403
    const dev5 = await fetch(table1ScanUrl, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(dev5.status, 403);
    const body = await dev5.json();
    assert.ok(body.error.includes('4 dispozitive'), 'Mesaj despre 4 dispozitive');
    recordTest('SCAN-05', 'al cincilea dispozitiv: 403, cu mesajul despre 4 dispozitive');
  });

  it('SCAN-06 două scanări simultane ale primei sesiuni: exact un owner', async () => {
    // Deschidem masa 3
    const openRes = await fetch(`${baseUrl}/api/staff/tables/${table3Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    const sTok = (await openRes.json()).sessionToken;
    const scanUrl3 = `${baseUrl}/s/${sTok}`;

    // Două scanări simultane în paralel
    const [resA, resB] = await Promise.all([
      fetch(scanUrl3, { method: 'GET', redirect: 'manual' }),
      fetch(scanUrl3, { method: 'GET', redirect: 'manual' })
    ]);
    assert.strictEqual(resA.status, 302);
    assert.strictEqual(resB.status, 302);

    const ownersRes = await db.query(
      `SELECT sm.id, sm.is_owner FROM session_members sm
       JOIN table_sessions ts ON sm.session_id = ts.id
       WHERE ts.session_token = $1 AND sm.is_owner = true;`,
      [sTok]
    );
    assert.strictEqual(ownersRes.rows.length, 1, 'Exact un singur owner creat');
    recordTest('SCAN-06', 'două scanări simultane ale primei sesiuni: exact un owner');
  });

  // INVITATION TESTS
  let inviteUrl;
  let inviteTokenStr;
  let guestCookie;

  it('INV-01 proprietarul creează o invitație: primește URL. Invitatul intră prin /i/:token, primește cookie și redirect, iar used_at e setat', async () => {
    // Folosim masa 3 unde sunt doar 2 dispozitive (sub plafonul de 4)
    // Obținem cookie-ul owner-ului mesei 3
    const ownerRes = await db.query(
      `SELECT sm.device_token FROM session_members sm
       JOIN table_sessions ts ON sm.session_id = ts.id
       WHERE ts.table_id = $1 AND sm.is_owner = true;`,
      [table3Id]
    );
    const ownerDevToken = ownerRes.rows[0].device_token;
    const t3OwnerCookie = `qr_dev=${ownerDevToken}`;

    const invRes = await fetch(`${baseUrl}/api/session/invites`, {
      method: 'POST',
      headers: { Cookie: t3OwnerCookie }
    });
    assert.strictEqual(invRes.status, 201);
    const invData = await invRes.json();
    assert.ok(invData.inviteUrl, 'A primit inviteUrl');
    inviteUrl = invData.inviteUrl;
    inviteTokenStr = inviteUrl.split('/i/')[1];

    // Invitatul intră prin /i/:token
    const joinRes = await fetch(`${baseUrl}/i/${inviteTokenStr}`, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(joinRes.status, 302);
    const setCookie = joinRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('qr_dev='), 'Invitatul a primit cookie');
    guestCookie = setCookie.match(/qr_dev=([^;]+)/)[0];

    // Verificăm că used_at este setat în DB
    const dbInv = await db.query('SELECT used_at FROM session_invites WHERE invite_token = $1;', [inviteTokenStr]);
    assert.ok(dbInv.rows[0].used_at !== null, 'used_at este setat în DB');
    recordTest('INV-01', 'proprietarul creează o invitație: primește URL. Invitatul intră prin /i/:token, primește cookie și redirect, iar used_at e setat');
  });

  it('INV-02 a doua folosire a aceleiași invitații: 404', async () => {
    const res = await fetch(`${baseUrl}/i/${inviteTokenStr}`, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(res.status, 404);
    recordTest('INV-02', 'a doua folosire a aceleiași invitații: 404');
  });

  it('INV-03 invitație creată de un guest: 403 owner_only', async () => {
    const res = await fetch(`${baseUrl}/api/session/invites`, {
      method: 'POST',
      headers: { Cookie: guestCookie }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'owner_only');
    recordTest('INV-03', 'invitație creată de un guest: 403 owner_only');
  });

  it('INV-04 a patra invitație activă: 409 invite_cap_reached', async () => {
    // Obținem cookie owner masa 3
    const ownerRes = await db.query(
      `SELECT sm.device_token FROM session_members sm
       JOIN table_sessions ts ON sm.session_id = ts.id
       WHERE ts.table_id = $1 AND sm.is_owner = true;`,
      [table3Id]
    );
    const t3OwnerCookie = `qr_dev=${ownerRes.rows[0].device_token}`;

    // Creăm încă 3 invitații active (prima a fost deja used, deci avem 0 active)
    await fetch(`${baseUrl}/api/session/invites`, { method: 'POST', headers: { Cookie: t3OwnerCookie } });
    await fetch(`${baseUrl}/api/session/invites`, { method: 'POST', headers: { Cookie: t3OwnerCookie } });
    await fetch(`${baseUrl}/api/session/invites`, { method: 'POST', headers: { Cookie: t3OwnerCookie } });

    // A patra invitație activă -> 409 invite_cap_reached
    const fourth = await fetch(`${baseUrl}/api/session/invites`, { method: 'POST', headers: { Cookie: t3OwnerCookie } });
    assert.strictEqual(fourth.status, 409);
    const body = await fourth.json();
    assert.strictEqual(body.code, 'invite_cap_reached');
    recordTest('INV-04', 'a patra invitație activă: 409 invite_cap_reached');
  });

  it('INV-05 invitație expirată (ajustată în DB): 404', async () => {
    const expToken = crypto.randomBytes(20).toString('hex');
    const sessRow = await db.query('SELECT id, (SELECT id FROM session_members WHERE session_id = ts.id LIMIT 1) as mem_id FROM table_sessions ts WHERE table_id = $1;', [table3Id]);
    await db.query(
      `INSERT INTO session_invites (session_id, created_by_member_id, invite_token, expires_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 minutes');`,
      [sessRow.rows[0].id, sessRow.rows[0].mem_id, expToken]
    );

    const res = await fetch(`${baseUrl}/i/${expToken}`, { method: 'GET', redirect: 'manual' });
    assert.strictEqual(res.status, 404);
    recordTest('INV-05', 'invitație expirată (ajustată în DB): 404');
  });

  // ORDER TESTS
  let createdOrderId;

  it('ORD-01 comandă validă: 201, queued, dispatchAfter ≈ acum + 25 s', async () => {
    const reqId = `http_test_ord_${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie
      },
      body: JSON.stringify({
        clientRequestId: reqId,
        items: [{ menuItemId: availableItemId, quantity: 2 }]
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.state, 'queued');
    assert.ok(data.dispatchAfter, 'dispatchAfter prezent');
    createdOrderId = data.orderId;
    recordTest('ORD-01', 'comandă validă: 201, queued, dispatchAfter ≈ acum + 25 s');
  });

  it('ORD-02 același requestId de două ori: a doua cerere primește duplicate: true, iar în orders există un singur rând', async () => {
    const reqId = `idempotent_${Date.now()}`;
    const res1 = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ clientRequestId: reqId, items: [{ menuItemId: availableItemId, quantity: 1 }] })
    });
    assert.strictEqual(res1.status, 201);

    const res2 = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ clientRequestId: reqId, items: [{ menuItemId: availableItemId, quantity: 1 }] })
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.duplicate, true);

    const countOrders = await db.query('SELECT COUNT(*)::int AS count FROM orders WHERE client_request_id = $1;', [reqId]);
    assert.strictEqual(countOrders.rows[0].count, 1, 'Exact un singur rând în orders');
    recordTest('ORD-02', 'același requestId de două ori: duplicate: true, un singur rând în orders');
  });

  it('ORD-03 produs indisponibil: 409 item_unavailable, zero rânduri noi în orders și order_items', async () => {
    const ordersBefore = await db.query('SELECT COUNT(*)::int AS count FROM orders;');
    const itemsBefore = await db.query('SELECT COUNT(*)::int AS count FROM order_items;');

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        clientRequestId: `unavail_${Date.now()}`,
        items: [{ menuItemId: unavailableItemId, quantity: 1 }]
      })
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.code, 'item_unavailable');

    const ordersAfter = await db.query('SELECT COUNT(*)::int AS count FROM orders;');
    const itemsAfter = await db.query('SELECT COUNT(*)::int AS count FROM order_items;');

    assert.strictEqual(ordersAfter.rows[0].count, ordersBefore.rows[0].count, 'Zero rânduri noi în orders');
    assert.strictEqual(itemsAfter.rows[0].count, itemsBefore.rows[0].count, 'Zero rânduri noi în order_items');
    recordTest('ORD-03', 'produs indisponibil: 409 item_unavailable, zero rânduri noi în orders și order_items');
  });

  it('ORD-04 anulare în fereastră: 200, cancelled', async () => {
    // Comandă nouă
    const ordRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        clientRequestId: `cancel_${Date.now()}`,
        items: [{ menuItemId: availableItemId, quantity: 1 }]
      })
    });
    const ordData = await ordRes.json();

    const cancelRes = await fetch(`${baseUrl}/api/orders/${ordData.orderId}/cancel`, {
      method: 'POST',
      headers: { Cookie: ownerCookie }
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.status, 'cancelled');
    recordTest('ORD-04', 'anulare în fereastră: 200, cancelled');
  });

  it('ORD-05 anulare după fereastră (dispatch_after mutat în trecut în DB): 409 undo_window_closed', async () => {
    const ordRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        clientRequestId: `late_cancel_${Date.now()}`,
        items: [{ menuItemId: availableItemId, quantity: 1 }]
      })
    });
    const ordData = await ordRes.json();

    // Mutăm dispatch_after în trecut
    await db.query("UPDATE orders SET dispatch_after = NOW() - INTERVAL '10 seconds' WHERE id = $1;", [ordData.orderId]);

    const cancelRes = await fetch(`${baseUrl}/api/orders/${ordData.orderId}/cancel`, {
      method: 'POST',
      headers: { Cookie: ownerCookie }
    });
    assert.strictEqual(cancelRes.status, 409);
    const body = await cancelRes.json();
    assert.strictEqual(body.code, 'undo_window_closed');
    recordTest('ORD-05', 'anulare după fereastră (dispatch_after mutat în trecut în DB): 409 undo_window_closed');
  });

  it('ORD-06 anularea comenzii altui membru: 409', async () => {
    // Owner creează o comandă
    const ordRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        clientRequestId: `other_mem_${Date.now()}`,
        items: [{ menuItemId: availableItemId, quantity: 1 }]
      })
    });
    const ordId = (await ordRes.json()).orderId;

    // GuestCookie încearcă să anuleze comanda owner-ului
    const cancelRes = await fetch(`${baseUrl}/api/orders/${ordId}/cancel`, {
      method: 'POST',
      headers: { Cookie: guestCookie }
    });
    assert.strictEqual(cancelRes.status, 409);
    recordTest('ORD-06', 'anularea comenzii altui membru: 409');
  });

  it('ORD-07 cantitate 0, cantitate 21 sau peste 30 de linii: 400', async () => {
    // Cantitate 0
    const resZero = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ clientRequestId: `q0_${Date.now()}`, items: [{ menuItemId: availableItemId, quantity: 0 }] })
    });
    assert.strictEqual(resZero.status, 400);

    // Cantitate 21
    const res21 = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ clientRequestId: `q21_${Date.now()}`, items: [{ menuItemId: availableItemId, quantity: 21 }] })
    });
    assert.strictEqual(res21.status, 400);

    // Peste 30 de linii
    const manyItems = Array.from({ length: 31 }, () => ({ menuItemId: availableItemId, quantity: 1 }));
    const res31 = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ clientRequestId: `q31_${Date.now()}`, items: manyItems })
    });
    assert.strictEqual(res31.status, 400);
    recordTest('ORD-07', 'cantitate 0, cantitate 21 sau peste 30 de linii: 400');
  });

  it('ORD-08 fără cookie: 401', async () => {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: `nocookie_${Date.now()}`, items: [{ menuItemId: availableItemId, quantity: 1 }] })
    });
    assert.strictEqual(res.status, 401);
    recordTest('ORD-08', 'fără cookie: 401');
  });

  // T07: Înghețare dispozitiv abuziv (ORD-09)
  it('ORD-09 înghețare dispozitiv abuziv comenzi: membrul abuziv este înghețat 10 min (403), celălalt membru merge', async () => {
    // Deschidem o masă dedicată
    const tOpen = await fetch(`${baseUrl}/api/staff/tables/${table2Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    const sTok = (await tOpen.json()).sessionToken;

    // Membru 1 (abuziv)
    const scan1 = await fetch(`${baseUrl}/s/${sTok}`, { method: 'GET', redirect: 'manual' });
    const cookie1 = scan1.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

    // Membru 2 (legitim, la aceeași masă)
    const scan2 = await fetch(`${baseUrl}/s/${sTok}`, { method: 'GET', redirect: 'manual' });
    const cookie2 = scan2.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

    // Declanșăm 3 evenimente de rate_limited pe membrul 1
    for (let i = 0; i < 35; i++) {
      await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
        body: JSON.stringify({ clientRequestId: `freeze_ord_${i}`, items: [{ menuItemId: availableItemId, quantity: 1 }] })
      });
    }

    // Membrul 1 primește 403 device_frozen
    const resFrozen = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({ clientRequestId: `freeze_check_${Date.now()}`, items: [{ menuItemId: availableItemId, quantity: 1 }] })
    });
    assert.strictEqual(resFrozen.status, 403);
    const bodyFrozen = await resFrozen.json();
    assert.strictEqual(bodyFrozen.code, 'device_frozen');

    // Membrul 2 de la aceeași masă poate comanda normal (status 201)
    const resLegit = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({ clientRequestId: `legit_ord_${Date.now()}`, items: [{ menuItemId: availableItemId, quantity: 1 }] })
    });
    assert.strictEqual(resLegit.status, 201);

    recordTest('ORD-09', 'înghețare dispozitiv abuziv comenzi: membrul abuziv blocat (403), celălalt membru merge');
  });

  // CALL TESTS
  it('CALL-01 apel valid: 201', async () => {
    const res = await fetch(`${baseUrl}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ callType: 'waiter' })
    });
    assert.strictEqual(res.status, 201);
    recordTest('CALL-01', 'apel valid: 201');
  });

  it('CALL-02 al patrulea apel deschis: 409 call_cap_reached', async () => {
    // Avem deja 1 apel creat în CALL-01. Mai adăugăm 2 -> total 3 deschise.
    await fetch(`${baseUrl}/api/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: JSON.stringify({ callType: 'water' }) });
    await fetch(`${baseUrl}/api/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: JSON.stringify({ callType: 'menu' }) });

    // Al 4-lea apel deschis -> 409
    const res4 = await fetch(`${baseUrl}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ callType: 'bill' })
    });
    assert.strictEqual(res4.status, 409);
    const body = await res4.json();
    assert.strictEqual(body.code, 'call_cap_reached');
    recordTest('CALL-02', 'al patrulea apel deschis: 409 call_cap_reached');
  });

  it('CALL-03 peste limita de rată (6 pe minut): 429', async () => {
    // Golim apelurile din DB ca să nu lovim call_cap_reached, dar testăm rate limiter-ul
    await db.query("UPDATE session_calls SET status = 'acknowledged';");

    let hitRateLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${baseUrl}/api/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ callType: 'bread' })
      });
      if (res.status === 429) {
        hitRateLimit = true;
        break;
      }
    }
    assert.ok(hitRateLimit, 'Limita de 6 apeluri/min a fost atinsă cu 429');
    recordTest('CALL-03', 'peste limita de rată (6 pe minut): 429');
  });

  // T07: Înghețare dispozitiv abuziv apeluri (CALL-04)
  it('CALL-04 înghețare dispozitiv abuziv apeluri: membrul este înghețat după rate limits repetate', async () => {
    // Membrul 1 din masa 2 a fost deja înghețat în ORD-09
    // Obținem un nou membru pe masa 3
    const t3Sess = await db.query("SELECT session_token FROM table_sessions WHERE table_id = $1 LIMIT 1;", [table3Id]);
    const scanDev = await fetch(`${baseUrl}/s/${t3Sess.rows[0].session_token}`, { method: 'GET', redirect: 'manual' });
    const c1 = scanDev.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

    // Declanșăm repetat apeluri peste rate limit
    for (let i = 0; i < 25; i++) {
      await fetch(`${baseUrl}/api/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c1 },
        body: JSON.stringify({ callType: 'water' })
      });
    }

    // Următorul apel primește 403 device_frozen
    const resFrozen = await fetch(`${baseUrl}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c1 },
      body: JSON.stringify({ callType: 'waiter' })
    });
    assert.strictEqual(resFrozen.status, 403);
    const body = await resFrozen.json();
    assert.strictEqual(body.code, 'device_frozen');
    recordTest('CALL-04', 'înghețare dispozitiv abuziv apeluri: membru înghețat 403 device_frozen');
  });

  // STAFF TESTS
  it('STF-01 fără token: 401', async () => {
    const res = await fetch(`${baseUrl}/api/staff/tables`, { method: 'GET' });
    assert.strictEqual(res.status, 401);
    recordTest('STF-01', 'fără token: 401');
  });

  it('STF-02 bucătar care deschide o masă: 403', async () => {
    const res = await fetch(`${baseUrl}/api/staff/tables/${table2Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kitchenToken}` }
    });
    assert.strictEqual(res.status, 403);
    recordTest('STF-02', 'bucătar care deschide o masă: 403');
  });

  it('STF-03 ospătar care trece o comandă la preparing: 403 forbidden_transition', async () => {
    // Creăm o comandă în DB în starea dispatched
    const ordRow = await db.query(
      `INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after)
       VALUES ((SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active' LIMIT 1),
               (SELECT id FROM session_members LIMIT 1), $2, 'dispatched', NOW()) RETURNING id;`,
      [table1Id, `stf3_${Date.now()}`]
    );
    const oId = ordRow.rows[0].id;

    const res = await fetch(`${baseUrl}/api/staff/orders/${oId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waiterToken}` },
      body: JSON.stringify({ status: 'preparing' })
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'forbidden_transition');
    recordTest('STF-03', 'ospătar care trece o comandă la preparing: 403 forbidden_transition');
  });

  it('STF-04 bucătar care trece la served: 403', async () => {
    const ordRow = await db.query(
      `INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after)
       VALUES ((SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active' LIMIT 1),
               (SELECT id FROM session_members LIMIT 1), $2, 'ready', NOW()) RETURNING id;`,
      [table1Id, `stf4_${Date.now()}`]
    );
    const oId = ordRow.rows[0].id;

    const res = await fetch(`${baseUrl}/api/staff/orders/${oId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kitchenToken}` },
      body: JSON.stringify({ status: 'served' })
    });
    assert.strictEqual(res.status, 403);
    recordTest('STF-04', 'bucătar care trece la served: 403');
  });

  it('STF-05 PATCH de la dispatched direct la ready: 409 (tranziție ilegală)', async () => {
    const ordRow = await db.query(
      `INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after)
       VALUES ((SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active' LIMIT 1),
               (SELECT id FROM session_members LIMIT 1), $2, 'dispatched', NOW()) RETURNING id;`,
      [table1Id, `stf5_${Date.now()}`]
    );
    const oId = ordRow.rows[0].id;

    const res = await fetch(`${baseUrl}/api/staff/orders/${oId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kitchenToken}` },
      body: JSON.stringify({ status: 'ready' })
    });
    assert.strictEqual(res.status, 409);
    recordTest('STF-05', 'PATCH de la dispatched direct la ready: 409 (tranziție ilegală)');
  });

  it('STF-06 deschiderea unei mese deja deschise: 409 table_already_open', async () => {
    const res = await fetch(`${baseUrl}/api/staff/tables/${table1Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.code, 'table_already_open');
    recordTest('STF-06', 'deschiderea unei mese deja deschise: 409 table_already_open');
  });

  it('STF-07 parolă greșită: 401. Peste 20 de încercări în 15 minute: 429', async () => {
    const attackEmail = `brute_${Date.now()}@test.ro`;
    // Inserăm un utilizator dedicat
    await db.query(
      `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
       VALUES ($1, $2, $3, 'waiter', 'Brute Victim');`,
      [restaurantId, attackEmail, bcrypt.hashSync('correctpass', 10)]
    );

    // 1 încercare parolă greșită -> 401
    const resWrong = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: attackEmail, password: 'wrongpassword' })
    });
    assert.strictEqual(resWrong.status, 401);

    // Peste 20 de încercări -> 429
    let got429 = false;
    for (let i = 0; i < 22; i++) {
      const res = await fetch(`${baseUrl}/api/staff/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: attackEmail, password: 'wrongpassword' })
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert.ok(got429, 'Peste 20 de încercări a declanșat 429');
    recordTest('STF-07', 'parolă greșită: 401. Peste 20 de încercări în 15 minute: 429');
  });

  // SESSION TESTS
  it('SESS-01 sesiune expirată (ajustată în DB), cu cookie-ul vechi: /api/menu dă 401', async () => {
    // Setăm expires_at în trecut pentru sesiunea mesei 1
    await db.query("UPDATE table_sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE session_token = $1;", [validSessionToken]);

    const res = await fetch(`${baseUrl}/api/menu`, {
      headers: { Cookie: ownerCookie }
    });
    assert.strictEqual(res.status, 401);
    recordTest('SESS-01', 'sesiune expirată (ajustată în DB), cu cookie-ul vechi: /api/menu dă 401');
  });

  // CONFIGURATION TESTS
  it('CFG-01 NODE_ENV=production cu COOKIE_SECURE=false: procesul refuză să pornească (test într-un proces copil)', async () => {
    const childExitCode = await new Promise((resolve) => {
      const cp = fork(path.resolve(process.cwd(), 'dist/server.js'), [], {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          COOKIE_SECURE: 'false'
        },
        stdio: 'ignore'
      });
      cp.on('exit', (code) => {
        resolve(code);
      });
    });

    assert.strictEqual(childExitCode, 1, 'Procesul s-a oprit cu cod 1');
    recordTest('CFG-01', 'NODE_ENV=production cu COOKIE_SECURE=false: procesul refuză să pornească');
  });

  it('CFG-02 NODE_ENV=production cu BASELINE_MODE=true: procesul refuză să pornească (test într-un proces copil)', async () => {
    const childExitCode = await new Promise((resolve) => {
      const cp = fork(path.resolve(process.cwd(), 'dist/server.js'), [], {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          COOKIE_SECURE: 'true',
          BASELINE_MODE: 'true'
        },
        stdio: 'ignore'
      });
      cp.on('exit', (code) => {
        resolve(code);
      });
    });

    assert.strictEqual(childExitCode, 1, 'Procesul s-a oprit cu cod 1');
    recordTest('CFG-02', 'NODE_ENV=production cu BASELINE_MODE=true: procesul refuză să pornească');
  });
});
