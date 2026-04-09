# Backend Architecture Context

A reference for replicating this backend's architecture elsewhere. Captures patterns, not TaskFlow-specific details.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Express 5 | `type: "module"` (ESM) |
| Language | TypeScript 5 | `NodeNext` module resolution |
| Primary DB | PostgreSQL via Prisma | Auth/token storage |
| Secondary DB | MongoDB via Mongoose | Business/domain data |
| Cache/Sessions | Redis via ioredis | Session storage, caching |
| Real-time | Socket.IO | WebSocket upgrades on same HTTP server |
| Auth | JWT (users) + Session cookies (admin) | Two separate auth planes |
| Payments | Stripe | Webhooks + subscriptions |
| Email | Nodemailer | SMTP, lazy singleton |
| File Uploads | Multer | Disk storage, served as static |
| Scheduling | node-cron | Background jobs |
| Metrics | prom-client | Prometheus counters + histograms |
| Build | `tsc` + `tsc-alias` | Resolves `@/*` path aliases post-compile |
| Dev runner | tsx | |

---

## Folder Structure

```
backend/
├── src/
│   ├── server.ts              # Entry point
│   ├── config/
│   │   ├── env.ts             # required() / optional() env vars
│   │   ├── app.ts             # Static constants (TTLs, keys, etc.)
│   │   └── index.ts           # Merged export: ENV = { ...secrets, ...constants }
│   ├── common/
│   │   └── middleware/
│   │       ├── auth.ts        # JWT extraction → req.userId, req.role
│   │       ├── rbac.ts        # requireRole(...roles)
│   │       ├── plan.ts        # requireFeature(), requireSeatAvailable
│   │       └── upload.ts      # multer config
│   ├── integrations/
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── mongoose.ts        # MongoDB connection
│   │   ├── redis.ts           # ioredis client singleton
│   │   ├── mailer.ts          # nodemailer transporter singleton
│   │   ├── socket.ts          # Socket.IO init, auth, room logic
│   │   ├── prometheus.ts      # Metrics setup
│   │   ├── logger.ts          # Structured JSON logging
│   │   └── jobMonitor.ts      # In-memory cron job state tracker
│   ├── jobs/
│   │   └── *.job.ts           # node-cron scheduled tasks
│   ├── modules/               # Feature modules
│   │   ├── app.router.ts      # Root router: mounts all module routers
│   │   ├── auth/              # Auth flows (JWT, OTP, session refresh)
│   │   ├── admin/             # Separate admin platform (session-cookie auth)
│   │   ├── <feature>/         # One folder per domain feature
│   │   │   ├── <feature>.router.ts
│   │   │   └── controllers/
│   │   │       ├── list.ts
│   │   │       ├── create.ts
│   │   │       ├── update.ts
│   │   │       └── remove.ts
│   │   └── webhooks.router.ts # External webhooks (Stripe, etc.)
│   └── seeds/
│       └── *.seed.ts
├── prisma/
│   ├── schema/
│   │   └── modules/           # Split schema files per domain
│   └── migrations/
├── generated/prisma/          # Prisma client output dir
├── tsconfig.json
└── package.json
```

---

## server.ts Initialization Pattern

```ts
// 1. Load env first
dotenv.config();

const app = express();

// 2. Middleware order MATTERS:
app.use(cors({ origin: (origin, cb) => cb(null, origin ?? true), credentials: true }));
app.use(cookieParser());

// 3. Webhooks BEFORE json parser (need raw body)
app.use('/webhook', webhooksRouter);

// 4. JSON parser
app.use(express.json({ limit: '50mb' }));

// 5. Observability
app.use(prometheusMiddleware);
app.use(loggingMiddleware);

// 6. Static files
app.use('/uploads', express.static('uploads'));

// 7. API routes
app.use('/api', appRouter);

// 8. Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// 9. Async startup
async function start() {
  try {
    await connectMongo();
    await startJobs();
    const httpServer = app.listen(PORT);
    initSocket(httpServer);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
start();
```

---

## Config Pattern

```ts
// config/env.ts
function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const ENV_SECRETS = {
  NODE_ENV:              required('NODE_ENV'),
  POSTGRES_URL:          required('POSTGRES_URL'),
  MONGO_URL:             required('MONGO_URL'),
  REDIS_URL:             required('REDIS_URL'),
  JWT_SECRET:            required('JWT_SECRET'),
  MAIL_URL:              required('MAIL_URL'),
  MAIL_FROM:             required('MAIL_FROM'),
  // ... etc
};

// config/app.ts — no process.env here, only constants
export const APP_CONFIG = {
  ACCESS_TOKEN_TTL_SEC:  15 * 60,
  REFRESH_TOKEN_TTL_MS:  7 * 24 * 60 * 60 * 1000,
  SESSION_TTL_SEC:       8 * 60 * 60,
  SESSION_COOKIE_NAME:   'admin_session',
  // client IDs used to determine role at signup
  CLIENT_ID_ADMIN:       'your-admin-client-id',
  CLIENT_ID_MANAGER:     'your-manager-client-id',
  CLIENT_ID_EMPLOYEE:    'your-employee-client-id',
};

// config/index.ts
export const ENV = { ...ENV_SECRETS, ...APP_CONFIG };
```

