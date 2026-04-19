import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  taskMutationRateLimiter,
  noteRateLimiter
} from '../middleware/rateLimiters.js';
import {
  logTaskCreated,
  logTaskUpdated,
  logTaskStatusChanged,
  logNoteAdded,
  extractRequestMeta
} from '../services/auditLogger.js';

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  urgent_review: ['reviewed'],
  needs_review: ['reviewed', 'queued'],
  callback_needed: ['reviewed'],
  reviewed: ['queued', 'completed'],
  queued: ['completed'],
  completed: []
};

const STATUS_ENUM = z.enum([
  'urgent_review',
  'needs_review',
  'callback_needed',
  'reviewed',
  'queued',
  'completed'
]);

const CATEGORY_ENUM = z.enum(['repeat', 'query', 'collection', 'urgent']);
const URGENCY_ENUM = z.enum(['routine', 'urgent']);

const uuidSchema = z.string().uuid();

const safeText = (max: number) =>
  z.string().trim().min(1).max(max);

const optionalSafeText = (max: number) =>
  z.string().trim().max(max).optional().nullable();

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD')
  .optional()
  .nullable();

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[0-9+()\-\s]+$/, 'Phone contains invalid characters')
  .optional()
  .nullable();

const confidenceSchema = z
  .number()
  .min(0)
  .max(100)
  .optional()
  .nullable();

const listTasksQuerySchema = z.object({
  status: STATUS_ENUM.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});

const taskCreateSchema = z.object({
  call_id: uuidSchema.optional().nullable(),
  patient_name: safeText(150),
  patient_dob: dobSchema,
  patient_phone: phoneSchema,
  request_type: safeText(100),
  category: CATEGORY_ENUM,
  medications: optionalSafeText(500),
  collection_slot: optionalSafeText(100),
  urgency_level: URGENCY_ENUM.default('routine'),
  status: STATUS_ENUM,
  confidence_score: confidenceSchema,
  display_summary: optionalSafeText(300),
  ai_summary: optionalSafeText(1000),
  transcript_summary: optionalSafeText(2000),
  next_step: optionalSafeText(500),
  reviewed_copy: optionalSafeText(300)
});

const taskUpdateSchema = z.object({
  patient_name: safeText(150).optional(),
  patient_dob: dobSchema,
  patient_phone: phoneSchema,
  medications: optionalSafeText(500),
  collection_slot: optionalSafeText(100),
  next_step: optionalSafeText(500),
  display_summary: optionalSafeText(300),
  urgency_level: URGENCY_ENUM.optional(),
  notes: optionalSafeText(2000),
  updated_at: z.string().datetime()
}).refine(
  (data) => Object.keys(data).some((k) => k !== 'notes' && k !== 'updated_at'),
  { message: 'No valid fields provided for update' }
);

const taskStatusSchema = z.object({
  to_status: STATUS_ENUM,
  note: optionalSafeText(2000),
  updated_at: z.string().datetime()
});

const taskNoteSchema = z.object({
  content: safeText(2000)
});

function parseOrFail<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  res: Response
): T | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.flatten()
    }) as null;
  }
  return parsed.data;
}

function getActor(req: Request) {
  if (!req.user) {
    throw new Error('Authenticated user required');
  }

  return {
    actorId: req.user.id,
    actorType: 'user' as const,
    pharmacyId: req.user.pharmacyId,
    role: req.user.role
  };
}

async function loadScopedTask(taskId: string, pharmacyId: string) {
  return supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('pharmacy_id', pharmacyId)
    .single();
}

tasksRouter.get('/', async (req: Request, res: Response) => {
  const query = parseOrFail(listTasksQuerySchema, req.query, res);
  if (!query) return;

  const { pharmacyId } = getActor(req);

  let builder = supabaseAdmin
    .from('tasks')
    .select('*', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) {
    builder = builder.eq('status', query.status);
  }

  const { data, error, count } = await builder;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({
    tasks: data ?? [],
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: count ?? 0
    }
  });
});

