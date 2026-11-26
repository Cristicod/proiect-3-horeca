import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { rateLimiter } from './rateLimiter.js';
import { ioEmitter } from '../socket.js';

export interface StaffPayload {
  id: string;
  restaurantId: string;
  role: 'waiter' | 'kitchen' | 'manager';
  name: string;
}

export class StaffService {
  async login(email: string, password: string) {
    const key = `staff_login:${email}`;
    // STF-07: Peste 20 de încercări în 15 minute -> 429
    if (rateLimiter.isRateLimited(key, 20, 15 * 60 * 1000)) {
      return { status: 429, error: 'Prea multe încercări de autentificare. Reîncercați peste 15 minute.', code: 'rate_limited' };
    }

    const staffRes = await db.query('SELECT * FROM staff_users WHERE email = $1;', [email]);
    if (staffRes.rowCount === 0) {
      return { status: 401, error: 'Email sau parolă incorectă', code: 'invalid_credentials' };
    }

    const staff = staffRes.rows[0];
    const passwordMatch = bcrypt.compareSync(password, staff.password_hash);
    if (!passwordMatch) {
      return { status: 401, error: 'Email sau parolă incorectă', code: 'invalid_credentials' };
    }

    const payload: StaffPayload = {
      id: staff.id,
      restaurantId: staff.restaurant_id,
      role: staff.role,
      name: staff.name
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });

    return {
      status: 200,
      data: {
        token,
        user: payload
      }
    };
  }

  async openTable(staff: StaffPayload, tableId: string) {
    // STF-02: Bucătar care deschide o masă -> 403
    if (staff.role === 'kitchen') {
      return { status: 403, error: 'Personalul din bucătărie nu poate deschide mese', code: 'forbidden' };
    }

    // STF-06: Deschiderea unei mese deja deschise -> 409 table_already_open
    const activeRes = await db.query(
      "SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active';",
      [tableId]
    );

    if (activeRes.rowCount > 0) {
      return { status: 409, error: 'Masa este deja deschisă', code: 'table_already_open' };
    }

    const sessionToken = crypto.randomBytes(24).toString('hex');
    const sessRes = await db.query(
      `INSERT INTO table_sessions (table_id, session_token, state, opened_by_staff_id)
       VALUES ($1, $2, 'active', $3)
       RETURNING id, session_token;`,
      [tableId, sessionToken, staff.id]
    );

    const session = sessRes.rows[0];
    const url = `${config.appUrl}/s/${session.session_token}`;

    return {
      status: 201,
      data: {
        sessionId: session.id,
        sessionToken: session.session_token,
        url
      }
    };
  }

  async closeTable(staff: StaffPayload, tableId: string) {
    if (staff.role === 'kitchen') {
      return { status: 403, error: 'Doar ospătarii sau managerul pot închide o masă' };
    }

    const sessRes = await db.query(
      "SELECT id FROM table_sessions WHERE table_id = $1 AND state = 'active';",
      [tableId]
    );

    if (sessRes.rowCount === 0) {
      return { status: 404, error: 'Masa nu are o sesiune activă' };
    }

    const sessionId = sessRes.rows[0].id;
    await db.query(
      "UPDATE table_sessions SET state = 'closed', closed_at = NOW() WHERE id = $1;",
      [sessionId]
    );

    // Notificare Socket.IO că sesiunea mesei a fost închisă
    ioEmitter.emitToTable(tableId, 'session:closed', {
      tableId,
      sessionId,
      message: 'Sesiunea a fost închisă de către personal.'
    });

    return { status: 200, data: { status: 'closed' } };
  }

  async updateOrderStatus(staff: StaffPayload, orderId: string, newStatus: string) {
    const orderRes = await db.query(
      `SELECT o.*, ts.table_id 
       FROM orders o 
       JOIN table_sessions ts ON o.session_id = ts.id 
       WHERE o.id = $1;`,
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      return { status: 404, error: 'Comandă inexistentă' };
    }

    const order = orderRes.rows[0];
    const currentStatus = order.state;

    // STF-03: Ospătar care trece o comandă la preparing -> 403 forbidden_transition
    if (newStatus === 'preparing' && staff.role === 'waiter') {
      return { status: 403, error: 'Ospătarul nu poate trece o comandă în starea preparing', code: 'forbidden_transition' };
    }

    // STF-04: Bucătar care trece o comandă la served -> 403 forbidden_transition
    if (newStatus === 'served' && staff.role === 'kitchen') {
      return { status: 403, error: 'Bucătarul nu poate trece o comandă în starea served', code: 'forbidden_transition' };
    }

    // STF-05: Verificare tranziții permise (nu se poate sări de la dispatched la ready direct)
    const validTransitions: Record<string, string[]> = {
      dispatched: ['preparing'],
      preparing: ['ready'],
      ready: ['served']
    };

    const allowed = validTransitions[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      return {
        status: 409,
        error: `Tranziție ilegală de la "${currentStatus}" la "${newStatus}"`,
        code: 'illegal_transition'
      };
    }

    await db.query('UPDATE orders SET state = $1 WHERE id = $2;', [newStatus, orderId]);

    // Notificare Socket.IO clienților mesei și personalului
    ioEmitter.emitToTable(order.table_id, 'order:state', {
      orderId,
      state: newStatus
    });

    if (newStatus === 'ready') {
      ioEmitter.emitToWaiter('order:ready', {
        orderId,
        tableId: order.table_id,
        state: 'ready'
      });
    }

    return { status: 200, data: { orderId, state: newStatus } };
  }
}

export const staffService = new StaffService();
