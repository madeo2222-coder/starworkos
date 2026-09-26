# Sales MVP rebuild

This first rebuild turns each prospect into a safe, explicit next-work item.

| Situation | Owner | Result |
| --- | --- | --- |
| Company has not been researched | Researcher | Prepare company research |
| Research is complete, but no approval exists | Sales writer | Prepare the first outreach for human approval |
| A message was approved but not recorded as sent | Delivery operator | Wait for the human send record |
| Simple material / general question | Sales writer | Prepare a reply only |
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

Approval stores the authenticated reviewer ID and server timestamp. Both save and
approval re-read the authorized Task and condition the update on its ID, timestamp,
previous content and status. A stale form, zero affected rows or inaccessible row
produces a generic conflict notice. No service-role client or schema changes are used.
These operations describe intended roles; they do not dispatch an AI employee.

## Validation and remaining work

- 136 local Node tests, lint and production build (including TypeScript) pass.
- Live authenticated database writes and browser interaction remain unverified.
- Next: sent-message recording, replies and appointment flow; authorized integration
  tests with isolated data; actual research/delivery providers and their execution gates.
- The template has no model generation, researched company claims, prices or coverage promises.

Revert this PR to remove the UI and planning code. Existing sales Task records are
not deleted by a code rollback. No production migration or deployment is included.
