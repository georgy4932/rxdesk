# RxDesk — Audit Log Requirements

Version: 1.0  
Last Updated: [INSERT DATE]  
Owner: Technical Lead  

---

## 1. Purpose

Audit logs provide a **complete, immutable record of all critical actions** within RxDesk.

They are required for:
- security investigation
- clinical safety review
- operational debugging
- compliance and accountability

Audit logs are a **core system requirement**, not optional.

---

## 2. Core Principle

Every meaningful action must be:

- recorded
- timestamped
- attributable to a user or system
- immutable after creation

---

## 3. Events That MUST Be Logged

### Task Events

- Task created
- Task edited
- Task status changed
- Task reviewed
- Task completed
- Task deleted (if allowed)

---

### Notes

- Note added
- Note edited (if allowed)
- Note deleted (if allowed)

---

### Call / Ingestion

- Call ingested
- Task generated from call
- Extraction result saved

---

### Security / Access

- User login
- Failed login attempt
- Logout
- Unauthorized access attempt

---

## 4. Event Structure (MANDATORY)

Each audit log entry must include:

```json
{
  "id": "uuid",
  "event_type": "task_status_changed",
  "entity_type": "task",
  "entity_id": "task_id",

  "actor_type": "user | system",
  "actor_id": "user_id or system",

  "timestamp": "ISO8601",

  "before": { },
  "after": { },

  "metadata": {
    "source": "dashboard | api | ingestion",
    "ip_address": "optional",
    "user_agent": "optional"
  }
}
