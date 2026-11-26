import { db } from '../db.js';
import { config } from '../config.js';
import { rateLimiter, checkAndApplyDeviceFreeze } from './rateLimiter.js';
import { ioEmitter } from '../socket.js';

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export class OrderService {
  async placeOrder(
    member: { member_id: string; session_id: string; table_id: string; frozen_until?: string | null },
    clientRequestId: string,
    items: OrderItemInput[]
  ) {
    // Verificare înghețare dispozitiv (T07)
    if (member.frozen_until && new Date(member.frozen_until) > new Date()) {
      return { status: 403, error: 'Dispozitivul este temporar înghețat din cauza activității suspecte', code: 'device_frozen' };
    }

    // Rate limiter comenzi (max 10 comenzi per minut per dispozitiv)
    if (rateLimiter.isRateLimited(`order:${member.member_id}`, 10, 60 * 1000)) {
      await checkAndApplyDeviceFreeze(member.member_id);
      return { status: 429, error: 'Prea multe comenzi trimise. Vă rugăm așteptați.', code: 'rate_limited' };
    }

    // ORD-07: Validare cantitate 0, cantitate > 20 sau peste 30 de linii
    if (!items || !Array.isArray(items) || items.length === 0 || items.length > 30) {
      return { status: 400, error: 'Comanda trebuie să conțină între 1 și 30 de produse distincte' };
    }

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0 || item.quantity > 20) {
        return { status: 400, error: 'Cantitatea fiecărui produs trebuie să fie între 1 și 20' };
      }
      if (!item.menuItemId) {
        return { status: 400, error: 'ID produs lipsă' };
      }
    }

    if (!clientRequestId) {
      return { status: 400, error: 'clientRequestId lipsă' };
    }

    // ORD-02: Verificare idempotență clientRequestId pentru aceeași sesiune
    const existingOrderRes = await db.query(
      'SELECT id, state, dispatch_after, created_at FROM orders WHERE session_id = $1 AND client_request_id = $2;',
      [member.session_id, clientRequestId]
    );

    if (existingOrderRes.rowCount > 0) {
      const existing = existingOrderRes.rows[0];
      return {
        status: 200,
        data: {
          orderId: existing.id,
          state: existing.state,
          dispatchAfter: existing.dispatch_after,
          duplicate: true
        }
      };
    }

    // ORD-03: Verificare disponibilitate produse cu FOR SHARE
    const itemIds = items.map(i => i.menuItemId);
    const placeholders = itemIds.map((_, idx) => `$${idx + 1}`).join(', ');
    
    // În PGlite / PostgreSQL se interoghează disponibilitatea
    const itemsDbRes = await db.query(
      `SELECT id, name, price, available FROM menu_items WHERE id IN (${placeholders});`,
      itemIds
    );

    const itemsMap = new Map<string, any>();
    for (const row of itemsDbRes.rows) {
      itemsMap.set(row.id, row);
    }

    for (const item of items) {
      const dbItem = itemsMap.get(item.menuItemId);
      if (!dbItem || !dbItem.available) {
        // Zero rânduri adăugate în orders și order_items
        return {
          status: 409,
          error: `Produsul "${dbItem ? dbItem.name : item.menuItemId}" nu este disponibil în acest moment`,
          code: 'item_unavailable'
        };
      }
    }

    // Calcul dispatch_after: NOW() + INTERVAL '25 seconds'
    const now = new Date();
    const dispatchAfter = new Date(now.getTime() + config.undoWindowSeconds * 1000);

    // Inserare comandă
    const orderRes = await db.query(
      `INSERT INTO orders (session_id, member_id, client_request_id, state, dispatch_after)
       VALUES ($1, $2, $3, 'queued', $4)
       RETURNING id, state, dispatch_after, created_at;`,
      [member.session_id, member.member_id, clientRequestId, dispatchAfter.toISOString()]
    );

    const orderId = orderRes.rows[0].id;

    // Inserare linii comandă
    for (const item of items) {
      const dbItem = itemsMap.get(item.menuItemId);
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5);`,
        [orderId, item.menuItemId, item.quantity, dbItem.price, item.notes || null]
      );
    }

    // Notificare Socket.IO către clienții mesei
    ioEmitter.emitToTable(member.table_id, 'order:state', {
      orderId,
      state: 'queued',
      dispatchAfter: dispatchAfter.toISOString(),
      clientRequestId
    });

    return {
      status: 201,
      data: {
        orderId,
        state: 'queued',
        dispatchAfter: dispatchAfter.toISOString(),
        duplicate: false
      }
    };
  }

  async cancelOrder(orderId: string, memberId: string) {
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

    // ORD-06: Anularea comenzii altui membru -> 409
    if (order.member_id !== memberId) {
      return { status: 409, error: 'Nu puteți anula comanda altui membru', code: 'forbidden' };
    }

    // ORD-05: Anulare după fereastră (dispatch_after expirat) sau stare deja schimbată -> 409 undo_window_closed
    const now = new Date();
    if (order.state !== 'queued' || new Date(order.dispatch_after) <= now) {
      return { status: 409, error: 'Fereastra de anulare a comenzii s-a încheiat', code: 'undo_window_closed' };
    }

    // ORD-04: Anulare în fereastră -> 200, cancelled
    await db.query("UPDATE orders SET state = 'cancelled' WHERE id = $1;", [orderId]);

    // Emitere Socket.IO
    ioEmitter.emitToTable(order.table_id, 'order:state', {
      orderId,
      state: 'cancelled'
    });

    return { status: 200, data: { status: 'cancelled' } };
  }
}

export const orderService = new OrderService();

