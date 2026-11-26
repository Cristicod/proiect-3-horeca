import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { sessionService } from './services/session.service.js';
import { orderService } from './services/order.service.js';
import { callService } from './services/call.service.js';
import { staffService, StaffPayload } from './services/staff.service.js';
import { ioEmitter } from './socket.js';

export const router = Router();

// Middleware autentificare client masă prin cookie qr_dev
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  const deviceToken = req.cookies['qr_dev'];
  // ORD-08: fără cookie -> 401
  if (!deviceToken) {
    return res.status(401).json({ error: 'Neautorizat: Cookie qr_dev lipsă', code: 'unauthorized' });
  }

  const member = await sessionService.getSessionByDeviceToken(deviceToken);
  // SESS-01: sesiune expirată cu cookie vechi -> 401
  if (!member) {
    return res.status(401).json({ error: 'Sesiune inexistentă sau expirată', code: 'session_expired' });
  }

  (req as any).member = member;
  next();
}

// Middleware autentificare personal prin JWT Bearer
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  // STF-01: fără token -> 401
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autentificare personal lipsă', code: 'unauthorized' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as StaffPayload;
    (req as any).staff = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token de autentificare invalid sau expirat', code: 'invalid_token' });
  }
}

// =====================================================================
// RUTE SCANARE QR ȘI INVITAȚII
// =====================================================================

// GET /s/:token - Scanare QR masă
router.get('/s/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const existingCookie = req.cookies['qr_dev'];
  const userAgent = req.headers['user-agent'];
  const ipAddress = req.ip;

  const result = await sessionService.handleScan(token, existingCookie, userAgent, ipAddress);

  if (result.status === 302 && result.cookieToken) {
    // SCAN-01: 302 spre APP_URL/menu, cookie qr_dev cu HttpOnly și SameSite=Strict
    res.cookie('qr_dev', result.cookieToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/'
    });
    return res.redirect(302, result.redirectUrl || `${config.appUrl}/menu`);
  }

  return res.status(result.status).json({ error: result.error, code: result.code });
});

// GET /i/:token - Acceptare invitație
router.get('/i/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const userAgent = req.headers['user-agent'];
  const ipAddress = req.ip;

  const result = await sessionService.handleInvite(token, userAgent, ipAddress);

  if (result.status === 302 && result.cookieToken) {
    // INV-01: cookie qr_dev și redirect spre /menu
    res.cookie('qr_dev', result.cookieToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/'
    });
    return res.redirect(302, result.redirectUrl || `${config.appUrl}/menu`);
  }

  return res.status(result.status).json({ error: result.error, code: result.code });
});

// =====================================================================
// RUTE SESIUNE ȘI MENIU CLIENT
// =====================================================================

// GET /api/session
router.get('/api/session', requireMember, (req: Request, res: Response) => {
  const member = (req as any).member;
  res.json({
    sessionId: member.session_id,
    tableId: member.table_id,
    tableNumber: member.table_number,
    isOwner: member.is_owner,
    nickname: member.nickname,
    memberId: member.member_id
  });
});

// POST /api/session/invites
router.post('/api/session/invites', requireMember, async (req: Request, res: Response) => {
  const member = (req as any).member;
  const result = await sessionService.createInvite(member.member_id);
  res.status(result.status).json(result);
});

// GET /api/menu
router.get('/api/menu', async (req: Request, res: Response) => {
  // Verifică fie membru, fie personal
  const deviceToken = req.cookies['qr_dev'];
  const authHeader = req.headers.authorization;

  let restaurantId: string | null = null;

  if (deviceToken) {
    const member = await sessionService.getSessionByDeviceToken(deviceToken);
    if (!member) {
      // SESS-01
      return res.status(401).json({ error: 'Sesiune expirată', code: 'session_expired' });
    }
    restaurantId = member.restaurant_id;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret) as StaffPayload;
      restaurantId = payload.restaurantId;
    } catch {
      return res.status(401).json({ error: 'Token invalid' });
    }
  } else {
    return res.status(401).json({ error: 'Autentificare necesară' });
  }

  const menuRes = await db.query(
    'SELECT id, name, description, price, available FROM menu_items WHERE restaurant_id = $1 ORDER BY name ASC;',
    [restaurantId]
  );
  res.json(menuRes.rows);
});

// =====================================================================
// RUTE COMENZI (CLIENT)
// =====================================================================

