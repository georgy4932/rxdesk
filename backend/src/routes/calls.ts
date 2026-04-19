import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { taskMutationRateLimiter } from '../middleware/rateLimiters.js';
import {
  logCallIngested,
  logTaskCreated,
  logTaskGeneratedFromCall,
  extractRequestMeta
} from '../services/auditLogger.js';

export const callsRouter = Router();

callsRouter.use(requireAuth);

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
const SOURCE_ENUM = z.enum([
  'demo_ingestion',
  'phone_call',
  'manual_entry',
  'import'
]);

const uuidSchema = z.string().uuid();

const safeText = (max: number) => z.string().trim().min(1).max(max);

const optionalSafeText = (max: number) =>
  z.string().trim().max(max).optional().nullable();

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[0-9+()\-\s]+$/, 'Phone contains invalid characters')
  .optional()
  .nullable();

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD')
  .optional()
  .nullable();

const confidenceSchema = z
  .number()
  .min(0)
  .max(100)
  .optional()
  .nullable();

const extractionSchema = z.object({
  patient_name: safeText(150),
  patient_dob: dobSchema,
  patient_phone: phoneSchema,
  request_type: safeText(100),
  category: CATEGORY_ENUM,
  medications: optionalSafeText(500),
  collection_slot: optionalSafeText(100),
  urgency_level: URGENCY_ENUM.optional().default('routine'),
  status: STATUS_ENUM.optional().default('needs_review'),
  confidence_score: confidenceSchema,
  display_summary: optionalSafeText(300),
  ai_summary: optionalSafeText(1000),
  next_step: optionalSafeText(500),
  reviewed_copy: optionalSafeText(300)
});

const ingestSchema = z.object({
  source: SOURCE_ENUM.optional().default('demo_ingestion'),
  caller_name: optionalSafeText(150),
  caller_phone: phoneSchema,
  raw_transcript: optionalSafeText(10000),
  transcript_summary: optionalSafeText(2000),
  ai_extraction: extractionSchema
});

type IngestPayload = z.infer<typeof ingestSchema>;
type ExtractionPayload = z.infer<typeof extractionSchema>;

function parseOrFail<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  res: Response
): z.infer<T> | null {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.flatten()
    });
    return null;
  }

  return parsed.data;
}

function getActor(req: Request) {
  if (!req.user) {
    throw new Error('Authenticated user required');
  }

  if (!req.user.pharmacyId) {
    throw new Error('Authenticated user is missing pharmacy scope');
  }

  return {
    actorId: req.user.id,
    actorType: 'user' as const,
    pharmacyId: req.user.pharmacyId,
    role: req.user.role
  };
}

function buildCallCreatePayload(
  body: IngestPayload,
  pharmacyId: string
) {
  const extraction = body.ai_extraction;

  return {
    pharmacy_id: pharmacyId,
    source: body.source,
    caller_name: body.caller_name ?? extraction.patient_name ?? null,
    caller_phone: body.caller_phone ?? extraction.patient_phone ?? null,
    raw_transcript: body.raw_transcript ?? null,
    transcript_summary: body.transcript_summary ?? null,
    ai_extraction_json: extraction
  };
}

function buildTaskPayloadFromExtraction(
  callId: string,
  pharmacyId: string,
  body: IngestPayload
) {
  const extraction: ExtractionPayload = body.ai_extraction;

  return {
    pharmacy_id: pharmacyId,
    call_id: callId,
    patient_name: extraction.patient_name,
    patient_dob: extraction.patient_dob ?? null,
    patient_phone: extraction.patient_phone ?? null,
    request_type: extraction.request_type,
    category: extraction.category,
    medications: extraction.medications ?? null,
    collection_slot: extraction.collection_slot ?? null,
    urgency_level: extraction.urgency_level ?? 'routine',
    status: extraction.status ?? 'needs_review',
    confidence_score: extraction.confidence_score ?? null,
    display_summary: extraction.display_summary ?? null,
    ai_summary: extraction.ai_summary ?? null,
    transcript_summary: body.transcript_summary ?? null,
    next_step: extraction.next_step ?? null,
    reviewed_copy: extraction.reviewed_copy ?? null
  };
}

callsRouter.post(
  '/ingest',
  taskMutationRateLimiter,
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    try {
      const body = parseOrFail(ingestSchema, req.body, res);
      if (!body) return;

      const { actorId, actorType, pharmacyId } = getActor(req);
      const requestMeta = {
        ...extractRequestMeta(req, 'ingestion'),
        pharmacy_id: pharmacyId
      };

      const callPayload = buildCallCreatePayload(body, pharmacyId);

      const { data: call, error: callError } = await supabaseAdmin
        .from('calls')
        .insert(callPayload)
        .select('*')
        .single();

      if (callError || !call) {
        return res.status(400).json({
          error: callError?.message ?? 'Call creation failed'
        });
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

      const taskPayload = buildTaskPayloadFromExtraction(call.id, pharmacyId, body);

      const { data: task, error: taskError } = await supabaseAdmin
        .from('tasks')
        .insert(taskPayload)
        .select('*')
        .single();

      if (taskError || !task) {
        await supabaseAdmin
          .from('calls')
          .delete()
          .eq('id', call.id)
          .eq('pharmacy_id', pharmacyId);

        return res.status(400).json({
          error: taskError?.message ?? 'Task creation failed',
          note: 'Call creation was rolled back because linked task creation failed.'
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
          confidence_score: body.ai_extraction.confidence_score ?? null
        }
      );

      return res.status(201).json({
        call_id: call.id,
        task_id: task.id,
        status: 'created'
      });
    } catch (error) {
      console.error('POST /calls/ingest failed', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

callsRouter.get(
  '/:id',
  requireRole(['admin', 'pharmacist', 'staff']),
  async (req: Request, res: Response) => {
    try {
      const id = parseOrFail(uuidSchema, req.params.id, res);
      if (!id) return;

      const { pharmacyId } = getActor(req);

      const { data, error } = await supabaseAdmin
        .from('calls')
        .select('*')
        .eq('id', id)
        .eq('pharmacy_id', pharmacyId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Call not found' });
      }

      return res.json({ call: data });
    } catch (error) {
      console.error('GET /calls/:id failed', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);
