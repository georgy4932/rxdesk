-- RxDesk - Audit Log Schema
-- Satisfies AUDIT_LOG_REQUIREMENTS.md v1.0
-- Run this in Supabase SQL Editor

drop table if exists task_events cascade;

create table task_events (
  id           uuid        primary key default gen_random_uuid(),
  event_type   text        not null,
  entity_type  text        not null check (entity_type in ('task', 'call', 'note', 'user')),
  entity_id    uuid        not null,
  actor_type   text        not null check (actor_type in ('user', 'system')),
  actor_id     text        not null default 'system',
  timestamp    timestamptz not null default now(),
  before       jsonb,
  after        jsonb,
  metadata     jsonb       not null default '{}'::jsonb,

  constraint valid_event_type check (event_type in (
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
  ))
);

create index idx_task_events_entity_id   on task_events (entity_id);
create index idx_task_events_entity_type on task_events (entity_type);
create index idx_task_events_timestamp   on task_events (timestamp asc);
create index idx_task_events_event_type  on task_events (event_type);

create or replace function block_task_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Audit log records are immutable. UPDATE and DELETE are not permitted on task_events.'
    using errcode = 'restrict_violation';
  return null;
end;
$$;

drop trigger if exists trg_task_events_immutable on task_events;
create trigger trg_task_events_immutable
before update or delete on task_events
for each row execute function block_task_events_mutation();
