# RxDesk — Security Requirements

Version: 1.0  
Last Updated: [INSERT DATE]  
Owner: Technical Lead  

---

## 1. Authentication

- All non-public routes require authentication
- Passwords hashed (bcrypt or equivalent)
- Sessions must be:
  - time-limited
  - revocable
  - securely stored

---

## 2. Authorisation

- Role-based access control required:
  - admin
  - pharmacist
  - staff
- Restrict sensitive actions accordingly

---

## 3. Data Protection

Sensitive data includes:
- patient name
- DOB
- phone number
- medication details

Requirements:
- HTTPS enforced
- Encryption at rest
- No plaintext logging
- Mask data where possible

---

## 4. Input Security

- Server-side validation required
- Reject malformed input
- Prevent:
  - XSS
  - injection
  - invalid payloads

---

## 5. Output Security

- Escape all dynamic content
- Do not render raw HTML from input
- Prevent script injection

---

## 6. API Protection

- Rate limiting required
- Auth required for all sensitive endpoints
- Request validation enforced
- Suspicious activity logged

---

## 7. Secrets Management

- No secrets in frontend
- No secrets in repo
- Use environment variables
- Use secure storage if available

---

## 8. Logging & Audit

Must log:
- login attempts
- task updates
- status changes
- ingestion events
- failed access attempts

Logs must:
- include timestamp
- include actor
- be immutable

---

## 9. Backups

- Daily backups required
- Encrypted backups
- Restore tested regularly

---

## 10. Incident Response

Must define:
- severity levels
- response times
- containment steps
- communication plan

---

## 11. Dependencies

- Vulnerability scanning required
- No critical outdated packages
- Regular patching required

---

## Minimum Standard

RxDesk must meet:
- UK GDPR security principles
- Cyber Essentials baseline
