# RxDesk — Release Gates

Version: 1.0  
Last Updated: [INSERT DATE]  
Owner: Product + Technical Lead  

---

This document defines the **mandatory go/no-go criteria** for releasing RxDesk to a real UK pharmacy environment.

RxDesk is **NOT considered safe for pilot use** unless all gates are GREEN.

---

## Status Definitions

- 🔴 RED → Not safe, not acceptable
- 🟠 AMBER → Partial, not ready for real-world use
- 🟢 GREEN → Meets minimum acceptable standard
- 🟢+ GREEN+ → Strong, production-ready

---

## Gate 1 — Security

Owner: Technical Lead / Security Lead  

All must be GREEN:

- [ ] Authentication required for all non-public routes
- [ ] Role-based access control (RBAC)
- [ ] HTTPS enforced everywhere
- [ ] Encryption at rest for sensitive data
- [ ] Secrets stored securely (no hardcoding)
- [ ] Secure session handling (expiry, invalidation)
- [ ] Rate limiting on API endpoints
- [ ] Input validation (server-side)
- [ ] Output encoding (XSS protection)
- [ ] Dependency vulnerability scanning
- [ ] Least privilege DB access
- [ ] Audit logging for sensitive actions
- [ ] Backup system in place
- [ ] Restore procedure tested
- [ ] Incident response process defined

### Evidence required
- [ ] Auth flow demo
- [ ] Security checklist completed
- [ ] Backup + restore test evidence
- [ ] Sample audit logs

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 2 — Privacy & GDPR

Owner: Data Protection Lead  

All must be GREEN:

- [ ] Data inventory completed
- [ ] Lawful basis defined
- [ ] Privacy policy written
- [ ] Data minimisation enforced
- [ ] Retention policy defined
- [ ] Data deletion implemented
- [ ] Subject access request process defined
- [ ] Access logging enabled
- [ ] Processor/controller role defined
- [ ] Data processing agreement ready

### Evidence required
- [ ] Privacy policy draft
- [ ] Data map
- [ ] SAR handling process
- [ ] Retention policy document

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 3 — NHS / DSPT Alignment

Owner: Security Lead  

All must be GREEN before NHS-facing pilot:

- [ ] DSPT applicability assessed
- [ ] Security lead assigned
- [ ] Data protection lead assigned
- [ ] Incident reporting pathway defined
- [ ] Supplier security pack drafted

### Evidence required
- [ ] DSPT assessment notes
- [ ] Security ownership defined
- [ ] Incident response document

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 4 — Clinical Safety

Owner: Clinical Safety Lead  

All must be GREEN:

- [ ] Clinical safety lead identified
- [ ] Hazard log created
- [ ] Safety case draft written
- [ ] High-risk scenarios identified
- [ ] Mitigations defined
- [ ] Human review enforced
- [ ] AI outputs clearly marked as draft

### Evidence required
- [ ] Hazard log
- [ ] Safety case draft
- [ ] Risk mitigation list

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 5 — Product Controls

Owner: Product Lead  

All must be GREEN:

- [ ] Every task requires human review
- [ ] No automatic submission or approval
- [ ] Status transitions are explicit
- [ ] All changes logged (audit trail)
- [ ] Notes persisted
- [ ] UI reflects backend truth
- [ ] No hidden automation

### Evidence required
- [ ] Workflow demo
- [ ] Audit logs visible
- [ ] Task lifecycle walkthrough

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 6 — Testing

Owner: Engineering Lead  

All must be GREEN:

- [ ] Unit tests implemented
- [ ] API integration tests
- [ ] Status transition tests
- [ ] Permission tests
- [ ] Audit logging tests
- [ ] Urgent scenarios tested
- [ ] Low-confidence handling tested
- [ ] Backup restore tested
- [ ] Manual QA checklist passed

### Evidence required
- [ ] Test reports
- [ ] QA checklist
- [ ] Scenario validation logs

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Gate 7 — Operational Readiness

Owner: Technical Lead  

All must be GREEN:

- [ ] Production logging enabled
- [ ] Monitoring and alerts configured
- [ ] Error tracking enabled
- [ ] On-call process defined
- [ ] Deployment process documented
- [ ] Rollback process defined
- [ ] Staging environment exists
- [ ] Production secured
- [ ] Support channel defined

### Evidence required
- [ ] Monitoring dashboard
- [ ] Incident runbook
- [ ] Deployment documentation

Status: 🔴 / 🟠 / 🟢 / 🟢+

---

## Pilot Constraints

Even if all gates are GREEN:

- Pilot must be limited to a controlled pharmacy environment
- Human review must be enforced at all times
- No automated clinical or dispensing decisions
- No automatic claim submission
- Active monitoring required during pilot
- Clear rollback capability must exist

---

## Final Decision

| Gate | Status |
|------|--------|
| Security | |
| Privacy | |
| NHS | |
| Clinical | |
| Product | |
| Testing | |
| Ops | |

### Decision:
- ❌ NOT APPROVED FOR PILOT
- ⚠️ LIMITED CONTROLLED PILOT ONLY
- ✅ APPROVED FOR UK PHARMACY PILOT
