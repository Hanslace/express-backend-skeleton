import { Router } from 'express';
import { requireAuth } from '../common/middleware/auth.js';
import authRouter from './auth/auth.router.js';
import adminRouter from './admin/admin.router.js';

const router = Router();

// Public
router.use('/auth', authRouter);

// Admin platform (session auth — applied per-route inside adminRouter)
router.use('/admin', adminRouter);

// User-facing (add feature routers here with requireAuth)
// router.use('/profile',      requireAuth, profileRouter);
// router.use('/organization', requireAuth, organizationRouter);

// Suppress unused import warning during scaffolding
void requireAuth;

export default router;
