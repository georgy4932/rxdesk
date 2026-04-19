import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { tasksRouter } from './routes/tasks.js';
import { callsRouter } from './routes/calls.js';

const app = express();

const allowedOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

app.disable('x-powered-by');

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // allow server-to-server / curl / same-device tools
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '256kb' }));

// Basic security headers without adding extra package yet
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// TEMP DEV AUTH MIDDLEWARE
// Replace with real auth before any pharmacy pilot.
app.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    pharmacyId: '22222222-2222-2222-2222-222222222222',
    role: 'admin',
    email: 'dev-admin@rxdesk.local'
  };
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'rxdesk-api',
    version: '1.0.0'
  });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/calls', callsRouter);

// Central error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);

  if (err instanceof Error && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  return res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`RxDesk API running on port ${port}`);
});
