import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { createApp, createServer } from '../dist/server.js';
import { startWorker, stopWorker } from '../dist/worker.js';
import { db } from '../dist/db.js';
import { seedDatabase } from './seed.mjs';
import { config } from '../dist/config.js';

const logMessages = [];
function log(msg) {
  console.log(msg);
  logMessages.push(msg);
}

async function runSmokeTest() {
  log('======================================================');
  log('START SMOKE TEST END-TO-END (T01)');
  log(`Timp pornire: ${new Date().toISOString()}`);
  log('======================================================');

  // 1. Inițializare DB & Seed
  const { table1Id } = await seedDatabase();
  log('✓ Seed finalizat cu succes.');

  // 2. Pornire server pe portul din config
  const app = createApp();
  const { server } = createServer(app);
  startWorker(200);

  await new Promise((resolve) => {
    server.listen(config.port, () => {
      log(`✓ Server pornit pe portul ${config.port}`);
      resolve(null);
    });
  });

  const baseUrl = config.appUrl;

  try {
    // a) Autentificare ca ospatar@demo.ro, deschide prima masă și primește url
    const loginRes = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ospatar@demo.ro', password: 'parola123' })
    });
    if (!loginRes.ok) throw new Error(`Login ospatar failed: ${loginRes.status}`);
    const loginData = await loginRes.json();
    const waiterToken = loginData.token;
    log('✓ a1) Autentificare ospatar reușită.');

    const openTableRes = await fetch(`${baseUrl}/api/staff/tables/${table1Id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${waiterToken}`
      }
    });
    if (!openTableRes.ok) throw new Error(`Open table failed: ${openTableRes.status}`);
    const openTableData = await openTableRes.json();
    const scanUrl = openTableData.url;
    log(`✓ a2) Masă deschisă. URL sesiune QR: ${scanUrl}`);

    // b) GET url cu redirect: 'manual' și verificare: 302, Set-Cookie: qr_dev cu HttpOnly și SameSite=Strict, Location spre /menu
    const scanRes = await fetch(scanUrl, {
      method: 'GET',
      redirect: 'manual'
    });

    if (scanRes.status !== 302) {
      throw new Error(`Așteptat 302 la scanare, primit: ${scanRes.status}`);
    }

    const setCookie = scanRes.headers.get('set-cookie') || '';
    const location = scanRes.headers.get('location') || '';

    if (!setCookie.includes('qr_dev=')) {
      throw new Error(`Cookie qr_dev lipsă în Set-Cookie: ${setCookie}`);
    }
    if (!setCookie.toLowerCase().includes('httponly')) {
      throw new Error(`Cookie qr_dev nu conține HttpOnly`);
    }
    if (!setCookie.toLowerCase().includes('samesite=strict')) {
      throw new Error(`Cookie qr_dev nu conține SameSite=Strict`);
    }
    if (!location.endsWith('/menu')) {
      throw new Error(`Location nu duce la /menu: ${location}`);
    }

    // Extragere valoare cookie qr_dev
    const cookieMatch = setCookie.match(/qr_dev=([^;]+)/);
    const qrDevCookie = cookieMatch ? cookieMatch[1] : '';
    const cookieHeader = `qr_dev=${qrDevCookie}`;
    log(`✓ b) Scanare validată: 302 redirect la /menu, Set-Cookie qr_dev cu HttpOnly și SameSite=Strict.`);

    // c) Cu cookie-ul: GET /api/menu, GET /api/session
    const menuRes = await fetch(`${baseUrl}/api/menu`, {
      headers: { Cookie: cookieHeader }
    });
    if (!menuRes.ok) throw new Error(`GET /api/menu a eșuat: ${menuRes.status}`);
    const menuItems = await menuRes.json();
    if (!Array.isArray(menuItems) || menuItems.length === 0) {
      throw new Error('Meniul returnat este gol');
    }
    const pizza = menuItems.find(i => i.available);
    log(`✓ c1) GET /api/menu a returnat ${menuItems.length} produse.`);

    const sessionRes = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookieHeader }
    });
    if (!sessionRes.ok) throw new Error(`GET /api/session a eșuat: ${sessionRes.status}`);
    const sessionData = await sessionRes.json();
    log(`✓ c2) GET /api/session a returnat datele mesei ${sessionData.tableNumber} (isOwner: ${sessionData.isOwner}).`);

    // e) Autentificare bucătar și conectare Socket.IO bucătărie
    const kitchenLoginRes = await fetch(`${baseUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bucatar@demo.ro', password: 'parola123' })
    });
    const kitchenLoginData = await kitchenLoginRes.json();
    const kitchenToken = kitchenLoginData.token;

    const kitchenSocket = ioClient(baseUrl, {
      auth: { token: kitchenToken },
      transports: ['websocket', 'polling']
    });

    await new Promise((resolve, reject) => {
      kitchenSocket.on('connect', () => {
        log('✓ e1) Socket bucătărie conectat cu succes.');
        resolve(null);
      });
      kitchenSocket.on('connect_error', (err) => {
        reject(new Error(`Socket bucatarie connect_error: ${err.message}`));
      });
    });

    // d) POST /api/orders cu un produs: primește queued și dispatchAfter
    const queuedTime = Date.now();
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        clientRequestId: `smoke_req_${queuedTime}`,
        items: [{ menuItemId: pizza.id, quantity: 2 }]
      })
    });

    if (orderRes.status !== 201) {
      const errText = await orderRes.text();
      throw new Error(`POST /api/orders failed: ${orderRes.status} - ${errText}`);
    }
    const orderData = await orderRes.json();
    if (orderData.state !== 'queued' || !orderData.dispatchAfter) {
      throw new Error(`Așteptat stare queued și dispatchAfter, primit: ${JSON.stringify(orderData)}`);
    }
    const orderId = orderData.orderId;
    log(`✓ d) Comandă ${orderId} creată în starea queued. Dispatch programat la: ${orderData.dispatchAfter}`);

    // e2) Așteaptă evenimentul order:state cu 'dispatched' pe socket-ul bucătăriei
    log('Așteptare trecere automată la dispatched de către worker...');
    const dispatchedPayload = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout la așteptarea stării dispatched'));
      }, 35000);

      kitchenSocket.on('order:state', (event) => {
        if (event.orderId === orderId && event.state === 'dispatched') {
          clearTimeout(timeout);
          resolve(event);
        }
      });
    });

    const dispatchedTime = Date.now();
    const elapsedMs = dispatchedTime - queuedTime;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
    log(`✓ e2) Bucătăria a primit automat starea dispatched pentru comanda ${orderId}!`);
    log(`>>> TIMP MĂSURAT ÎNTRE QUEUED ȘI DISPATCHED: ${elapsedMs} ms (~${elapsedSeconds} secunde) <<<`);

    // f) Bucătăria face PATCH preparing, apoi ready; ospătarul face PATCH served
    const prepRes = await fetch(`${baseUrl}/api/staff/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${kitchenToken}`
      },
      body: JSON.stringify({ status: 'preparing' })
    });
    if (!prepRes.ok) throw new Error(`PATCH preparing failed: ${prepRes.status}`);
    log('✓ f1) Bucătăria a trecut comanda la: preparing');

    const readyRes = await fetch(`${baseUrl}/api/staff/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${kitchenToken}`
      },
      body: JSON.stringify({ status: 'ready' })
    });
    if (!readyRes.ok) throw new Error(`PATCH ready failed: ${readyRes.status}`);
    log('✓ f2) Bucătăria a trecut comanda la: ready');

    const servedRes = await fetch(`${baseUrl}/api/staff/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${waiterToken}`
      },
      body: JSON.stringify({ status: 'served' })
    });
    if (!servedRes.ok) throw new Error(`PATCH served failed: ${servedRes.status}`);
    log('✓ f3) Ospătarul a trecut comanda la: served');

    // g) POST /api/calls, apoi POST /api/staff/calls/:id/ack
    const callRes = await fetch(`${baseUrl}/api/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader
      },
      body: JSON.stringify({ callType: 'bill' })
    });
    if (callRes.status !== 201) throw new Error(`POST /api/calls failed: ${callRes.status}`);
    const callData = await callRes.json();
    log(`✓ g1) Apel ospătar creat cu succes (id: ${callData.id}).`);

    const ackRes = await fetch(`${baseUrl}/api/staff/calls/${callData.id}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${waiterToken}`
      }
    });
    if (!ackRes.ok) throw new Error(`Ack call failed: ${ackRes.status}`);
    log('✓ g2) Ospătarul a confirmat apelul (acknowledged).');

    // h) Închide sesiunea; GET url trebuie să dea 404
    const closeRes = await fetch(`${baseUrl}/api/staff/tables/${table1Id}/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${waiterToken}`
      }
    });
    if (!closeRes.ok) throw new Error(`Close table failed: ${closeRes.status}`);
    log('✓ h1) Sesiune masă închisă de ospătar.');

    const scanAfterCloseRes = await fetch(scanUrl, {
      method: 'GET',
      redirect: 'manual'
    });
    if (scanAfterCloseRes.status !== 404) {
      throw new Error(`Așteptat 404 la scanare după închidere, primit: ${scanAfterCloseRes.status}`);
    }
    log('✓ h2) GET url după închiderea sesiunii a returnat 404 Not Found conform specificației.');

    kitchenSocket.disconnect();
    stopWorker();

    log('======================================================');
    log('SMOKE TEST T01 FINALIZAT CU SUCCES! STATUS: PASS');
    log('======================================================');

    // Salvare rezultate în results/smoke.log
    const resultsDir = path.resolve(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, 'smoke.log'),
      logMessages.join('\n') + `\n\nRezumat: Timp masurat intre queued si dispatched: ${elapsedMs} ms\nStatus: PASS\nData: ${new Date().toISOString()}\n`,
      'utf8'
    );

    server.close();
    await db.close();
    process.exit(0);
  } catch (err) {
    log(`EROARE SMOKE TEST: ${err.message}`);
    const resultsDir = path.resolve(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, 'smoke.log'),
      logMessages.join('\n') + `\nEROARE: ${err.stack}\nStatus: FAIL\nData: ${new Date().toISOString()}\n`,
      'utf8'
    );
    stopWorker();
    server.close();
    await db.close();
    process.exit(1);
  }
}

runSmokeTest();

