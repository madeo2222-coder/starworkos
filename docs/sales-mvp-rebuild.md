# Sales MVP rebuild

This first rebuild turns each prospect into a safe, explicit next-work item.

| Situation | Owner | Result |
| --- | --- | --- |
| Company has not been researched | Researcher | Prepare company research |
| Research is complete, but no approval exists | Sales writer | Prepare the first outreach for human approval |
| A message was approved but not recorded as sent | Delivery operator | Wait for the human send record |
| Simple material / general question | Sales writer | Prepare and review a reply; keep it unsent |
| Scheduling response | Scheduler | Prepare meeting options only |
| Price, contract, complaint, personal data, opt-out or unknown | Sales manager | Stop for human review |
| No reply after three days | Sales writer | Prepare at most two follow-ups |

## Safety boundary

The planner is pure code. It does not send email or LINE, create a calendar event,
invoke an external AI, write to the database, or mark work as delivered. `deliveryAllowed`
is always `false`; external delivery remains a separately reviewed capability.

## Current operator flow

The authenticated `/sales` page now supports:

1. Register one prospect, or paste up to 50 four-column Excel rows into existing Tasks
   after all-or-nothing validation and duplicate detection.
2. Edit company name, website, contact and proposal fit before the first delivery.
3. Manually record research with one to five HTTPS sources, advancing NEW to PLANNING.
4. Edit the outreach subject, body and separate signature from a fixed template.
5. Save a draft, then review the persisted preview and explicitly approve it.
6. Remain at approved-but-unsent. Editing an unsent approved draft clears its approval.
7. If the approved lead has exactly one validated email recipient, download an unsent
   `.eml` draft. After sending outside WORK OS, record email or LINE delivery with explicit confirmation.
8. Record one inbound email or LINE reply and route its next work by a bounded category.
9. For material requests and general questions, edit a fixed reply template, save it,
   review the persisted preview and explicitly approve it without sending.
10. After sending that approved reply outside WORK OS through the original channel,
   record the delivery with a second explicit confirmation.
11. For a scheduling reply, save two or three Japan-time meeting candidates,
    review the persisted options and explicitly approve them without sending.
12. After sending approved candidates outside WORK OS through the original channel,
    record the delivery and wait for the prospect to select a candidate.
13. Select the prospect-chosen candidate, add a required HTTPS web-meeting URL and
    explicitly confirm the appointment without creating a calendar event or invitation.
14. Review the deterministic appointment confirmation notice, explicitly approve it,
    then download an unsent `.eml` for email or copy the approved text for LINE. After
    sending outside WORK OS, record delivery through the original scheduling channel.
15. During the final 24 hours before the meeting, prepare a deterministic reminder,
    review and approve it, then export an unsent `.eml` or copy it to LINE. Record
    delivery manually; earlier, duplicate and post-start attempts are rejected.
16. Download a standalone `.ics` file for manual calendar import without adding an
    organizer, attendees or any automatic invitation behavior.
17. After the scheduled meeting ends, record next action, won, lost or no-show with
    required meeting notes; unrecorded outcomes return to the priority queue.
18. For a next-action outcome, set the human owner and due date, then record completion.
19. Download a bounded CSV snapshot of the visible sales pipeline for spreadsheet review.
    Oversized reply/follow-up histories, reversed chronology and planner-invalid
    records are omitted instead of being displayed as routine work.
20. Review a read-only registration-to-appointment funnel, appointment outcomes,
    win rate, unrecorded results and overdue post-meeting follow-ups.
21. Open a company-specific A4 proposal preview and print or save it as PDF locally.

