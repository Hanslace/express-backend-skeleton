import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { ENV } from '../../config/index.js';
import { redis } from '../../integrations/redis.js';

export type Role = 'admin' | 'manager' | 'employee';

export interface AuthRequest extends Request {
  userId: string;
  role: Role;
  orgId: string;
}

export interface AdminRequest extends Request {
  adminId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header.' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), ENV.JWT_SECRET) as JwtPayload;
    (req as AuthRequest).userId = payload.sub!;
    (req as AuthRequest).role = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export async function requireAdminSession(req: Request, res: Response, next: NextFunction) {
  const sessionId = (req as Request & { cookies: Record<string, string> }).cookies[ENV.SESSION_COOKIE_NAME];
  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const adminId = await redis.get(`admin_session:${sessionId}`);
  if (!adminId) {
    res.status(401).json({ error: 'Session expired.' });
    return;
  }
  (req as AdminRequest).adminId = adminId;
  next();
}
