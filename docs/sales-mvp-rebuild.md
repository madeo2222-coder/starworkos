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
