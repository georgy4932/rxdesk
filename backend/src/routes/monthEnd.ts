// RxDesk - Month-end Support Routes
// src/routes/monthEnd.ts
//
// Mirrors the structure of tasks.ts and calls.ts.
// All routes are pharmacy-scoped via getActor().
// SECURITY NOTE: actor identity comes from requireAuth middleware,
// not from req.body. Do not change this.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

export const monthEndRouter = Router();

monthEndRouter.use(requireAuth);

const ISSUE_TYPE_ENUM = z.enum([
  'missing_endorsement',
  'exception',
  'paper_rx',
  'pricing_issue',
  'invalid_quantity',
  'other'
]);

const PRIORITY_ENUM = z.enum(['low', 'medium', 'high']);

const STATUS_ENUM = z.enum([
  'new',
  'needs_review',
  'in_progress',
  'ready_for_submission',
  'completed'
]);

const uuidSchema = z.string().uuid();
const safeText = (max: number) => z.string().trim().min(1).max(max);
const optText   = (max: number) => z.string().trim().max(max).optional().nullable();

const createItemSchema = z.object({
  patient_name:           safeText(150),
  prescription_reference: optText(100),
  medication_name:        optText(200),
  issue_type:             ISSUE_TYPE_ENUM,
  category:               z.string().trim().max(100).optional().default('general'),
  priority:               PRIORITY_ENUM.optional().default('medium'),
  status:                 STATUS_ENUM.optional().default('new'),
  ai_summary:             optText(2000),
  display_summary:        optText(500),
  next_step:              optText(500),
  internal_note:          optText(2000),
  task_id:                z.string().uuid().optional().nullable(),
  assigned_user_id:       z.string().uuid().optional().nullable()
});

const updateItemSchema = z.object({
  patient_name:           safeText(150).optional(),
  prescription_reference: optText(100),
  medication_name:        optText(200),
  priority:               PRIORITY_ENUM.optional(),
  next_step:              optText(500),
  display_summary:        optText(500),
  internal_note:          optText(2000),
  assigned_user_id:       z.string().uuid().optional().nullable()
});

const statusSchema = z.object({
  to_status: STATUS_ENUM,
  note:      optText(2000)
});

const noteSchema = z.object({
  content: safeText(2000)
});

function parseOrFail<T extends z.ZodTypeAny>(schema: T, input: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(input);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return null;
  }
  return result.data;
}

function getActor(req: Request) {
  if (!req.user) throw new Error('Authenticated user required');
  if (!req.user.pharmacyId) throw new Error('Authenticated user is missing pharmacy scope');
  return { actorId: req.user.id, pharmacyId: req.user.pharmacyId as string, role: req.user.role };
}

