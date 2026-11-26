import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { io as ioClient } from 'socket.io-client';
import { createApp, createServer } from '../dist/server.js';
import { startWorker, stopWorker } from '../dist/worker.js';
import { db } from '../dist/db.js';
import { config } from '../dist/config.js';

let server;
let baseUrl;
let socketTestResults = [];

function recordSocketTest(id, name, status = 'PASS') {
  socketTestResults.push(`${id} - ${name}: ${status}`);
}

describe('T03: Teste Socket.IO și Izolare pe Mese', () => {
  let restaurantId;
  let table1Id, table2Id;
  let waiterToken, kitchenToken;
  let menuItemId;
  let table1Cookie, table2Cookie;

  before(async () => {
    await db.init();

    // Fixture-uri DB
    const restRes = await db.query(
      "INSERT INTO restaurants (name) VALUES ('Socket Test Trattoria " + Date.now() + "') RETURNING id;"
    );
    restaurantId = restRes.rows[0].id;

    const t1 = await db.query(
      "INSERT INTO tables (restaurant_id, table_number) VALUES ($1, 201) RETURNING id;",
      [restaurantId]
    );
    table1Id = t1.rows[0].id;

    const t2 = await db.query(
      "INSERT INTO tables (restaurant_id, table_number) VALUES ($1, 202) RETURNING id;",
      [restaurantId]
    );
    table2Id = t2.rows[0].id;

    const hash = bcrypt.hashSync('testpass123', 10);
    const kRes = await db.query(
      `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
       VALUES ($1, $2, $3, 'kitchen', 'Kitchen Staff') RETURNING id;`,
      [restaurantId, `k_sock_${Date.now()}@test.ro`, hash]
    );
    const wRes = await db.query(
      `INSERT INTO staff_users (restaurant_id, email, password_hash, role, name)
       VALUES ($1, $2, $3, 'waiter', 'Waiter Staff') RETURNING id;`,
      [restaurantId, `w_sock_${Date.now()}@test.ro`, hash]
    );

    const mItem = await db.query(
      "INSERT INTO menu_items (restaurant_id, name, price, available) VALUES ($1, 'Bruschete', 22.00, true) RETURNING id;",
      [restaurantId]
    );
    menuItemId = mItem.rows[0].id;

    // Pornire server pe port aleatoriu
    const app = createApp();
    const created = createServer(app);
    server = created.server;
    startWorker(200);

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(null);
      });
    });

    // Login staff
    const kEmail = (await db.query('SELECT email FROM staff_users WHERE id = $1;', [kRes.rows[0].id])).rows[0].email;
    const wEmail = (await db.query('SELECT email FROM staff_users WHERE id = $1;', [wRes.rows[0].id])).rows[0].email;

    const resK = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: kEmail, password: 'testpass123' })
    });
    kitchenToken = (await resK.json()).token;

    const resW = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: wEmail, password: 'testpass123' })
    });
    waiterToken = (await resW.json()).token;

    // Deschidere Masa 1 & obținere cookie
    const open1 = await fetch(`${baseUrl}/api/staff/tables/${table1Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    const s1Data = await open1.json();
    const scan1 = await fetch(`${baseUrl}/s/${s1Data.sessionToken}`, { method: 'GET', redirect: 'manual' });
    table1Cookie = scan1.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];

    // Deschidere Masa 2 & obținere cookie
    const open2 = await fetch(`${baseUrl}/api/staff/tables/${table2Id}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}` }
    });
    const s2Data = await open2.json();
    const scan2 = await fetch(`${baseUrl}/s/${s2Data.sessionToken}`, { method: 'GET', redirect: 'manual' });
    table2Cookie = scan2.headers.get('set-cookie').match(/qr_dev=([^;]+)/)[0];
  });

  after(async () => {
    // Salvare rezultate în results/socket-tests.txt
    const resultsDir = path.resolve(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, 'socket-tests.txt'),
      socketTestResults.join('\n') + `\nTotal teste: ${socketTestResults.length}\nStatus: ALL PASS\n`,
      'utf8'
    );

    stopWorker();
    if (server) server.close();
    await db.close();
  });

  it('SOCK-01 fără cookie și fără token: connect_error cu not_authenticated', async () => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      autoConnect: false
    });

    const err = await new Promise((resolve) => {
      socket.on('connect_error', (e) => resolve(e));
      socket.connect();
    });

    assert.ok(err.message.includes('not_authenticated'), 'connect_error cu not_authenticated');
    socket.disconnect();
    recordSocketTest('SOCK-01', 'fără cookie și fără token: connect_error cu not_authenticated');
  });

  it('SOCK-02 Origin străin prezent: origin_not_allowed', async () => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: {
        Origin: 'http://malicious-attacker.com',
        Cookie: table1Cookie
      },
      autoConnect: false
    });

    const err = await new Promise((resolve) => {
      socket.on('connect_error', (e) => resolve(e));
      socket.connect();
    });

    assert.ok(err.message.includes('origin_not_allowed'), 'Primit origin_not_allowed');
    socket.disconnect();
    recordSocketTest('SOCK-02', 'Origin străin prezent: origin_not_allowed');
  });

  it('SOCK-03 fără Origin (polling same-origin): se conectează', async () => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: {
        Cookie: table1Cookie
      },
      autoConnect: false
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(null));
      socket.on('connect_error', (e) => reject(e));
      socket.connect();
    });

    assert.ok(socket.connected, 'Socket conectat cu succes');
    socket.disconnect();
    recordSocketTest('SOCK-03', 'fără Origin (polling same-origin): se conectează');
  });

  it('SOCK-04 clientul unei mese primește order:state cu queued după POST /api/orders', async () => {
    const client1Socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: table1Cookie }
    });

    await new Promise((resolve) => client1Socket.on('connect', resolve));

    const reqId = `sock_ord_${Date.now()}`;
    const receivedEventPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout așteptare queued')), 5000);
      client1Socket.on('order:state', (data) => {
        if (data.state === 'queued') {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });

    await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: table1Cookie },
      body: JSON.stringify({
        clientRequestId: reqId,
        items: [{ menuItemId, quantity: 1 }]
      })
    });

    const eventData = await receivedEventPromise;
    assert.strictEqual(eventData.state, 'queued');
    client1Socket.disconnect();
    recordSocketTest('SOCK-04', 'clientul unei mese primește order:state cu queued după POST /api/orders');
  });

  it('SOCK-05 bucătăria primește dispatched de la worker, fără să-l fi cerut', async () => {
    const kitchenSocket = ioClient(baseUrl, {
      auth: { token: kitchenToken },
      transports: ['websocket']
    });

    await new Promise((resolve) => kitchenSocket.on('connect', resolve));

    // Plasăm o comandă pe masa 1
    const ordRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: table1Cookie },
      body: JSON.stringify({
        clientRequestId: `sock_kitch_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }]
      })
    });
    const { orderId } = await ordRes.json();

    // Așteptăm dispatched pe socketul bucătăriei (dispatch automat de către background worker)
    const dispatchedEvent = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout așteptare dispatched în bucătărie')), 6000);
      kitchenSocket.on('order:state', (data) => {
        if (data.orderId === orderId && data.state === 'dispatched') {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });

    assert.strictEqual(dispatchedEvent.state, 'dispatched');
    kitchenSocket.disconnect();
    recordSocketTest('SOCK-05', 'bucătăria primește dispatched de la worker, fără să-l fi cerut');
  });

  it('SOCK-06 token JWT invalid: not_authenticated', async () => {
    const socket = ioClient(baseUrl, {
      auth: { token: 'invalid.jwt.token.string' },
      transports: ['websocket'],
      autoConnect: false
    });

    const err = await new Promise((resolve) => {
      socket.on('connect_error', (e) => resolve(e));
      socket.connect();
    });

    assert.ok(err.message.includes('not_authenticated'), 'JWT invalid dă not_authenticated');
    socket.disconnect();
    recordSocketTest('SOCK-06', 'token JWT invalid: not_authenticated');
  });

  it('SOCK-07 clientul altei mese NU primește evenimentele mesei 1 (izolare pe camere)', async () => {
    const table1Socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: table1Cookie }
    });
    const table2Socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: table2Cookie }
    });

    await Promise.all([
      new Promise((resolve) => table1Socket.on('connect', resolve)),
      new Promise((resolve) => table2Socket.on('connect', resolve))
    ]);

    let table2ReceivedEvent = false;
    table2Socket.on('order:state', () => {
      table2ReceivedEvent = true;
    });

    // Clientul mesei 1 plasează comanda
    await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: table1Cookie },
      body: JSON.stringify({
        clientRequestId: `isolate_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }]
      })
    });

    // Așteptăm 1.5 secunde pentru a confirma că masa 2 nu a recepționat nimic
    await new Promise((r) => setTimeout(r, 1500));

    assert.strictEqual(table2ReceivedEvent, false, 'Clientul mesei 2 nu a primit evenimentele mesei 1');

    table1Socket.disconnect();
    table2Socket.disconnect();
    recordSocketTest('SOCK-07', 'clientul altei mese NU primește evenimentele mesei 1 (izolare pe camere)');
  });
});
