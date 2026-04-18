import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import {
  logCallIngested,
  logTaskCreated,
  logTaskGeneratedFromCall,
  extractRequestMeta
} from '../services/auditLogger.js';

export const callsRouter = Router();

const SYSTEM = 'system';

const VALID_CATEGORIES = new Set(['repeat', 'query', 'collection', 'urgent']);

const VALID_STATUSES = new Set([
  'urgent_review',
  'needs_review',
  'callback_needed',
  'reviewed',
  'queued',
  'completed'
]);

const VALID_URGENCY = new Set(['routine', 'urgent']);

function isValidUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidConfidenceScore(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  return value >= 0 && value <= 100;
}

function buildCallCreatePayload(
  body: Record<string, unknown>,
  extraction: Record<string, unknown>
): Record<string, unknown> {
  const source =
    typeof body.source === 'string' ? body.source : 'demo_ingestion';

  const caller_name =
    typeof body.caller_name === 'string'
      ? body.caller_name
      : typeof extraction.patient_name === 'string'
        ? extraction.patient_name
        : null;

  const caller_phone =
    typeof body.caller_phone === 'string'
      ? body.caller_phone
      : typeof extraction.patient_phone === 'string'
        ? extraction.patient_phone
        : null;

  return {
    source,
    caller_name,
    caller_phone,
    raw_transcript:
      typeof body.raw_transcript === 'string' ? body.raw_transcript : null,
    transcript_summary:
      typeof body.transcript_summary === 'string' ? body.transcript_summary : null,
    ai_extraction_json: extraction
  };
}

function buildTaskPayloadFromExtraction(
  callId: string,
  extraction: Record<string, unknown>,
  transcriptSummary: string | null
): Record<string, unknown> {
  return {
    call_id: callId,
    patient_name:
      typeof extraction.patient_name === 'string'
        ? extraction.patient_name.trim()
        : null,
    patient_dob: extraction.patient_dob ?? null,
    patient_phone:
      typeof extraction.patient_phone === 'string'
        ? extraction.patient_phone
        : null,
    request_type:
      typeof extraction.request_type === 'string'
        ? extraction.request_type.trim()
        : null,
    category:
      typeof extraction.category === 'string' && VALID_CATEGORIES.has(extraction.category)
        ? extraction.category
        : null,
    medications:
      typeof extraction.medications === 'string'
        ? extraction.medications
        : null,
    collection_slot:
      typeof extraction.collection_slot === 'string'
        ? extraction.collection_slot
        : null,
    urgency_level:
      typeof extraction.urgency_level === 'string' && VALID_URGENCY.has(extraction.urgency_level)
        ? extraction.urgency_level
        : 'routine',
    status:
      typeof extraction.status === 'string' && VALID_STATUSES.has(extraction.status)
        ? extraction.status
        : 'needs_review',
    confidence_score:
      isValidConfidenceScore(extraction.confidence_score)
        ? ((extraction.confidence_score as number) ?? null)
        : null,
    display_summary:
      typeof extraction.display_summary === 'string'
        ? extraction.display_summary
        : null,
    ai_summary:
      typeof extraction.ai_summary === 'string'
        ? extraction.ai_summary
        : null,
    transcript_summary: transcriptSummary ?? null,
    next_step:
      typeof extraction.next_step === 'string'
        ? extraction.next_step
        : null,
    reviewed_copy:
      typeof extraction.reviewed_copy === 'string'
        ? extraction.reviewed_copy
        : null
  };
}

callsRouter.post('/ingest', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  const actorId =
    typeof body.actor_user_id === 'string' ? body.actor_user_id : SYSTEM;
  const actorType = actorId === SYSTEM ? 'system' : 'user';
  const requestMeta = extractRequestMeta(req, 'ingestion');

  const extraction = body.ai_extraction;

  if (!extraction || typeof extraction !== 'object' || Array.isArray(extraction)) {
    return res.status(400).json({ error: 'ai_extraction must be a non-null object' });
  }

  const ext = extraction as Record<string, unknown>;

  if (!ext.patient_name || typeof ext.patient_name !== 'string' || !ext.patient_name.trim()) {
    return res.status(400).json({ error: 'ai_extraction.patient_name is required' });
  }

  if (!ext.request_type || typeof ext.request_type !== 'string') {
    return res.status(400).json({ error: 'ai_extraction.request_type is required' });
  }

  if (typeof ext.category !== 'string' || !VALID_CATEGORIES.has(ext.category)) {
    return res.status(400).json({
      error: 'ai_extraction.category must be one of: repeat, query, collection, urgent'
    });
  }

  if (typeof ext.status !== 'string' || !VALID_STATUSES.has(ext.status)) {
    return res.status(400).json({
      error: 'ai_extraction.status must be a valid task status'
    });
  }

  if (!isValidConfidenceScore(ext.confidence_score)) {
    return res.status(400).json({
      error: 'ai_extraction.confidence_score must be a finite number between 0 and 100'
    });
  }

  const transcriptSummary =
    typeof body.transcript_summary === 'string' ? body.transcript_summary : null;

  const callPayload = buildCallCreatePayload(body, ext);

  const { data: call, error: callError } = await supabaseAdmin
    .from('calls')
    .insert(callPayload)
    .select('*')
    .single();

  if (callError) {
    return res.status(400).json({ error: callError.message });
  }

  await logCallIngested(
    call.id,
    actorId,
    actorType,
    {
      ...requestMeta,
      call_source: callPayload.source,
      caller_name: callPayload.caller_name
    }
  );

  const taskPayload = buildTaskPayloadFromExtraction(call.id, ext, transcriptSummary);

  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .insert(taskPayload)
    .select('*')
    .single();

  if (taskError) {
    return res.status(400).json({
      error: taskError.message,
      call_id: call.id,
      note: 'Call record was created but task creation failed. Use call_id to investigate.'
    });
  }

  await logTaskCreated(
    task.id,
    task,
    actorId,
    actorType,
    {
      ...requestMeta,
      call_id: call.id,
      call_source: callPayload.source
    }
  );

  await logTaskGeneratedFromCall(
    task.id,
    call.id,
    task,
    actorId,
    actorType,
    {
      ...requestMeta,
      confidence_score: isValidConfidenceScore(ext.confidence_score)
        ? ext.confidence_score
        : null
    }
  );

  res.status(201).json({
    call_id: call.id,
    task_id: task.id,
    status: 'created'
  });
});

callsRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return res.status(400).json({ error: 'Invalid call id' });
  }

  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Call not found' });

  res.json({ call: data });
});
