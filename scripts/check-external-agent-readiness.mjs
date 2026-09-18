import { externalAgentActivationReadiness } from "../lib/external-agent-activation.js";

const result = externalAgentActivationReadiness(process.env);

console.log(JSON.stringify({
  configured: result.configured,
  enabled: result.enabled,
  state: result.state,
  issues: result.issues,
}, null, 2));

if (!result.configured) {
  process.exitCode = 1;
}
