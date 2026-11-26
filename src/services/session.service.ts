import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';

export interface ScanResult {
  status: number;
  cookieToken?: string;
  redirectUrl?: string;
  error?: string;
  code?: string;
}

export class SessionService {
  async handleScan(
    token: string,
    existingDeviceToken?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<ScanResult> {
    // SCAN-02: Format token invalid (de exemplu lungime < 16 sau caractere invalide)
    if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
      return { status: 404, error: 'Token scanare invalid' };
    }

    // Caută sesiunea asociată
    const sessRes = await db.query(
      `SELECT s.*, t.table_number, t.restaurant_id 
       FROM table_sessions s 
       JOIN tables t ON s.table_id = t.id 
       WHERE s.session_token = $1;`,
      [token]
    );

    if (sessRes.rowCount === 0) {
      return { status: 404, error: 'Sesiune inexistentă' };
    }

    const session = sessRes.rows[0];

    // SCAN-03: Sesiune închisă sau expirată
    if (session.state !== 'active' || (session.expires_at && new Date(session.expires_at) < new Date())) {
      return { status: 404, error: 'Sesiunea mesei este închisă sau a expirat' };
    }

    // SCAN-04: Același dispozitiv scanează din nou (pe baza cookie-ului qr_dev)
    if (existingDeviceToken) {
      const existingMemberRes = await db.query(
        'SELECT * FROM session_members WHERE session_id = $1 AND device_token = $2;',
        [session.id, existingDeviceToken]
      );
      if (existingMemberRes.rowCount > 0) {
        return {
          status: 302,
          cookieToken: existingDeviceToken,
          redirectUrl: `${config.appUrl}/menu`
        };
      }
    }

    // Verificare număr de dispozitive active pentru masă
    const membersCountRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM session_members WHERE session_id = $1;',
      [session.id]
    );
    const count = membersCountRes.rows[0].count;

    // SCAN-05: Al 5-lea dispozitiv este respins cu 403
    if (count >= config.maxDevicesPerTable) {
      return {
        status: 403,
        error: 'Plafonul de 4 dispozitive pe masă a fost atins. Nu vă puteți alătura acestei mese.'
      };
    }

    // SCAN-06: Două scanări simultane ale primei sesiuni -> exact un owner
    // Verificăm dacă există deja un owner în sesiune
    const ownerRes = await db.query(
      'SELECT id FROM session_members WHERE session_id = $1 AND is_owner = true;',
      [session.id]
    );
    const isOwner = ownerRes.rowCount === 0;

    const newDeviceToken = crypto.randomBytes(24).toString('hex');
    const nickname = isOwner ? 'Membru 1 (Owner)' : `Membru ${count + 1}`;

    await db.query(
      `INSERT INTO session_members (session_id, device_token, is_owner, nickname, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6);`,
      [session.id, newDeviceToken, isOwner, nickname, userAgent || null, ipAddress || null]
    );

