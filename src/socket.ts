import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { sessionService } from './services/session.service.js';
import { StaffPayload } from './services/staff.service.js';

let ioInstance: SocketIOServer | null = null;

export const ioEmitter = {
  emitToTable: (tableId: string, event: string, data: any) => {
    if (ioInstance) {
      ioInstance.to(`table:${tableId}`).emit(event, data);
    }
  },
  emitToKitchen: (event: string, data: any) => {
    if (ioInstance) {
      ioInstance.to('kitchen').emit(event, data);
    }
  },
  emitToWaiter: (event: string, data: any) => {
    if (ioInstance) {
      ioInstance.to('waiter').emit(event, data);
    }
  },
  emitToAll: (event: string, data: any) => {
    if (ioInstance) {
      ioInstance.emit(event, data);
    }
  }
};

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

export function setupSocketIO(server: HttpServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  ioInstance = io;

  // Middleware autentificare handshake Socket.IO
  io.use(async (socket: Socket, next) => {
    // Verificare Origin la handshake (SOCK-02)
    const origin = socket.handshake.headers.origin;
    if (origin) {
      try {
        const appUrlParsed = new URL(config.appUrl);
        const reqOriginParsed = new URL(origin);
        if (
          reqOriginParsed.hostname !== appUrlParsed.hostname &&
          reqOriginParsed.host !== appUrlParsed.host &&
          reqOriginParsed.origin !== appUrlParsed.origin &&
          reqOriginParsed.hostname !== 'localhost' &&
          reqOriginParsed.hostname !== '127.0.0.1'
        ) {
          return next(new Error('origin_not_allowed'));
        }
      } catch (e) {
        return next(new Error('origin_not_allowed'));
      }
    }

    const cookies = parseCookies(socket.handshake.headers.cookie);
    const qrDevCookie = cookies['qr_dev'];

    // 1. Verificare cookie client masă (qr_dev)
    if (qrDevCookie) {
      try {
        const sessionData = await sessionService.getSessionByDeviceToken(qrDevCookie);
        if (sessionData) {
          socket.data.user = {
            type: 'customer',
            memberId: sessionData.member_id,
            sessionId: sessionData.session_id,
            tableId: sessionData.table_id,
            tableNumber: sessionData.table_number,
            isOwner: sessionData.is_owner
          };
          return next();
        }
      } catch (err) {
        // Continuă verificarea pentru token staff
      }
    }

    // 2. Verificare token JWT personal (Staff)
    const authHeader = socket.handshake.headers.authorization;
    const token = socket.handshake.auth?.token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret) as StaffPayload;
        socket.data.user = {
          type: 'staff',
          ...decoded
        };
        return next();
      } catch (err) {
        // SOCK-06: token JWT invalid -> not_authenticated
        return next(new Error('not_authenticated'));
      }
    }

    // 3. Verificare mod baseline (T05)
    if ((config.baselineMode || process.env.BASELINE_MODE === 'true') && (socket.handshake.query?.baseline === 'true' || socket.handshake.auth?.baseline)) {
      const bTableId = (socket.handshake.query?.tableId || socket.handshake.auth?.tableId) as string;
      socket.data.user = {
        type: 'baseline_customer',
        tableId: bTableId
      };
      return next();
    }

    // SOCK-01: fără cookie și fără token valid -> connect_error cu not_authenticated
    return next(new Error('not_authenticated'));
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;

    if (user?.type === 'customer' || user?.type === 'baseline_customer') {
      // Izolare pe cameră masă: SOCK-07
      const tableRoom = `table:${user.tableId}`;
      socket.join(tableRoom);
    } else if (user?.type === 'staff') {
      if (user.role === 'kitchen') {
        socket.join('kitchen');
      } else if (user.role === 'waiter') {
        socket.join('waiter');
      } else if (user.role === 'manager') {
        socket.join('kitchen');
        socket.join('waiter');
      }
    }

    socket.on('disconnect', () => {
      // Deconectat
    });
  });

  return io;
}
