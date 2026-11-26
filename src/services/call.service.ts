import { db } from '../db.js';
import { config } from '../config.js';
import { rateLimiter, checkAndApplyDeviceFreeze } from './rateLimiter.js';
import { ioEmitter } from '../socket.js';

export class CallService {
  async createCall(
    member: { member_id: string; session_id: string; table_id: string; frozen_until?: string | null },
    callType: string = 'service'
  ) {
    // Verificare înghețare dispozitiv (T07)
    if (member.frozen_until && new Date(member.frozen_until) > new Date()) {
      return { status: 403, error: 'Dispozitivul este temporar înghețat din cauza activității suspecte', code: 'device_frozen' };
    }

    // CALL-03: Limita de rată (max 6 pe minut per dispozitiv)
    if (rateLimiter.isRateLimited(`call:${member.member_id}`, config.callRateLimit, 60 * 1000)) {
      await checkAndApplyDeviceFreeze(member.member_id);
      return { status: 429, error: 'Prea multe apeluri trimise într-un minut. Vă rugăm așteptați.', code: 'rate_limited' };
    }

    // CALL-02: Verificare plafon apeluri deschise (max 3 apeluri active pending)
    const activeCallsRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM session_calls WHERE session_id = $1 AND status = 'pending';",
      [member.session_id]
    );

    if (activeCallsRes.rows[0].count >= config.maxActiveCalls) {
      return { status: 409, error: 'Există deja apeluri în așteptare pentru masa dumneavoastră', code: 'call_cap_reached' };
    }

    // CALL-01: Apel valid -> 201
    const callRes = await db.query(
      `INSERT INTO session_calls (session_id, member_id, call_type, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, call_type, status, created_at;`,
      [member.session_id, member.member_id, callType]
    );

    const call = callRes.rows[0];

    // Notificare ospătari prin Socket.IO
    ioEmitter.emitToWaiter('table:call', {
      callId: call.id,
      tableId: member.table_id,
      callType,
      createdAt: call.created_at
    });

    return {
      status: 201,
      data: call
    };
  }

  async acknowledgeCall(callId: string, staffId: string) {
    const callRes = await db.query('SELECT * FROM session_calls WHERE id = $1;', [callId]);
    if (callRes.rowCount === 0) {
      return { status: 404, error: 'Apel inexistent' };
    }

    await db.query(
      "UPDATE session_calls SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by_staff_id = $1 WHERE id = $2;",
      [staffId, callId]
    );

    return { status: 200, data: { callId, status: 'acknowledged' } };
  }
}

export const callService = new CallService();

