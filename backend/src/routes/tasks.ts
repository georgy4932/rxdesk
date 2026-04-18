import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import {
  logTaskCreated,
  logTaskUpdated,
  logTaskStatusChanged,
  logNoteAdded,
  extractRequestMeta
} from '../services/auditLogger.js';

export const tasksRouter = Router();

const SYSTEM = 'system';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  urgent_review: ['reviewed'],
  needs_review: ['reviewed', 'queued'],
  callback_needed: ['reviewed'],
  reviewed: ['queued', 'completed'],
  queued: ['completed'],
  completed: []
};

const VALID_STATUSES = new Set([
  'urgent_review',
  'needs_review',
  'callback_needed',
  'reviewed',
  'queued',
  'completed'
]);

const VALID_CATEGORIES = new Set(['repeat', 'query', 'collection', 'urgent']);
const VALID_URGENCY = new Set(['routine', 'urgent']);

function isValidUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function buildTaskCreatePayload(body: Record<string, unknown>): Record<string, unknown> | null {
  const {
    call_id,
    patient_name,
    patient_dob,
    patient_phone,
    request_type,
    category,
    medications,
    collection_slot,
    urgency_level,
    status,
    confidence_score,
    display_summary,
    ai_summary,
    transcript_summary,
    next_step,
    reviewed_copy
  } = body;

  if (!patient_name || typeof patient_name !== 'string') return null;
  if (!request_type || typeof request_type !== 'string') return null;
  if (!category || !VALID_CATEGORIES.has(category as string)) return null;
  if (!status || !VALID_STATUSES.has(status as string)) return null;

  return {
    call_id: isValidUuid(call_id) ? call_id : null,
    patient_name: String(patient_name).trim(),
    patient_dob: patient_dob ?? null,
    patient_phone: patient_phone ?? null,
    request_type: String(request_type).trim(),
    category: String(category),
    medications: medications ?? null,
    collection_slot: collection_slot ?? null,
    urgency_level: VALID_URGENCY.has(urgency_level as string) ? urgency_level : 'routine',
    status: String(status),
    confidence_score: typeof confidence_score === 'number' ? confidence_score : null,
    display_summary: display_summary ?? null,
    ai_summary: ai_summary ?? null,
    transcript_summary: transcript_summary ?? null,
    next_step: next_step ?? null,
    reviewed_copy: reviewed_copy ?? null
  };
}

function buildTaskUpdatePayload(body: Record<string, unknown>): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};

  if (body.patient_name && typeof body.patient_name === 'string') {
    allowed.patient_name = String(body.patient_name).trim();
  }
  if (body.patient_dob !== undefined) {
    allowed.patient_dob = body.patient_dob ?? null;
  }
  if (body.patient_phone !== undefined) {
    allowed.patient_phone = body.patient_phone ?? null;
  }
  if (body.medications !== undefined) {
    allowed.medications = body.medications ?? null;
  }
  if (body.collection_slot !== undefined) {
    allowed.collection_slot = body.collection_slot ?? null;
  }
  if (body.next_step && typeof body.next_step === 'string') {
    allowed.next_step = String(body.next_step).trim();
  }
  if (body.display_summary && typeof body.display_summary === 'string') {
    allowed.display_summary = String(body.display_summary).trim();
  }
  if (body.urgency_level && VALID_URGENCY.has(body.urgency_level as string)) {
    allowed.urgency_level = body.urgency_level;
  }

  return allowed;
}

tasksRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  let query = supabaseAdmin
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ tasks: data ?? [] });
});

tasksRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const [
    { data: task, error: taskError },
    { data: notes },
    { data: events }
  ] = await Promise.all([
    supabaseAdmin.from('tasks').select('*').eq('id', id).single(),
    supabaseAdmin
      .from('task_notes')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('task_events')
      .select('*')
      .eq('entity_id', id)
      .eq('entity_type', 'task')
      .order('timestamp', { ascending: true })
  ]);

  if (taskError) return res.status(404).json({ error: 'Task not found' });

  res.json({ task, notes: notes ?? [], events: events ?? [] });
});