monthEndRouter.get('/', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const { pharmacyId } = getActor(req);
    const status       = req.query.status       as string | undefined;
    const issue_type   = req.query.issue_type   as string | undefined;
    const priority     = req.query.priority     as string | undefined;
    const final_review = req.query.final_review === 'true';
    const page         = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit        = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset       = (page - 1) * limit;

    let query = supabaseAdmin.from('month_end_items').select('*', { count: 'exact' })
      .eq('pharmacy_id', pharmacyId).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    if (final_review) {
      query = query.in('status', ['new', 'needs_review', 'in_progress']);
    } else {
      if (status)     query = query.eq('status', status);
      if (issue_type) query = query.eq('issue_type', issue_type);
      if (priority)   query = query.eq('priority', priority);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data ?? [], total: count ?? 0, page, limit });
  } catch (error) {
    console.error('GET /month-end failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.get('/summary', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const { pharmacyId } = getActor(req);
    const { data, error } = await supabaseAdmin.from('month_end_items')
      .select('status, issue_type, priority').eq('pharmacy_id', pharmacyId);
    if (error) return res.status(500).json({ error: error.message });

    const items = data ?? [];
    const total = items.length;
    const completed = items.filter(i => i.status === 'completed').length;

    return res.json({ summary: {
      total, completed,
      completion_pct: total > 0 ? Math.round((completed / total) * 100) : 0,
      by_status: {
        new:                  items.filter(i => i.status === 'new').length,
        needs_review:         items.filter(i => i.status === 'needs_review').length,
        in_progress:          items.filter(i => i.status === 'in_progress').length,
        ready_for_submission: items.filter(i => i.status === 'ready_for_submission').length,
        completed
      },
      by_issue_type: {
        missing_endorsement: items.filter(i => i.issue_type === 'missing_endorsement').length,
        exception:           items.filter(i => i.issue_type === 'exception').length,
        paper_rx:            items.filter(i => i.issue_type === 'paper_rx').length,
        pricing_issue:       items.filter(i => i.issue_type === 'pricing_issue').length,
        invalid_quantity:    items.filter(i => i.issue_type === 'invalid_quantity').length,
        other:               items.filter(i => i.issue_type === 'other').length
      },
      by_priority: {
        high:   items.filter(i => i.priority === 'high').length,
        medium: items.filter(i => i.priority === 'medium').length,
        low:    items.filter(i => i.priority === 'low').length
      }
    }});
  } catch (error) {
    console.error('GET /month-end/summary failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.get('/:id', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;
    const { pharmacyId } = getActor(req);
    const [{ data: item, error: itemError }, { data: notes }] = await Promise.all([
      supabaseAdmin.from('month_end_items').select('*').eq('id', id).eq('pharmacy_id', pharmacyId).single(),
      supabaseAdmin.from('month_end_notes').select('*').eq('item_id', id).eq('pharmacy_id', pharmacyId).order('created_at', { ascending: true })
    ]);
    if (itemError || !item) return res.status(404).json({ error: 'Item not found' });
    return res.json({ item, notes: notes ?? [] });
  } catch (error) {
    console.error('GET /month-end/:id failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.post('/', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const body = parseOrFail(createItemSchema, req.body, res);
    if (!body) return;
    const { pharmacyId } = getActor(req);
    const { data: item, error } = await supabaseAdmin.from('month_end_items')
      .insert({ ...body, pharmacy_id: pharmacyId }).select('*').single();
    if (error || !item) return res.status(400).json({ error: error?.message ?? 'Creation failed' });
    return res.status(201).json({ item });
  } catch (error) {
    console.error('POST /month-end failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.patch('/:id', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;
    const body = parseOrFail(updateItemSchema, req.body, res);
    if (!body) return;
    const { pharmacyId, actorId } = getActor(req);
    const { error: existingError } = await supabaseAdmin.from('month_end_items')
      .select('id').eq('id', id).eq('pharmacy_id', pharmacyId).single();
    if (existingError) return res.status(404).json({ error: 'Item not found' });
    const { internal_note, ...fields } = body;
    const updatePayload: Record<string, unknown> = { ...fields };
    if (internal_note !== undefined) updatePayload.internal_note = internal_note;
    const { data: item, error } = await supabaseAdmin.from('month_end_items')
      .update(updatePayload).eq('id', id).eq('pharmacy_id', pharmacyId).select('*').single();
    if (error || !item) return res.status(400).json({ error: error?.message ?? 'Update failed' });
    const noteContent = req.body.note as string | undefined;
    if (noteContent && typeof noteContent === 'string' && noteContent.trim()) {
      await supabaseAdmin.from('month_end_notes').insert({
        item_id: id, pharmacy_id: pharmacyId,
        author_user_id: actorId !== 'dev-user' ? actorId : null, content: noteContent.trim()
      });
    }
    return res.json({ item });
  } catch (error) {
    console.error('PATCH /month-end/:id failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.post('/:id/status', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;
    const body = parseOrFail(statusSchema, req.body, res);
    if (!body) return;
    const { pharmacyId, actorId } = getActor(req);
    const updatePayload: Record<string, unknown> = { status: body.to_status };
    if (body.to_status === 'completed') {
      updatePayload.resolved_at = new Date().toISOString();
      updatePayload.resolved_by_user_id = actorId !== 'dev-user' ? actorId : null;
    }
    const { data: item, error } = await supabaseAdmin.from('month_end_items')
      .update(updatePayload).eq('id', id).eq('pharmacy_id', pharmacyId).select('*').single();
    if (error || !item) return res.status(400).json({ error: error?.message ?? 'Status update failed' });
    if (body.note && body.note.trim()) {
      await supabaseAdmin.from('month_end_notes').insert({
        item_id: id, pharmacy_id: pharmacyId,
        author_user_id: actorId !== 'dev-user' ? actorId : null, content: body.note.trim()
      });
    }
    return res.json({ item });
  } catch (error) {
    console.error('POST /month-end/:id/status failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

monthEndRouter.post('/:id/notes', requireRole(['admin', 'pharmacist', 'staff']), async (req: Request, res: Response) => {
  try {
    const id = parseOrFail(uuidSchema, req.params.id, res);
    if (!id) return;
    const body = parseOrFail(noteSchema, req.body, res);
    if (!body) return;
    const { pharmacyId, actorId } = getActor(req);
    const { error: existingError } = await supabaseAdmin.from('month_end_items')
      .select('id').eq('id', id).eq('pharmacy_id', pharmacyId).single();
    if (existingError) return res.status(404).json({ error: 'Item not found' });
    const { data: note, error } = await supabaseAdmin.from('month_end_notes')
      .insert({ item_id: id, pharmacy_id: pharmacyId, author_user_id: actorId !== 'dev-user' ? actorId : null, content: body.content })
      .select('*').single();
    if (error || !note) return res.status(400).json({ error: error?.message ?? 'Note creation failed' });
    return res.status(201).json({ note });
  } catch (error) {
    console.error('POST /month-end/:id/notes failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
