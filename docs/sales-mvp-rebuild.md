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

1. Register a prospect in an existing Task using the versioned sales content prefix.
2. Manually record research and sources, advancing NEW to PLANNING.
3. Edit the outreach subject, body and separate signature from a fixed template.
4. Save a draft, then review the persisted preview and explicitly approve it.
5. Remain at approved-but-unsent. Editing an unsent approved draft clears its approval.
6. After sending outside WORK OS, record email or LINE delivery with explicit confirmation.
7. Record one inbound email or LINE reply and route its next work by a bounded category.
8. For material requests and general questions, edit a fixed reply template, save it,
   review the persisted preview and explicitly approve it without sending.
9. After sending that approved reply outside WORK OS through the original channel,
   record the delivery with a second explicit confirmation.

Approval stores the authenticated reviewer ID and server timestamp. Both save and
approval re-read the authorized Task and condition the update on its ID, timestamp,
previous content and status. A stale form, zero affected rows or inaccessible row
produces a generic conflict notice. No service-role client or schema changes are used.
These operations describe intended roles; they do not dispatch an AI employee.
Delivery recording requires the stored approval audit, records the authenticated operator
and server time, and cannot be repeated. It never calls an external messaging service.
Reply intake stores the received text, channel, category, authenticated operator and server
time. Material requests, general questions and scheduling are preparation candidates only;
price, discount, contract, complaint, personal data, opt-out and unknown replies stop for
human review. An opt-out also becomes a sticky lead flag.
Reply-draft approval stores a separate authenticated reviewer audit. Editing the reply
draft clears that approval. Scheduling and every sensitive category are ineligible for
this transition. Reply delivery records the authenticated operator and server time,
inherits the received channel, and cannot be repeated. It does not call a mail or LINE API.

## Validation and remaining work

- 150 local Node tests pass; lint and production build (including TypeScript) are
  re-run for each reviewable milestone.
- Live authenticated database writes and browser interaction remain unverified.
- Next: appointment candidate and confirmation flow; authorized integration
  tests with isolated data; actual research/delivery providers and their execution gates.
- The template has no model generation, researched company claims, prices or coverage promises.

Revert this PR to remove the UI and planning code. Existing sales Task records are
not deleted by a code rollback. No production migration or deployment is included.
