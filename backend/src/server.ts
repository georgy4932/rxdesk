import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { tasksRouter } from './routes/tasks.js';
import { callsRouter } from './routes/calls.js';
import { monthEndRouter } from './routes/monthEnd.js';

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [
        'http://localhost:5000',
        'http://127.0.0.1:5000'
      ]
);

app.disable('x-powered-by');

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match-Version'],
  credentials: false,
  maxAge: 86400
}));

app.use(express.json({ limit: '256kb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  if (isProduction) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'rxdesk-api',
    version: '1.0.0',
    environment: isProduction ? 'production' : 'development'
  });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/calls', callsRouter);
app.use('/api/month-end', monthEndRouter);

app.use((_req: Request, res: Response) => {
  return res.status(404).json({ error: 'Route not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);

  if (err instanceof Error && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  return res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`RxDesk API running on port ${port}`);
});
