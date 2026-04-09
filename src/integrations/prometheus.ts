import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

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

export async function metricsHandler(_req: Request, res: Response) {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}