tasksRouter.get('/:id', async (req: Request, res: Response) => {
  const id = parseOrFail(uuidSchema, req.params.id, res);
  if (!id) return;

  const { pharmacyId } = getActor(req);

  const [
    { data: task, error: taskError },
    { data: notes, error: notesError },
    { data: events, error: eventsError }
  ] = await Promise.all([
    supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .single(),
    supabaseAdmin
      .from('task_notes')
      .select('*')
      .eq('task_id', id)
      .eq('pharmacy_id', pharmacyId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('task_events')
      .select('*')
      .eq('entity_id', id)
      .eq('entity_type', 'task')
      .eq('pharmacy_id', pharmacyId)
      .order('timestamp', { ascending: true })
  ]);

  if (taskError || !task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (notesError) {
    return res.status(500).json({ error: notesError.message });
  }

  if (eventsError) {
    return res.status(500).json({ error: eventsError.message });
  }

  return res.json({
    task,
    notes: notes ?? [],
    events: events ?? []
  });
});

tasksRouter.post(
  '/',
  taskMutationRateLimiter,
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    const payload = parseOrFail(taskCreateSchema, req.body, res);
    if (!payload) return;

    const { actorId, actorType, pharmacyId } = getActor(req);

    const insertPayload = {
      ...payload,
      pharmacy_id: pharmacyId
    };

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    await logTaskCreated(
      task.id,
      task,
      actorId,
      actorType,
      {
        ...extractRequestMeta(req, 'api'),
        pharmacy_id: pharmacyId
      }
    );

    return res.status(201).json({ task });
  }
);

tasksRouter.patch(
  '/:id',
  taskMutationRateLimiter,
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;

    const body = parseOrFail(taskUpdateSchema, req.body, res);
    if (!body) return;

    const { actorId, actorType, pharmacyId } = getActor(req);

    const { notes, updated_at, ...candidateFields } = body;

    const { data: existing, error: existingError } = await loadScopedTask(
      id,
      pharmacyId
    );

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!existing.updated_at || existing.updated_at !== updated_at) {
      return res.status(409).json({
        error: 'Task has been modified by another user. Reload and try again.'
      });
    }

    const updateFields: Record<string, unknown> = {
      ...candidateFields,
      updated_at: new Date().toISOString()
    };

    const { data: updated, error } = await supabaseAdmin
      .from('tasks')
      .update(updateFields)
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .eq('updated_at', updated_at)
      .select('*')
      .single();

    if (error || !updated) {
      return res.status(409).json({
        error: 'Task update failed. The record may have changed.'
      });
    }

    await logTaskUpdated(
      id,
      existing,
      updated,
      actorId,
      actorType,
      {
        ...extractRequestMeta(req, 'dashboard'),
        pharmacy_id: pharmacyId,
        updated_fields: Object.keys(candidateFields)
      }
    );

    if (notes && notes.trim()) {
      const { data: note, error: noteError } = await supabaseAdmin
        .from('task_notes')
        .insert({
          task_id: id,
          pharmacy_id: pharmacyId,
          author_user_id: actorId,
          content: notes.trim()
        })
        .select('*')
        .single();

      if (!noteError && note) {
        await logNoteAdded(
          id,
          note.id,
          notes.trim(),
          actorId,
          actorType,
          {
            ...extractRequestMeta(req, 'dashboard'),
            pharmacy_id: pharmacyId,
            via: 'task_edit'
          }
        );
      }
    }

    return res.json({ task: updated });
  }
);

tasksRouter.post(
  '/:id/status',
  taskMutationRateLimiter,
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;

    const body = parseOrFail(taskStatusSchema, req.body, res);
    if (!body) return;

    const { actorId, actorType, pharmacyId } = getActor(req);

    const { data: task, error: taskError } = await loadScopedTask(id, pharmacyId);

    if (taskError || !task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.updated_at || task.updated_at !== body.updated_at) {
      return res.status(409).json({
        error: 'Task has changed since it was opened. Reload and try again.'
      });
    }

    const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(body.to_status)) {
      return res.status(400).json({
        error: `Invalid transition from ${task.status} to ${body.to_status}`
      });
    }

    const updatePayload: Record<string, unknown> = {
      status: body.to_status,
      updated_at: new Date().toISOString()
    };

    if (body.to_status === 'reviewed' && task.status !== 'reviewed') {
      updatePayload.original_status = task.status;
      updatePayload.reviewed_at = new Date().toISOString();
      updatePayload.reviewed_by_user_id = actorId;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('tasks')
      .update(updatePayload)
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .eq('updated_at', body.updated_at)
      .select('*')
      .single();

    if (updateError || !updated) {
      return res.status(409).json({
        error: 'Status change failed. The record may have changed.'
      });
    }

    await logTaskStatusChanged(
      id,
      task.status,
      body.to_status,
      actorId,
      actorType,
      {
        ...extractRequestMeta(req, 'dashboard'),
        pharmacy_id: pharmacyId,
        original_status: task.status
      }
    );

    if (body.note && body.note.trim()) {
      const { data: savedNote, error: noteError } = await supabaseAdmin
        .from('task_notes')
        .insert({
          task_id: id,
          pharmacy_id: pharmacyId,
          author_user_id: actorId,
          content: body.note.trim()
        })
        .select('*')
        .single();

      if (!noteError && savedNote) {
        await logNoteAdded(
          id,
          savedNote.id,
          body.note.trim(),
          actorId,
          actorType,
          {
            ...extractRequestMeta(req, 'dashboard'),
            pharmacy_id: pharmacyId,
            via: 'status_transition'
          }
        );
      }
    }

    return res.json({ task: updated });
  }
);

tasksRouter.post(
  '/:id/notes',
  noteRateLimiter,
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;

    const body = parseOrFail(taskNoteSchema, req.body, res);
    if (!body) return;

    const { actorId, actorType, pharmacyId } = getActor(req);

    const { error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id')
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .single();

    if (taskError) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { data: note, error } = await supabaseAdmin
      .from('task_notes')
      .insert({
        task_id: id,
        pharmacy_id: pharmacyId,
        author_user_id: actorId,
        content: body.content.trim()
      })
      .select('*')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    await logNoteAdded(
      id,
      note.id,
      body.content.trim(),
      actorId,
      actorType,
      {
        ...extractRequestMeta(req, 'dashboard'),
        pharmacy_id: pharmacyId
      }
    );

    return res.status(201).json({ note });
  }
);

tasksRouter.get('/:id/events', async (req: Request, res: Response) => {
  const id = parseOrFail(uuidSchema, req.params.id, res);
  if (!id) return;

  const { pharmacyId } = getActor(req);

  const { data, error } = await supabaseAdmin
    .from('task_events')
    .select('*')
    .eq('entity_id', id)
    .eq('entity_type', 'task')
    .eq('pharmacy_id', pharmacyId)
    .order('timestamp', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ events: data ?? [] });
});