---

## Auth Architecture

### User Auth (JWT)

Two tokens: short-lived access token + long-lived refresh token.

```
POST /auth/identity/start  { email, client_id }
  → create user if not exists
  → determine role from client_id
  → return { accessToken, refreshToken }

POST /auth/session/refresh  { refreshToken }
  → validate token in DB (not revoked, not expired)
  → revoke old token, issue new pair (rotation)
  → return { accessToken, refreshToken }

POST /auth/session/logout
  → revoke refresh token in DB
```

**JWT Payload:** `{ sub: userId, role: 'admin'|'manager'|'employee' }`

**Refresh tokens stored in Prisma (PostgreSQL):**
```prisma
model RefreshToken {
  id         String   @id @default(uuid())
  userId     String
  token      String   @unique
  role       String
  expiresAt  DateTime
  revoked    Boolean  @default(false)
}
```

### Admin Auth (Session cookie)

Separate auth plane for internal/super-admin dashboards:

```
POST /admin/auth/login  { email, password }
  → validate credentials
  → generate sessionId (uuid)
  → store in Redis: SET admin_session:<id> <adminId> EX 28800
  → store sessionId on Admin document (single-session enforcement)
  → Set-Cookie: admin_session=<id>; HttpOnly
```

**Single-session enforcement:** Each new login overwrites `currentSessionId` on the Admin record. Middleware validates both the cookie and that it matches the stored ID.

---

## Middleware Patterns

### requireAuth

```ts
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
```

### requireRole

```ts
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
```

### requireAdminSession

```ts
export async function requireAdminSession(req, res, next) {
  const sessionId = req.cookies[ENV.SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: 'Not authenticated.' }); return; }

  const adminId = await redis.get(`admin_session:${sessionId}`);
  if (!adminId) { res.status(401).json({ error: 'Session expired.' }); return; }

  const admin = await Admin.findById(adminId);
  if (!admin || admin.currentSessionId !== sessionId) {
    res.status(401).json({ error: 'Session invalidated.' }); return;
  }

  (req as AdminRequest).adminId = adminId;
  next();
}
```

### Plan/Feature Gates

```ts
// Usage: router.get('/reports', requireAuth, requireFeature('reports'), handler)
export function requireFeature(feature: Feature) {
  return async (req, res, next) => {
    const org = await getOrgPlan((req as AuthRequest).orgId);
    if (!org.features.includes(feature)) {
      res.status(403).json({ error: 'Upgrade required.' });
      return;
    }
    next();
  };
}

// Usage: router.post('/invite', requireAuth, requireSeatAvailable, handler)
export async function requireSeatAvailable(req, res, next) {
  const { orgId } = req as AuthRequest;
  const [employees, pending] = await Promise.all([
    countActiveEmployees(orgId),
    countPendingInvites(orgId),
  ]);
  const limit = await getOrgSeatLimit(orgId);
  if (limit !== null && employees + pending >= limit) {
    res.status(403).json({ error: 'Seat limit reached.' });
    return;
  }
  next();
}
```

---

## Router / Module Pattern

### app.router.ts

```ts
const router = Router();

// Public
router.use('/auth', authRouter);

// Admin platform (session auth)
router.use('/admin', adminRouter);

// User-facing (JWT auth applied here, not per-route)
router.use('/profile',      requireAuth, profileRouter);
router.use('/organization', requireAuth, organizationRouter);
router.use('/payment',      requireAuth, paymentRouter);
router.use('/work',         requireAuth, workRouter);
router.use('/tracking',     requireAuth, trackingRouter);
router.use('/dashboard',    requireAuth, dashboardRouter);
router.use('/notification', requireAuth, notificationRouter);

export default router;
```

### Feature Router

```ts
// modules/work/task/task.router.ts
const router = Router();

router.get('/',               requireRole('admin', 'manager'), list);
router.post('/',              requireRole('admin', 'manager'), create);
router.get('/mine',           requireRole('employee'),         mine);
router.patch('/:id/status',   requireRole('employee'),         updateStatus);
router.patch('/:id',          requireRole('admin', 'manager'), update);
router.delete('/:id',         requireRole('admin', 'manager'), remove);

export default router;
```

### Controller Pattern

One file per action. No class-based controllers.

