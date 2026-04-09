import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { connectMongo } from './integrations/mongoose.js';
import { prometheusMiddleware, metricsHandler } from './integrations/prometheus.js';
import { recordLog } from './integrations/logger.js';
import { initSocket } from './integrations/socket.js';
import { startExampleJob } from './jobs/example.job.js';
import appRouter from './modules/app.router.js';
import webhooksRouter from './modules/webhooks.router.js';
import { ENV } from './config/index.js';

const app = express();

// 1. CORS + cookies
app.use(cors({ origin: (origin, cb) => cb(null, origin ?? true), credentials: true }));
app.use(cookieParser());

// 2. Webhooks BEFORE json parser (need raw body)
app.use('/webhook', webhooksRouter);

// 3. JSON parser
app.use(express.json({ limit: '50mb' }));

// 4. Observability
app.use(prometheusMiddleware);

// 5. Static files
app.use('/uploads', express.static('uploads'));

// 6. API routes
app.use('/api', appRouter);

// 7. Health + metrics
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/metrics', metricsHandler);

async function start() {
  try {
    await connectMongo();
    startExampleJob();
    const httpServer = app.listen(Number(ENV.PORT), () => {
      recordLog({ code: 'SERVER_START', category: 'SYSTEM', severity: 'INFO', note: `Listening on port ${ENV.PORT}` });
    });
    initSocket(httpServer);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

start();
