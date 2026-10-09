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


## STAR WORK OS Connection Scope

Treat these as project identity constraints, not suggestions:

- Canonical application repository: `madeo2222-coder/starworkos`.
- Do not substitute `mfusumada-gif/ai-agent`; it is not the STAR WORK OS application repository.
- Vercel project: `starworkos`, project ID `prj_lIKvzJKYLfNwJuXn7QhB1Dvm5Amo`, under the Vercel account/team used by `madeo2222@gmail.com`.
- The STAR WORK OS Supabase project must be explicitly identified before any database operation. Its expected account/workspace is the one used by `starworkos.ai@gmail.com`, but the project ref is not yet verified in this environment.
- Never use STAR WARRANTY Supabase (`starwarranty-production`, ref `bahwiaotumowvspwpguz`) for STAR WORK OS.
- If a connector cannot see one of these resources, treat that as a connector/account-scope problem. Do not conclude that the resource does not exist and do not switch to another project's resource.
- A connection problem may block only the dependent step; continue safe repository work that does not require that connection.
