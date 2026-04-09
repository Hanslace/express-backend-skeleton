import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { ENV } from '../config/index.js';

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (token) {
      try {
        const payload = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        return next();
      } catch { /* fall through */ }
    }
    next(new Error('Unauthorized'));
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data as { userId: string; role: string };
    socket.join(userId);
    if (role === 'admin') socket.join('platform_admins');
  });
}

export function getIO() {
  return io;
}

export function emitToUser(userId: string, event: string, data: unknown) {
  getIO().to(userId).emit(event, data);
}