    return {
      status: 302,
      cookieToken: newDeviceToken,
      redirectUrl: `${config.appUrl}/menu`
    };
  }

  async createInvite(memberId: string): Promise<{ status: number; inviteUrl?: string; error?: string; code?: string }> {
    const memRes = await db.query(
      `SELECT sm.*, ts.state as session_state 
       FROM session_members sm 
       JOIN table_sessions ts ON sm.session_id = ts.id 
       WHERE sm.id = $1;`,
      [memberId]
    );

    if (memRes.rowCount === 0) {
      return { status: 401, error: 'Membru invalid' };
    }
    const member = memRes.rows[0];

    // INV-03: Invitație creată de un oaspete (guest) -> 403 owner_only
    if (!member.is_owner) {
      return { status: 403, error: 'Doar proprietarul mesei poate crea invitații', code: 'owner_only' };
    }

    // INV-04: A patra invitație activă -> 409 invite_cap_reached (max 3 active)
    const activeInvitesRes = await db.query(
      `SELECT COUNT(*)::int AS count 
       FROM session_invites 
       WHERE session_id = $1 AND used_at IS NULL AND expires_at > NOW();`,
      [member.session_id]
    );
    if (activeInvitesRes.rows[0].count >= config.maxActiveInvites) {
      return { status: 409, error: 'Limita de invitații active a fost atinsă', code: 'invite_cap_reached' };
    }

    const inviteToken = crypto.randomBytes(20).toString('hex');
    await db.query(
      `INSERT INTO session_invites (session_id, created_by_member_id, invite_token)
       VALUES ($1, $2, $3);`,
      [member.session_id, member.id, inviteToken]
    );

    return {
      status: 201,
      inviteUrl: `${config.appUrl}/i/${inviteToken}`
    };
  }

  async handleInvite(
    token: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<ScanResult> {
    if (!token || token.length < 16) {
      return { status: 404, error: 'Invitație invalidă' };
    }

    const invRes = await db.query(
      `SELECT i.*, s.state AS session_state, s.expires_at AS session_expires_at 
       FROM session_invites i 
       JOIN table_sessions s ON i.session_id = s.id 
       WHERE i.invite_token = $1;`,
      [token]
    );

    if (invRes.rowCount === 0) {
      return { status: 404, error: 'Invitație inexistentă' };
    }

    const invite = invRes.rows[0];

    // INV-02: A doua folosire a aceleiași invitații -> 404
    if (invite.used_at !== null) {
      return { status: 404, error: 'Invitația a fost deja utilizată' };
    }

    // INV-05: Invitație expirată -> 404
    if (new Date(invite.expires_at) < new Date()) {
      return { status: 404, error: 'Invitația a expirat' };
    }

    if (invite.session_state !== 'active' || new Date(invite.session_expires_at) < new Date()) {
      return { status: 404, error: 'Sesiunea mesei este închisă' };
    }

    // Verificare plafon 4 dispozitive
    const membersCountRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM session_members WHERE session_id = $1;',
      [invite.session_id]
    );
    const count = membersCountRes.rows[0].count;
    if (count >= config.maxDevicesPerTable) {
      return { status: 403, error: 'Plafonul de 4 dispozitive pe masă a fost atins.' };
    }

    const newDeviceToken = crypto.randomBytes(24).toString('hex');
    const nickname = `Invitat ${count + 1}`;

    const memberInsert = await db.query(
      `INSERT INTO session_members (session_id, device_token, is_owner, nickname, user_agent, ip_address)
       VALUES ($1, $2, false, $3, $4, $5) RETURNING id;`,
      [invite.session_id, newDeviceToken, nickname, userAgent || null, ipAddress || null]
    );

    // Marcare invitație ca utilizată
    await db.query(
      'UPDATE session_invites SET used_at = NOW(), used_by_member_id = $1 WHERE id = $2;',
      [memberInsert.rows[0].id, invite.id]
    );

    return {
      status: 302,
      cookieToken: newDeviceToken,
      redirectUrl: `${config.appUrl}/menu`
    };
  }

  async getSessionByDeviceToken(deviceToken?: string) {
    if (!deviceToken) return null;

    const res = await db.query(
      `SELECT sm.id AS member_id, sm.is_owner, sm.nickname, sm.frozen_until,
              ts.id AS session_id, ts.table_id, ts.state AS session_state, ts.expires_at AS session_expires_at,
              t.table_number, t.restaurant_id
       FROM session_members sm
       JOIN table_sessions ts ON sm.session_id = ts.id
       JOIN tables t ON ts.table_id = t.id
       WHERE sm.device_token = $1;`,
      [deviceToken]
    );

    if (res.rowCount === 0) return null;
    const data = res.rows[0];

    // SESS-01: sesiune expirată sau închisă -> invalid
    if (data.session_state !== 'active' || (data.session_expires_at && new Date(data.session_expires_at) < new Date())) {
      return null;
    }

    return data;
  }
}

export const sessionService = new SessionService();

