import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';

type Feature = string;

// Replace with real DB lookup
async function getOrgFeatures(_orgId: string): Promise<Feature[]> {
  return [];
}

export function requireFeature(feature: Feature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { orgId } = req as AuthRequest;
    const features = await getOrgFeatures(orgId);
    if (!features.includes(feature)) {
      res.status(403).json({ error: 'Upgrade required.' });
      return;
    }
    next();
  };
}
