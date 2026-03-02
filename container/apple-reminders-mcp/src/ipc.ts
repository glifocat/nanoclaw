/**
 * IPC helper for the container-side Apple Reminders MCP server.
 *
 * Writes task files into the shared IPC directory (tasks/) and polls the
 * results directory (reminders_results/) for the host-side handler's response.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
export const TASKS_DIR = path.join(IPC_DIR, 'tasks');
export const RESULTS_DIR = path.join(IPC_DIR, 'reminders_results');

export const POLL_INTERVAL = 200; // ms
export const POLL_TIMEOUT = 30_000; // ms

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpcResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique request ID for an IPC request.
 * Format: `rem-{action}-{timestamp}-{random6}`
 */
export function generateRequestId(action: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `rem-${action}-${ts}-${rand}`;
}

/**
 * Write a JSON task file into the IPC tasks directory.
 * Uses atomic write (tmp + rename) to avoid partial reads by the host watcher.
 */
export function writeIpcTask(
  requestId: string,
  data: Record<string, unknown>,
): void {
  fs.mkdirSync(TASKS_DIR, { recursive: true });

  const filePath = path.join(TASKS_DIR, `${requestId}.json`);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

/**
 * Poll the results directory for a response file matching the given request ID.
 * Returns the parsed result and cleans up the file.
 * Throws on timeout.
 */
export function waitForResult(
  requestId: string,
  pollInterval = POLL_INTERVAL,
  pollTimeout = POLL_TIMEOUT,
): Promise<IpcResult> {
  const resultPath = path.join(RESULTS_DIR, `${requestId}.json`);
  const deadline = Date.now() + pollTimeout;

  return new Promise<IpcResult>((resolve, reject) => {
    const check = () => {
      try {
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, 'utf-8');
          const result: IpcResult = JSON.parse(raw);

          // Clean up the result file
          try {
            fs.unlinkSync(resultPath);
          } catch {
            // best-effort cleanup
          }

          return resolve(result);
        }
      } catch {
        // File may be partially written — retry on next tick
      }

      if (Date.now() >= deadline) {
        return reject(
          new Error(
            `Timed out waiting for IPC result: ${requestId} (${pollTimeout}ms)`,
          ),
        );
      }

      setTimeout(check, pollInterval);
    };

    check();
  });
}

/**
 * Convenience wrapper: generate a request ID, write the IPC task file,
 * and wait for the host to produce a result.
 */
export async function callReminders(
  action: string,
  params: Record<string, unknown>,
): Promise<IpcResult> {
  const requestId = generateRequestId(action);

  writeIpcTask(requestId, {
    type: `reminders_${action}`,
    requestId,
    ...params,
  });

  return waitForResult(requestId);
}