Approval stores the authenticated reviewer ID and server timestamp. Both save and
approval re-read the authorized Task and condition the update on its ID, timestamp,
previous content and status. A stale form, zero affected rows or inaccessible row
produces a generic conflict notice. No service-role client or schema changes are used.
These operations describe intended roles; they do not dispatch an AI employee.
Research completion stores canonical HTTPS source URLs, the authenticated operator ID
and server timestamp. Unsafe, duplicate or malformed sources and altered audit data fail
closed, including removal of the audit from a current-version record. Existing researched
records without this newer version and audit field remain readable. Records that have not
completed research cannot claim research notes or carry a saved first-outreach draft,
and an audited research completion must precede first-outreach approval.
Delivery recording requires the stored approval audit, records the authenticated operator
and server time, and cannot be repeated. The read-only audit timeline retains the initial
outreach approver and approval time. It never calls an external messaging service.
The `.eml` route re-authenticates, reads one RLS-visible Task and exports only an
approved, unsent first outreach with one validated recipient. It never sends or records delivery.
Reply intake stores the received text, channel, category, authenticated operator and server
time. Material requests, general questions and scheduling are preparation candidates only;
price, discount, contract, complaint, personal data, opt-out and unknown replies stop for
human review. An opt-out also becomes a sticky lead flag.
Reply-draft approval stores a separate authenticated reviewer audit. Editing the reply
draft clears that approval. Scheduling and every sensitive category are ineligible for
this transition, and stored drafts attached to those categories fail closed. Reply
delivery records the authenticated operator and server time,
inherits the received channel, and cannot be repeated. It does not call a mail or LINE API.
Archived reply audits fail closed when their reply type, delivery channel,
reply/draft/approval/delivery chronology, or delivered meeting-option lead time
is inconsistent. Parsed reply and follow-up histories are exposed as deeply frozen
read-only snapshots so downstream queue and audit views cannot mutate validated history.
Meeting candidates are limited to 30, 45 or 60 minutes and a window from 30 minutes
to 180 days after preparation. Editing clears approval. Approval does not send the
options, create a calendar event or confirm an appointment.
Candidate delivery records the authenticated operator, server time and original reply
channel. Unapproved, duplicate or nearly expired candidate deliveries are rejected.
Appointment confirmation accepts only a previously sent candidate, requires a valid
HTTPS URL, records the authenticated operator and server time, and rejects duplicate,
forged or last-minute confirmation data. Confirmed appointments remain visible in a
read-only list.
Appointment confirmation also stores a deterministic confirmation notice bound to the
persisted company name, selected Japan-time slot, duration, meeting URL and approved
initial signature. A separate authenticated approval is required before email export or
LINE copy. Email export requires exactly one recipient and returns an unsent `.eml` only.
Delivery recording uses the original scheduling channel, requires explicit confirmation,
and rejects duplicate or post-start records. No mail, LINE or calendar API is called.
The appointment reminder becomes eligible only after the confirmation notice has been
recorded and the meeting is within 24 hours. Its deterministic copy is bound to the same
persisted company, Japan-time slot, duration, meeting URL and approved signature. Approval,
unsent email export or LINE copy, and the external-delivery audit remain separate human
steps. Early, altered, duplicate and post-start states fail closed.
Appointment outcomes require an already confirmed and completed meeting plus the prior
candidate-delivery audit. The transition records a bounded category, required notes,
authenticated operator and server timestamp exactly once. Early, duplicate, suppressed
or chronologically altered records fail closed. It does not send follow-up messages,
change a calendar or call an AI provider.
The CSV route re-authenticates the user, relies on the existing Task RLS, reads at most
100 leads, and returns a no-store download. It excludes contacts, message bodies,
research and meeting notes, appointment URLs, and actor identifiers. Every spreadsheet
cell is quoted and formula-like values are neutralized.
The funnel uses only the same authorized, parsed lead snapshot. It reports reply and
appointment conversion against recorded initial deliveries and displays an unavailable
rate rather than a misleading zero percent when no delivery denominator exists.
The outcome summary additionally validates appointment completion and audit chronology
before counting won, lost, no-show or next-action results. Its win rate uses only won and
lost decisions; it does not treat no-shows or still-open next actions as losses. Completed
appointments without a result and overdue, incomplete post-meeting work are surfaced for
human action. Malformed, duplicate or chronologically inconsistent records are excluded.
When an inbound reply arrives while an unsent follow-up is pending, the stale draft and
approval are revoked before the reply is stored. A final opt-out instead preserves the
pre-existing follow-up approval audit while permanently suppressing further contact.
Contact-history metrics reject more than two follow-ups, follow-ups before the initial
delivery, replies before the last follow-up, and stored events in reverse chronological
order. Invalid leads are excluded from both funnel numerators and denominators; history
is never sorted or truncated to make it appear valid.
Opt-out metrics require exactly one final OPT_OUT reply consistent with the boolean
flag. Missing evidence, duplicate stops, post-stop replies, and unsupported reply
categories exclude the lead from all funnel counts. The explicit UNKNOWN category
remains valid. Ordinary replies remain capped at eight, while one ninth final OPT_OUT
is accepted so contact suppression cannot be lost at capacity. Queue, CSV and audit
views preserve that stop without truncating the preceding history.
Operational planning and CSV export inspect that final OPT_OUT evidence directly, so a
delayed denormalized flag can never make an explicit stop request contactable.
Planning checks the same evidence before appointment notice, reminder and outcome work,
so a confirmed appointment cannot hide a newly recorded stop request during that lag.
At eight ordinary replies, the inbound-reply form remains visible but offers only
OPT_OUT; after that final stop is stored, the form is removed.
While the latest ordinary reply still awaits its required human response or delivery
record, the same form also offers only OPT_OUT. Normal reply categories return after
that response is recorded, matching the server-side transition guard.
The reply form defaults to the latest recorded conversation channel, falling back to
the initial delivery channel, so an email-to-LINE handoff is not silently reset.
The bulk importer accepts exactly four tab-separated columns, validates every row with the
same record rules, normalizes company names for duplicate detection, and rejects the whole
batch on any invalid or duplicate entry. The Server Action re-authenticates, reads at most
500 RLS-visible existing leads, and writes the validated batch in one insert request.
Single registration uses the same normalized company-name comparison before insert and
returns only bounded operator notices for invalid, duplicate, or failed writes.
Profile editing re-authenticates, relies on existing Task RLS and uses the stored update
timestamp, content and status as optimistic concurrency guards. It is blocked after the
first delivery, preserves research and saved drafts, revokes stale outreach approval, and
checks normalized company-name duplicates before updating the Task title and record.
The A4 proposal view re-authenticates, reads one RLS-visible Task and exposes only the
company name and proposal rationale. Contacts and research notes stay internal. Its fixed
copy does not promise pricing, coverage, duration or contract terms, and the browser-only
print action performs no upload, external communication or database write.

## Validation and remaining work

- Recovery checkpoint: this branch was restored from `9223d05`, then the queue/CSV
  history guards and funnel chronology guards were rebuilt. The formerly reported
  `fdf4dfb` state (42 commits above the sales MVP base) has not been fully recovered.
  Passing tests describe this restored branch, not the lost branch's full coverage.
- Remote reflection remains paused. Vercel project existence was confirmed by the
  user; the latest connector detail read failed with `INVALID_ARGUMENT` because
  its exposed `projectId` argument did not satisfy the internal `idOrName` field.
  This is not proof of missing permissions. Quota recovery remains unverified.
- 286 local Node tests pass; lint and production build (including TypeScript) are
  re-run for each reviewable milestone.
- Live authenticated database writes and browser interaction remain unverified.
- Next: authorized integration tests with isolated data; actual research/delivery
  providers, calendar synchronization and their execution gates.
- The template has no model generation, researched company claims, prices or coverage promises.

Revert this PR to remove the UI and planning code. Existing sales Task records are
not deleted by a code rollback. No production migration or deployment is included.
