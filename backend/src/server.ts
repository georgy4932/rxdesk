import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { tasksRouter } from './routes/tasks.js';
import { callsRouter } from './routes/calls.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'rxdesk-api',
    version: '1.0.0'
  });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/calls', callsRouter);

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`RxDesk API running on port ${port}`);
});
