<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## STAR WORK OS Production Safety

When acting as an external coding agent for STAR WORK OS:

- Work only on a non-production branch unless a human explicitly instructs otherwise.
- Run the repository test, lint, and production-build checks before presenting work as ready.
- Do not merge to `main` without explicit human approval.
- Do not deploy to Production without explicit human approval.
- Do not apply Production database migrations without explicit human approval.
- Do not add, rotate, reveal, or change Production secrets or environment variables without explicit human approval.
- Do not perform destructive operations such as deleting data, projects, branches, environments, or integrations without explicit human approval.
- If a requested change requires any protected action above, stop after preparing the change and report that human approval is required.
- Prefer reviewable pull requests with a concise summary, test evidence, risks, and rollback notes.