```ts
// modules/work/task/controllers/create.ts
export async function create(req: Request, res: Response) {
  const { userId, orgId } = req as AuthRequest;
  const { projectId, title, priority, dueDate } = req.body;

  if (!projectId || !title?.trim()) {
    res.status(400).json({ error: 'projectId and title are required.' });
    return;
  }

  // Scope check: does this user have access to this project?
  const project = await getScopedProject(req as AuthRequest, projectId);
  if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }

  const task = await Task.create({ projectId, title, priority, dueDate, createdBy: userId });
  res.status(201).json(task);
}
```

---

## Database Architecture

### Why Two Databases

| PostgreSQL (Prisma) | MongoDB (Mongoose) |
|---|---|
| Auth: users, credentials, refresh tokens | Business data: orgs, profiles, projects, tasks |
| Relational integrity for security-critical data | Flexible schema for domain objects |
| Migrations with full history | Schema changes without migrations |

### Prisma Setup

```ts
// integrations/prisma.ts
import { PrismaClient } from '../../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: ENV.POSTGRES_URL });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

**Split schema files** (one per domain, referenced in main schema.prisma):
```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}

// Import domain schemas
// (use Prisma's multi-file schema feature or manual includes)
```

### Mongoose Setup

```ts
// integrations/mongoose.ts
import mongoose from 'mongoose';

export async function connectMongo() {
  await mongoose.connect(ENV.MONGO_URL);
  console.log('MongoDB connected');
}
```

**Model pattern:**
```ts
import { Schema, model, Document } from 'mongoose';

export interface ITask extends Document {
  projectId: string;
  title: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: Date | null;
  createdBy: string;
}

const TaskSchema = new Schema<ITask>({
  projectId: { type: String, required: true, index: true },
  title:     { type: String, required: true },
  status:    { type: String, enum: [...], default: 'todo' },
  priority:  { type: String, enum: [...], default: 'medium' },
  dueDate:   { type: Date, default: null },
  createdBy: { type: String, required: true },
}, { timestamps: true });

export const Task = model<ITask>('Task', TaskSchema);
```

### Redis Setup

```ts
// integrations/redis.ts
import Redis from 'ioredis';

export const redis = new Redis(ENV.REDIS_URL);
```

---

## Scope-Based Authorization (Multi-Tenant)

For multi-tenant apps, use scope helpers instead of raw DB queries:

```ts
// modules/work/_helpers/scope.ts

export function getWorkScope(req: AuthRequest) {
  return {
    userId: req.userId,
    role: req.role,
    orgId: req.orgId,
    departmentId: req.departmentId,   // from JWT or loaded on requireAuth
  };
}

// Returns project only if this user can see it
export async function getScopedProject(req: AuthRequest, projectId: string) {
  const { role, orgId, departmentId } = getWorkScope(req);
  const filter: Record<string, unknown> = { _id: projectId, organizationId: orgId };
  if (role === 'manager' || role === 'employee') {
    filter.departmentId = departmentId;  // restrict to their dept
  }
  return Project.findOne(filter);
}
```

---

## Stripe Integration

### Setup

```ts
import Stripe from 'stripe';
export const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
```

### Webhook Handler (raw body required)

```ts
// modules/webhooks.router.ts — mounted BEFORE express.json()
import express from 'express';
const router = Router();

router.post('/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature']!, ENV.STRIPE_WEBHOOK_SECRET);
    } catch {
      res.status(400).json({ error: 'Webhook signature invalid.' });
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':    await handleCheckout(event.data.object); break;
      case 'customer.subscription.updated': await handleSubUpdated(event.data.object); break;
      case 'invoice.payment_succeeded':     await handlePaid(event.data.object); break;
      case 'customer.subscription.deleted': await handleSubDeleted(event.data.object); break;
    }

    res.json({ received: true });
  }
);
```

### Plan Config Pattern

```ts
// modules/payment/config.ts
export const PLANS = {
  free:       { maxSeats: 5,    features: [] },
  starter:    { maxSeats: 25,   features: ['screenshots'] },
  pro:        { maxSeats: 100,  features: ['screenshots', 'reports', 'activity_logs'] },
  enterprise: { maxSeats: null, features: ['screenshots', 'reports', 'activity_logs', 'gdpr_tools'] },
} satisfies Record<string, { maxSeats: number | null; features: string[] }>;
```

---

## Socket.IO Pattern

```ts
// integrations/socket.ts
import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });

  io.use(async (socket, next) => {
    // Auth: accept JWT token or admin session cookie
    const token = socket.handshake.auth.token;
    if (token) {
      try {
        const payload = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        return next();
      } catch { /* fall through */ }
    }
    next(new Error('Unauthorized'));
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data;

    // Join personal room
    socket.join(userId);

    // Join role-based room
    if (role === 'admin') socket.join('platform_admins');

    // Handle events
    socket.on('tracking:collection', async (data) => {
      await TrackingSnapshot.create({ ...data, employeeId: userId });
    });
  });
}

