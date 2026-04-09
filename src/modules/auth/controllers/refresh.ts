import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { prisma } from '../../../integrations/prisma.js';
import { ENV } from '../../../config/index.js';

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required.' });
    return;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
    return;
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

  const accessToken = jwt.sign({ sub: stored.userId, role: stored.role }, ENV.JWT_SECRET, {
    expiresIn: ENV.ACCESS_TOKEN_TTL_SEC,
  });

  const newRaw = uuid();
  const expiresAt = new Date(Date.now() + ENV.REFRESH_TOKEN_TTL_MS);
  await prisma.refreshToken.create({
    data: { userId: stored.userId, token: newRaw, role: stored.role, expiresAt },
  });

  res.json({ accessToken, refreshToken: newRaw });
}
