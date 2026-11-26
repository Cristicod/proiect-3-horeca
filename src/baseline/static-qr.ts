import { Request, Response } from 'express';
import { db } from '../db.js';
import { ioEmitter } from '../socket.js';

/**
 * Endpoint Baseline: Comandă pe bază de număr masă (fără sesiune dinamică, fără cookie de securitate).
 * Simulează fluxul tradițional QR static.
 */
export async function handleStaticQrOrder(req: Request, res: Response) {
  const { tableNumber, clientRequestId, items } = req.body;

  if (!tableNumber || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Date invalide' });
  }

  // 1. Identificare masă
  const tableRes = await db.query(
    'SELECT id, restaurant_id FROM tables WHERE table_number = $1 LIMIT 1;',
    [tableNumber]
  );
  if (tableRes.rowCount === 0) {
    return res.status(404).json({ error: 'Masa nu a fost găsită' });
  }
  const table = tableRes.rows[0];

  // 2. Sesiune statică generică
  let sessRes = await db.query(
    "SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active' LIMIT 1;",
    [table.id]
  );
  let sessionId: string;
  if (sessRes.rowCount === 0) {
    const insSess = await db.query(
      "INSERT INTO table_sessions (table_id, session_token, state) VALUES ($1, $2, 'active') RETURNING id;",
      [table.id, `static_sess_${Date.now()}_${Math.random()}`]
    );
    sessionId = insSess.rows[0].id;
  } else {
    sessionId = sessRes.rows[0].id;
  }

  // 3. Membru static generic
  let memRes = await db.query(
    "SELECT id FROM session_members WHERE session_id = $1 LIMIT 1;",
    [sessionId]
  );
  let memberId: string;
  if (memRes.rowCount === 0) {
    const insMem = await db.query(
      "INSERT INTO session_members (session_id, device_token, is_owner, nickname) VALUES ($1, $2, true, 'Static Guest') RETURNING id;",
      [sessionId, `static_dev_${Date.now()}_${Math.random()}`]
    );
    memberId = insMem.rows[0].id;
  } else {
    memberId = memRes.rows[0].id;
  }

  // 4. Inserare comandă (aceeași scriere în DB)
  const reqId = clientRequestId || `baseline_req_${Date.now()}_${Math.random()}`;
  const orderRes = await db.query(
    `INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after)
     VALUES ($1, $2, $3, 'queued', NOW() + INTERVAL '25 seconds')
     RETURNING id, state, dispatch_after;`,
    [sessionId, memberId, reqId]
  );

  const orderId = orderRes.rows[0].id;

  for (const item of items) {
    await db.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price)
       VALUES ($1, $2, $3, 25.00);`,
      [orderId, item.menuItemId || (await db.query('SELECT id FROM menu_items LIMIT 1;')).rows[0].id, item.quantity || 1]
    );
  }

  // 5. Emitere eveniment Socket.IO exact ca în fluxul securizat
  ioEmitter.emitToTable(table.id, 'order:state', {
    orderId,
    state: 'queued',
    clientRequestId: reqId
  });

  return res.status(201).json({
    orderId,
    state: 'queued',
    dispatchAfter: orderRes.rows[0].dispatch_after
  });
}

