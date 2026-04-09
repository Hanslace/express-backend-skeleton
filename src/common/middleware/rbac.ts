import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest, Role } from './auth.js';

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { role } = req as AuthRequest;
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    next();
  };
}
