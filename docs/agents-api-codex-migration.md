# Agents API migration foundation

STAR WORK OS currently delegates coding jobs through the legacy GitHub @codex workflow. The E2E canary proved that Codex could implement and test work but could not publish its branch from the legacy sandbox because GitHub push was blocked.

The replacement design uses OpenAI's Agents API:

1. STAR WORK OS supplies a repository snapshot to an OpenAI-hosted sandbox.
2. The coding agent edits and tests the snapshot.
3. The agent publishes a machine-readable result artifact under /workspace/outputs.
4. STAR WORK OS validates that artifact.
5. STAR WORK OS creates the non-production GitHub branch and pull request server-side.
6. Human approval remains required before main merge, production deployment, production database migrations, secret changes, or destructive operations.

This foundation does not activate the new backend and does not change production environment variables or secrets. Activation requires a separately approved configuration change and an E2E canary.
