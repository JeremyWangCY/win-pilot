# Install Win-Pilot with an Agent

Install Win-Pilot on the user's Windows machine; do not merely describe the commands.

1. Confirm Windows and Node.js 22.12 or newer with `node --version`.
2. Prefer the host's Agent Plugin installer and install `JeremyWangCY/win-pilot`. The plugin contains both `.mcp.json` and `skills/win-pilot`.
3. If the host does not support Agent Plugins, install the runtime with `npm install -g github:JeremyWangCY/win-pilot#v0.1.0`.
4. For a local stdio MCP host, register a server named `win-pilot` with command `win-pilot` and argument `mcp`, then install the bundled skill with `win-pilot install --agent mcp --json`.
5. For a shell-capable host without MCP, run `win-pilot install --agent cli --json`; use the installed skill and `win-pilot request`.
6. Native convenience adapters are available through `win-pilot install --agent codex|claude|qoder|pi|dsh`.
7. Verify with `win-pilot --version` and `win-pilot doctor --probe --json`.
8. Start a new Agent session and ask: “Use Win-Pilot to list visible Windows applications. Do not click or type.”

If the Agent reaps child processes after every command, its persistent plugin/MCP supervisor must own `win-pilot mcp`. Do not use detached shell tricks to outlive the sandbox. Preserve the host's approval, sandbox, and task-authorization policy.
