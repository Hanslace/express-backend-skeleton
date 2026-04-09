import { Router } from 'express';
import { requireAdminSession } from '../../common/middleware/auth.js';
import { login } from './controllers/login.js';

const router = Router();

router.post('/auth/login', login);

// Protected admin routes go here
router.get('/health', requireAdminSession, (_req, res) => {
  res.json({ status: 'ok' });
});

export default router;