tasksRouter.post('/', async (req: Request, res: Response) => {
  const payload = buildTaskCreatePayload(req.body);

  if (!payload) {
    return res.status(400).json({
      error: 'Invalid task payload. Required: patient_name, request_type, category, status'
    });
  }

  const actorId = typeof req.body.actor_user_id === 'string' ? req.body.actor_user_id : SYSTEM;
  const actorType = actorId === SYSTEM ? 'system' : 'user';

  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .insert(payload)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await logTaskCreated(
    task.id,
    task,
    actorId,
    actorType,
    extractRequestMeta(req, 'api')
  );

  res.status(201).json({ task });
});

tasksRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const fields = buildTaskUpdatePayload(req.body);

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  const actorId = typeof req.body.actor_user_id === 'string' ? req.body.actor_user_id : SYSTEM;
  const actorType = actorId === SYSTEM ? 'system' : 'user';
  const notes = typeof req.body.notes === 'string' ? req.body.notes : null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (existingError) return res.status(404).json({ error: 'Task not found' });

  const { data: updated, error } = await supabaseAdmin
    .from('tasks')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await logTaskUpdated(
    id,
    existing,
    updated,
    actorId,
    actorType,
    {
      ...extractRequestMeta(req, 'dashboard'),
      updated_fields: Object.keys(fields)
    }
  );

  if (notes && notes.trim()) {
    const { data: note, error: noteError } = await supabaseAdmin
      .from('task_notes')
      .insert({
        task_id: id,
        author_user_id: actorId !== SYSTEM ? actorId : null,
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
        { ...extractRequestMeta(req, 'dashboard'), via: 'task_edit' }
      );
    }
  }

  res.json({ task: updated });
});

tasksRouter.post('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const { to_status, note } = req.body;

  if (!to_status || typeof to_status !== 'string' || !VALID_STATUSES.has(to_status)) {
    return res.status(400).json({ error: 'Invalid or missing to_status' });
  }

  const actorId = typeof req.body.actor_user_id === 'string' ? req.body.actor_user_id : SYSTEM;
  const actorType = actorId === SYSTEM ? 'system' : 'user';

  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (taskError || !task) return res.status(404).json({ error: 'Task not found' });

  const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
  if (!allowed.includes(to_status)) {
    return res.status(400).json({
      error: 'Invalid transition from ' + task.status + ' to ' + to_status
    });
  }

  const updatePayload: Record<string, unknown> = { status: to_status };

  if (to_status === 'reviewed' && task.status !== 'reviewed') {
    updatePayload.original_status = task.status;
    updatePayload.reviewed_at = new Date().toISOString();
    updatePayload.reviewed_by_user_id = actorId !== SYSTEM ? actorId : null;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('tasks')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) return res.status(400).json({ error: updateError.message });

  await logTaskStatusChanged(
    id,
    task.status,
    to_status,
    actorId,
    actorType,
    {
      ...extractRequestMeta(req, 'dashboard'),
      original_status: task.status
    }
  );

  if (note && typeof note === 'string' && note.trim()) {
    const { data: savedNote, error: noteError } = await supabaseAdmin
      .from('task_notes')
      .insert({
        task_id: id,
        author_user_id: actorId !== SYSTEM ? actorId : null,
        content: note.trim()
      })
      .select('*')
      .single();

    if (!noteError && savedNote) {
      await logNoteAdded(
        id,
        savedNote.id,
        note.trim(),
        actorId,
        actorType,
        { ...extractRequestMeta(req, 'dashboard'), via: 'status_transition' }
      );
    }
  }

  res.json({ task: updated });
});

tasksRouter.post('/:id/notes', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const { content } = req.body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Note content is required' });
  }

  const actorId = typeof req.body.author_user_id === 'string' ? req.body.author_user_id : SYSTEM;
  const actorType = actorId === SYSTEM ? 'system' : 'user';

  const { error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('id', id)
    .single();

  if (taskError) return res.status(404).json({ error: 'Task not found' });

  const { data: note, error } = await supabaseAdmin
    .from('task_notes')
    .insert({
      task_id: id,
      author_user_id: actorId !== SYSTEM ? actorId : null,
      content: content.trim()
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await logNoteAdded(
    id,
    note.id,
    content.trim(),
    actorId,
    actorType,
    extractRequestMeta(req, 'dashboard')
  );

  res.status(201).json({ note });
});

tasksRouter.get('/:id/events', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  const { data, error } = await supabaseAdmin
    .from('task_events')
    .select('*')
    .eq('entity_id', id)
    .eq('entity_type', 'task')
    .order('timestamp', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ events: data ?? [] });
});
