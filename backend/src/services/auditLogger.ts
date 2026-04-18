import type { Request } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export type AuditEventType =
  | 'task_created'
  | 'task_updated'
  | 'task_status_changed'
  | 'task_reviewed'
  | 'task_completed'
  | 'task_deleted'
  | 'note_added'
  | 'note_updated'
  | 'note_deleted'
  | 'call_ingested'
  | 'task_generated_from_call'
  | 'user_login'
  | 'user_login_failed'
  | 'user_logout'
  | 'unauthorized_access_attempt';

export type ActorType = 'user' | 'system';
export type EntityType = 'task' | 'call' | 'note' | 'user';

export interface AuditEventPayload {
  event_type: AuditEventType;
  entity_type: EntityType;
  entity_id: string;
  actor_type: ActorType;
  actor_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

const VALID_EVENT_TYPES = new Set<AuditEventType>([
  'task_created',
  'task_updated',
  'task_status_changed',
  'task_reviewed',
  'task_completed',
  'task_deleted',
  'note_added',
  'note_updated',
  'note_deleted',
  'call_ingested',
  'task_generated_from_call',
  'user_login',
  'user_login_failed',
  'user_logout',
  'unauthorized_access_attempt'
]);

const VALID_ENTITY_TYPES = new Set<EntityType>(['task', 'call', 'note', 'user']);
const VALID_ACTOR_TYPES = new Set<ActorType>(['user', 'system']);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validatePayload(payload: AuditEventPayload): ValidationResult {
  const errors: string[] = [];

  if (!payload.event_type || !VALID_EVENT_TYPES.has(payload.event_type)) {
    errors.push('event_type is missing or invalid');
  }

  if (!payload.entity_type || !VALID_ENTITY_TYPES.has(payload.entity_type)) {
    errors.push('entity_type is missing or invalid');
  }

  if (!payload.entity_id || !UUID_PATTERN.test(payload.entity_id)) {
    errors.push('entity_id must be a valid UUID');
  }

  if (!payload.actor_type || !VALID_ACTOR_TYPES.has(payload.actor_type)) {
    errors.push('actor_type is missing or invalid');
  }

  if (!payload.actor_id || typeof payload.actor_id !== 'string' || !payload.actor_id.trim()) {
    errors.push('actor_id must be a non-empty string');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function cleanObject(
  obj: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (obj === null || obj === undefined) return null;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function extractRequestMeta(req: Request, source: string): Record<string, unknown> {
  return {
    source,
    ip_address: req.ip ?? req.socket?.remoteAddress ?? null,
    user_agent: req.headers['user-agent'] ?? null
  };
}

export async function logEvent(payload: AuditEventPayload): Promise<void> {
  const { valid, errors } = validatePayload(payload);

  if (!valid) {
    const strictMode = process.env.AUDIT_STRICT_MODE === 'true';
    const message = `[AuditLogger] Invalid audit payload: ${errors.join(', ')}`;

    if (strictMode) {
      throw new Error(message);
    }

    console.error(message, {
      event_type: payload.event_type ?? null,
      entity_type: payload.entity_type ?? null,
      entity_id: payload.entity_id ?? null
    });
    return;
  }

  const record = {
    event_type: payload.event_type,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    actor_type: payload.actor_type,
    actor_id: payload.actor_id.trim(),
    timestamp: new Date().toISOString(),
    before: cleanObject(payload.before ?? null),
    after: cleanObject(payload.after ?? null),
    metadata: cleanObject(payload.metadata ?? {}) ?? {}
  };

  const { error } = await supabaseAdmin.from('task_events').insert(record);

  if (error) {
    const strictMode = process.env.AUDIT_STRICT_MODE === 'true';
    const message = `[AuditLogger] Failed to write audit event: ${error.message}`;

    if (strictMode) {
      throw new Error(message);
    }

    console.error(message, {
      event_type: payload.event_type,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null
    });
  }
}

export async function logTaskCreated(
  taskId: string,
  afterState: Record<string, unknown>,
  actorId: string,
  actorType: ActorType = 'user',
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logEvent({
    event_type: 'task_created',
    entity_type: 'task',
    entity_id: taskId,
    actor_type: actorType,
    actor_id: actorId,
    before: null,
    after: afterState,
    metadata: meta
  });
}

export async function logTaskUpdated(
  taskId: string,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
  actorId: string,
  actorType: ActorType = 'user',
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logEvent({
    event_type: 'task_updated',
    entity_type: 'task',
    entity_id: taskId,
    actor_type: actorType,
    actor_id: actorId,
    before: beforeState,
    after: afterState,
    metadata: meta
  });
}

export async function logTaskStatusChanged(
  taskId: string,
  fromStatus: string,
  toStatus: string,
  actorId: string,
  actorType: ActorType = 'user',
  meta: Record<string, unknown> = {}
): Promise<void> {
  const beforeAfter = {
    before: { status: fromStatus },
    after: { status: toStatus }
  };

  await logEvent({
    event_type: 'task_status_changed',
    entity_type: 'task',
    entity_id: taskId,
    actor_type: actorType,
    actor_id: actorId,
    ...beforeAfter,
    metadata: meta
  });

  if (toStatus === 'reviewed') {
    await logEvent({
      event_type: 'task_reviewed',
      entity_type: 'task',
      entity_id: taskId,
      actor_type: actorType,
      actor_id: actorId,
      ...beforeAfter,
      metadata: meta
    });
  }

  if (toStatus === 'completed') {
    await logEvent({
      event_type: 'task_completed',
      entity_type: 'task',
      entity_id: taskId,
      actor_type: actorType,
      actor_id: actorId,
      ...beforeAfter,
      metadata: meta
    });
  }
}

export async function logNoteAdded(
  taskId: string,
  noteId: string,
  content: string,
  actorId: string,
  actorType: ActorType = 'user',
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logEvent({
    event_type: 'note_added',
    entity_type: 'task',
    entity_id: taskId,
    actor_type: actorType,
    actor_id: actorId,
    before: null,
    after: {
      note_id: noteId,
      content_length: content.length
    },
    metadata: meta
  });
}

export async function logCallIngested(
  callId: string,
  actorId: string,
  actorType: ActorType = 'system',
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logEvent({
    event_type: 'call_ingested',
    entity_type: 'call',
    entity_id: callId,
    actor_type: actorType,
    actor_id: actorId,
    before: null,
    after: null,
    metadata: meta
  });
}

export async function logTaskGeneratedFromCall(
  taskId: string,
  callId: string,
  afterState: Record<string, unknown>,
  actorId: string,
  actorType: ActorType = 'system',
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logEvent({
    event_type: 'task_generated_from_call',
    entity_type: 'task',
    entity_id: taskId,
    actor_type: actorType,
    actor_id: actorId,
    before: null,
    after: afterState,
    metadata: {
      ...meta,
      call_id: callId
    }
  });
}