// Use from anywhere
export function getIO() { return io; }

// Emit to a specific user
export function emitToUser(userId: string, event: string, data: unknown) {
  getIO().to(userId).emit(event, data);
}
```

---

## Structured Logging

```ts
// integrations/logger.ts
type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
type Category = 'AUTH' | 'SECURITY' | 'BUSINESS' | 'SYSTEM';

interface LogEntry {
  code: string;
  category: Category;
  severity: Severity;
  note: string;
  userId?: string;
  traceId?: string;
  payload?: unknown;
  service?: string;
}

export function recordLog(entry: LogEntry) {
  console.log(JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
    service: entry.service ?? 'api',
  }));
}

// Usage
recordLog({
  code: 'USER_LOGIN',
  category: 'AUTH',
  severity: 'INFO',
  note: 'User authenticated via OTP',
  userId,
});
```

---

## Prometheus Metrics

```ts
// integrations/prometheus.ts
import client from 'prom-client';

const requestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const requestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Request duration in ms',
  buckets: [5, 25, 100, 250, 500, 1000, 2500, 5000],
});

export function prometheusMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = requestDuration.startTimer();
  res.on('finish', () => {
    requestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
    end();
  });
  next();
}
```

---

## Cron Jobs Pattern

```ts
// jobs/metrics.job.ts
import cron from 'node-cron';
import { jobMonitor } from '../integrations/jobMonitor.js';

const JOB_ID = 'metrics-distillation';

export function startMetricsJob() {
  cron.schedule('5 0 * * *', async () => {   // 00:05 UTC nightly
    jobMonitor.start(JOB_ID);
    try {
      await distillMetrics();
      jobMonitor.succeed(JOB_ID);
    } catch (err) {
      jobMonitor.fail(JOB_ID, err instanceof Error ? err.message : String(err));
    }
  });
}
```

---

## Email Pattern

```ts
// integrations/mailer.ts
import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(ENV.MAIL_URL);
  }
  return transporter;
}

export async function sendEmail(opts: { to: string; subject: string; text?: string; html?: string }) {
  await getTransporter().sendMail({ from: ENV.MAIL_FROM, ...opts });
}
```

---

## File Uploads Pattern

```ts
// common/middleware/upload.ts
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    const id = crypto.randomBytes(32).toString('hex');
    cb(null, `${id}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },   // 10MB
  fileFilter: (_, file, cb) => {
    cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype));
  },
});

// Usage in router:
// router.post('/avatar', upload.single('avatar'), updateAvatar);
// Access in controller: req.file.filename
```

---

## TypeScript Setup

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

```json
// package.json
{
  "type": "module",
  "scripts": {
    "dev":   "tsx watch src/server.ts",
    "build": "tsc && tsc-alias",
    "start": "node dist/server.js"
  }
}
```

**Import all internal files with `.js` extension** (NodeNext ESM requirement):
```ts
import { prisma } from '../integrations/prisma.js';
import { ENV } from '../config/index.js';
```

---

## Error Response Conventions

No centralized error handler. Controllers return errors directly.

| Status | When | Shape |
|---|---|---|
| 400 | Missing/invalid input | `{ error: "field X is required." }` |
| 401 | Missing/expired auth | `{ error: "Missing or malformed Authorization header." }` |
| 403 | Insufficient role/plan | `{ error: "Access denied." }` |
| 404 | Resource not found | `{ error: "X not found." }` |
| 500 | Unhandled exception | `{ error: "Internal server error." }` |

---

## Key Architectural Decisions

1. **Webhooks mounted before JSON parser** — Stripe requires the raw `Buffer` body; express.json() destroys it.
2. **Two auth planes** — User JWT for the product, session cookie for the internal admin dashboard. Keeps security posture separate.
3. **Refresh token rotation** — Each refresh revokes the old token and issues a new pair. Detects replay attacks.
4. **Single-session enforcement for admins** — Redis stores session + Admin document stores `currentSessionId`. New login kills old session.
5. **Scope helpers, not raw queries** — All data access for business features goes through scope helpers that enforce org/dept boundaries, preventing tenant data leakage.
6. **Hybrid database** — Prisma for auth (relational, migration-safe), Mongoose for domain data (flexible schema, easy embedded docs).
7. **One controller file per action** — Keeps files small, easy to find, and avoids 500-line controller files.
8. **Feature flags tied to Stripe plan** — `requireFeature()` middleware gate reads the org's active plan. Adding a new feature is just adding it to the plan config and the middleware.
9. **Jobs tracked in-memory** — `jobMonitor` is an in-memory state tracker for cron jobs; surfaced in an admin health dashboard. No external dependency needed.
10. **Path alias `@/*` → `src/*`** — Avoids `../../../../` hell. Requires `tsc-alias` post-build to rewrite compiled JS.
