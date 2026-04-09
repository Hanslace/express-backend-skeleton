import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { redis } from '../../../integrations/redis.js';
import { ENV } from '../../../config/index.js';

// Placeholder — replace with real Admin model lookup + password check
export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }

  // TODO: validate credentials against Admin model
  const adminId = 'placeholder-admin-id';

  const sessionId = uuid();
  await redis.set(`admin_session:${sessionId}`, adminId, 'EX', ENV.SESSION_TTL_SEC);

  res.cookie(ENV.SESSION_COOKIE_NAME, sessionId, { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true });
}
