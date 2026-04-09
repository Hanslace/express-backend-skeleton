import type { Request, Response } from 'express';
import { prisma } from '../../../integrations/prisma.js';

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required.' });
    return;
  }

  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revoked: true },
  });

  res.json({ success: true });
}