// POST /api/orders
router.post('/api/orders', requireMember, async (req: Request, res: Response) => {
  const member = (req as any).member;
  const { clientRequestId, items } = req.body;

  const result = await orderService.placeOrder(member, clientRequestId, items);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// POST /api/orders/:id/cancel
router.post('/api/orders/:id/cancel', requireMember, async (req: Request, res: Response) => {
  const member = (req as any).member;
  const orderId = String(req.params.id);

  const result = await orderService.cancelOrder(orderId, member.member_id);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// =====================================================================
// RUTE APEL OSPĂTAR (CLIENT)
// =====================================================================

// POST /api/calls
router.post('/api/calls', requireMember, async (req: Request, res: Response) => {
  const member = (req as any).member;
  const { callType } = req.body;

  const result = await callService.createCall(member, callType);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// =====================================================================
// RUTE PERSONAL (STAFF)
// =====================================================================

// POST /api/staff/login
router.post('/api/staff/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email și parola sunt obligatorii' });
  }

  const result = await staffService.login(email, password);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// POST /api/staff/tables/:id/open
router.post('/api/staff/tables/:id/open', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const tableId = String(req.params.id);

  const result = await staffService.openTable(staff, tableId);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// POST /api/staff/tables/:id/close
router.post('/api/staff/tables/:id/close', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const tableId = String(req.params.id);

  const result = await staffService.closeTable(staff, tableId);
  res.status(result.status).json(result.data || { error: result.error });
});

// PATCH /api/staff/orders/:id/status
router.patch('/api/staff/orders/:id/status', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const orderId = String(req.params.id);
  const { status } = req.body;

  const result = await staffService.updateOrderStatus(staff, orderId, status);
  res.status(result.status).json(result.data || { error: result.error, code: result.code });
});

// POST /api/staff/calls/:id/ack
router.post('/api/staff/calls/:id/ack', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const callId = String(req.params.id);

  const result = await callService.acknowledgeCall(callId, staff.id);
  res.status(result.status).json(result.data || { error: result.error });
});

// GET /api/staff/tables - Lista mese și status
router.get('/api/staff/tables', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const tablesRes = await db.query(
    'SELECT * FROM v_table_status WHERE restaurant_id = $1 ORDER BY table_number ASC;',
    [staff.restaurantId]
  );
  res.json(tablesRes.rows);
});

// GET /api/staff/orders - Lista comenzi active
router.get('/api/staff/orders', requireStaff, async (req: Request, res: Response) => {
  const staff = (req as any).staff;
  const ordersRes = await db.query(
    `SELECT o.*, t.table_number,
            json_agg(json_build_object('id', oi.id, 'name', mi.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price)) as items
     FROM orders o
     JOIN table_sessions ts ON o.session_id = ts.id
     JOIN tables t ON ts.table_id = t.id
     JOIN order_items oi ON o.id = oi.order_id
     JOIN menu_items mi ON oi.menu_item_id = mi.id
     WHERE t.restaurant_id = $1 AND o.state NOT IN ('cancelled', 'served')
     GROUP BY o.id, t.table_number
     ORDER BY o.created_at ASC;`,
    [staff.restaurantId]
  );
  res.json(ordersRes.rows);
});

// =====================================================================
// RUTA BASELINE (T05) - Comenzi QR Static fără sesiune / cookie
// =====================================================================
router.post('/baseline/orders', async (req: Request, res: Response) => {
  if (process.env.BASELINE_MODE !== 'true' && !config.baselineMode) {
    return res.status(404).json({ error: 'Endpoint indisponibil (modul baseline este dezactivat)' });
  }

  const { tableNumber, clientRequestId, items } = req.body;

  if (!tableNumber || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Date invalide' });
  }

  const tableRes = await db.query('SELECT id, restaurant_id FROM tables WHERE table_number = $1 LIMIT 1;', [tableNumber]);
  if (tableRes.rowCount === 0) {
    return res.status(404).json({ error: 'Masa nu a fost găsită' });
  }
  const table = tableRes.rows[0];

  // Obține sau creează o sesiune dummy statică pentru masa respectivă
  let sessRes = await db.query("SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active' LIMIT 1;", [table.id]);
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

  // Membru dummy
  let memRes = await db.query("SELECT id FROM session_members WHERE session_id = $1 LIMIT 1;", [sessionId]);
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

  // Scriere comandă în DB
  const reqId = clientRequestId || `req_${Date.now()}`;
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
       VALUES ($1, $2, $3, 20.00);`,
      [orderId, item.menuItemId, item.quantity || 1]
    );
  }

  // Emitere Socket.IO exact ca pe fluxul securizat
  ioEmitter.emitToTable(table.id, 'order:state', {
    orderId,
    state: 'queued',
    clientRequestId: reqId
  });

  return res.status(201).json({
    orderId,
    state: 'queued'
  });
});
