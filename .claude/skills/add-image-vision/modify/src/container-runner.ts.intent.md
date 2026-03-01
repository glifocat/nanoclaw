# Intent: src/container-runner.ts

## What Changed
- Added `imageAttachments?` optional field to `ContainerInput` interface
- Added `assistantName?` optional field to `ContainerInput` interface
- Uses `resolveGroupFolderPath` and `resolveGroupIpcPath` for path resolution
- Uses `TIMEZONE` for container env var
- Per-group agent-runner source caching in `data/sessions/{group}/agent-runner-src/`
- Per-group skills sync from both global and per-group skill directories
- Extended `readSecrets()` with Google OAuth and Vanta credentials

## Key Sections
- **ContainerInput interface**: imageAttachments and assistantName optional fields
- **buildVolumeMounts**: Main group gets read-only project root, group-specific agent-runner copies, per-group skills sync
- **readSecrets**: Extended allowlist for Google/Vanta MCP auth
- **buildContainerArgs**: Passes TZ env var to container

## Invariants (must-keep)
- ContainerOutput interface unchanged
- buildContainerArgs structure (run, -i, --rm, --name, mounts, image)
- runContainerAgent with streaming output parsing (OUTPUT_START/END markers)
- writeTasksSnapshot, writeGroupsSnapshot functions
- Additional mounts via validateAdditionalMounts
- Mount security validation against external allowlist
