import { db } from './db.js';
import { ioEmitter } from './socket.js';

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

export async function processDispatches() {
  if (isRunning) return;
  isRunning = true;

  try {
    const ordersRes = await db.query(
      `SELECT o.id, o.session_id, o.client_request_id, ts.table_id, t.table_number
       FROM orders o
       JOIN table_sessions ts ON o.session_id = ts.id
       JOIN tables t ON ts.table_id = t.id
       WHERE o.state = 'queued' AND o.dispatch_after <= NOW();`
    );

    for (const order of ordersRes.rows) {
      await db.query(
        "UPDATE orders SET state = 'dispatched', dispatched_at = NOW() WHERE id = $1 AND state = 'queued';",
        [order.id]
      );

      // Notificare clienți masă
      ioEmitter.emitToTable(order.table_id, 'order:state', {
        orderId: order.id,
        state: 'dispatched',
        clientRequestId: order.client_request_id
      });

      // Notificare bucătărie (SOCK-05)
      ioEmitter.emitToKitchen('order:state', {
        orderId: order.id,
        state: 'dispatched',
        tableId: order.table_id,
        tableNumber: order.table_number,
        clientRequestId: order.client_request_id
      });
    }
  } catch (err) {
    // Eroare worker temporară (de ex. în timpul închiderii DB la teste)
  } finally {
    isRunning = false;
  }
}

export function startWorker(intervalMs: number = 500) {
  if (!intervalId) {
    intervalId = setInterval(processDispatches, intervalMs);
  }
}

export function stopWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

