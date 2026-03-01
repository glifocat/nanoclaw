# icloud-tools: Dockerfile changes

Add build steps for the icloud-tools MCP server between the agent-runner build and workspace directory creation:

1. Copy icloud-tools package.json and install dependencies
2. Copy icloud-tools source and compile with TypeScript
3. Output at /opt/icloud-tools/

Insert after the agent-runner build steps (after `RUN cd /opt/agent-runner && npx tsc`).
