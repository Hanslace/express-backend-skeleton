import { Router } from 'express';
import { start } from './controllers/start.js';
import { refresh } from './controllers/refresh.js';
import { logout } from './controllers/logout.js';

const router = Router();

router.post('/identity/start',   start);
router.post('/session/refresh',  refresh);
router.post('/session/logout',   logout);

export default router;
