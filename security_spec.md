# Security Specification — Bilili BD Festival 2026

## 1. Data Invariants
1. **Guest Integrity (`/guests/{guestId}`)**: Only verified administrators (`isAdmin()`) may read, create, update, or delete guest records containing passport numbers and attendance status. Every string and boolean field is strictly bounded and validated via `isValidGuest()`.
2. **Public Guest Showcase (`/guests_public/{guestId}`)**: Non-PII mirror containing zero passport numbers or private notes, readable in read-only mode by visitors (such as WhatsApp contacts), and writable/deletable strictly by verified administrators (`isAdmin()`).
3. **Host Schedule & Calendar Config (`/hosts/{hostId}`)**: Only `'jean-jacques'`, `'venicia'`, and `'joel'` are valid host IDs. Public users may read non-sensitive availability hours and blocked dates so they can pick valid slots; only verified administrators (`isAdmin()`) can modify host availability or Google Calendar bindings.
4. **Appointment Request Creation (`/appointments/{appointmentId}`)**: Any visitor may submit an appointment request, ONLY with `status == 'pending'`, empty admin decision fields (`proposedDate == ''`, `proposedTime == ''`, `adminComment == ''`, `reviewedBy == ''`, `calendarEvents.size() == 0`), server timestamps (`createdAt == request.time`, `updatedAt == request.time`), and atomic creation of `/appointment_status/{trackingCode}` via `existsAfter()`.
5. **PII Isolation (`/appointments` vs `/appointment_status`)**: Requester phone numbers, email addresses, and personal descriptions in `/appointments` are readable ONLY by verified administrators or the authenticated requester (`resource.data.requesterUid == request.auth.uid`). Public tracking by reference code uses `/appointment_status/{trackingCode}`, which contains zero PII.
6. **Mandatory Admin Validation**: Only verified administrators may transition an appointment from `'pending'` to `'confirmed'` or `'declined_or_reschedule'`, propose alternative slots, or attach Google Calendar event references.
7. **Notifications (`/notifications/{notificationId}`)**: New-request notifications (`type == 'new_request'`, `recipientRole == 'admin'`) are created atomically with the appointment request; only verified admins may read admin notifications, mark them as read, or create decision notifications for requesters.
8. **Admin Privilege Escalation Prevention (`/admins/{adminUid}`)**: Only the bootstrapped super-admin (`bernardulrich56@gmail.com` with `email_verified == true`) or existing super-admins can grant or revoke admin records. Users can never self-assign admin roles.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Auto-Confirmation Bypass**: Creating an appointment with `status: "confirmed"` -> **REJECTED** (`incoming().status == 'pending'` fails).
2. **Shadow Field Injection on Appointment**: Creating an appointment with an extra field `isVip: true` -> **REJECTED** (`keys().hasOnly(...)` fails).
3. **Oversized ID Poisoning**: Creating `/appointments/` with a 500-char ID or invalid chars `../admin` -> **REJECTED** (`isValidId()` fails).
4. **Timestamp Forgery**: Creating an appointment with backdated `createdAt` -> **REJECTED** (`createdAt == request.time` fails).
5. **Orphaned Appointment Without Status Mirror**: Creating `/appointments/{id}` without batching `/appointment_status/{trackingCode}` -> **REJECTED** (`existsAfter()` fails).
6. **Unauthorized PII Scraping**: Unauthenticated or non-admin user calling `list` or `get` on `/appointments` -> **REJECTED**.
7. **Non-Admin Guest Passport Read**: Unauthenticated user reading `/guests/{guestId}` -> **REJECTED**.
8. **Self-Privilege Escalation**: Non-admin user creating `/admins/{myUid}` with `role: "super_admin"` -> **REJECTED**.
9. **Spoofed Unverified Email Admin**: Token with `email: "bernardulrich56@gmail.com"` and `email_verified: false` -> **REJECTED**.
10. **Host Config Tampering**: Non-admin attempting to overwrite `/hosts/joel` Google Calendar ID -> **REJECTED**.
11. **Value Poisoning on Update**: Admin or user setting `durationMinutes: 99999` or `description` > 2000 chars -> **REJECTED** (`isValidAppointment()` fails).
12. **Immutable Field Mutation**: Updating `createdAt` or `trackingCode` on an existing appointment -> **REJECTED**.
