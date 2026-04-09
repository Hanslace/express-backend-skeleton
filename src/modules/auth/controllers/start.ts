import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { prisma } from '../../../integrations/prisma.js';
import { ENV } from '../../../config/index.js';
import type { Role } from '../../../common/middleware/auth.js';

function roleFromClientId(clientId: string): Role {
  if (clientId === ENV.CLIENT_ID_ADMIN) return 'admin';
  if (clientId === ENV.CLIENT_ID_MANAGER) return 'manager';
  return 'employee';
}

export async function start(req: Request, res: Response) {
  const { email, client_id } = req.body as { email?: string; client_id?: string };
  if (!email || !client_id) {
    res.status(400).json({ error: 'email and client_id are required.' });
    return;
  }

  const role = roleFromClientId(client_id);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, role } });
  }

  const accessToken = jwt.sign({ sub: user.id, role }, ENV.JWT_SECRET, {
    expiresIn: ENV.ACCESS_TOKEN_TTL_SEC,
  });

  const rawRefresh = uuid();
  const expiresAt = new Date(Date.now() + ENV.REFRESH_TOKEN_TTL_MS);
  await prisma.refreshToken.create({
    data: { userId: user.id, token: rawRefresh, role, expiresAt },
  });

  res.json({ accessToken, refreshToken: rawRefresh });
}
