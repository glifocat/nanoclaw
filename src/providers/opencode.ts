/**
 * Host-side container config for the `opencode` provider.
 *
 * OpenCode's `opencode serve` process stores state under XDG_DATA_HOME, which
 * we pin to a per-session host directory mounted at /opencode-xdg. The
 * OPENCODE_* env vars tell the CLI which provider/model to use at runtime
 * (read on the host, injected into the container). NO_PROXY / no_proxy are
 * merged with host values so the in-container OpenCode client can talk to
 * 127.0.0.1 even when HTTPS_PROXY is set by OneCLI.
 */
import fs from 'fs';
import path from 'path';

import { registerProviderContainerConfig } from './provider-container-registry.js';

function mergeNoProxy(current: string | undefined, additions: string): string {
  if (!current?.trim()) return additions;
  const parts = new Set(
    current
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const addition of additions.split(',')) {
    const trimmed = addition.trim();
    if (trimmed) parts.add(trimmed);
  }
  return [...parts].join(',');
}

interface OpenCodeProviderSettings {
  modelProvider?: unknown;
  baseUrl?: unknown;
  smallModel?: unknown;
  contextLimit?: unknown;
  outputLimit?: unknown;
  inputModalities?: unknown;
}

/** Apply provisioned provider settings over service defaults. Invalid hand-edited values fail closed to unset. */
export function applyOpenCodeProviderSettings(
  env: Record<string, string>,
  settings: OpenCodeProviderSettings | undefined,
): void {
  if (!settings) return;

  const setString = (property: keyof OpenCodeProviderSettings, envKey: string) => {
    if (!(property in settings)) return;
    const value = settings[property];
    if (typeof value === 'string' && value.trim()) env[envKey] = value.trim();
    else delete env[envKey];
  };
  const setPositiveInteger = (property: keyof OpenCodeProviderSettings, envKey: string) => {
    if (!(property in settings)) return;
    const value = settings[property];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) env[envKey] = String(value);
    else delete env[envKey];
  };

  setString('modelProvider', 'OPENCODE_PROVIDER');
  setString('baseUrl', 'ANTHROPIC_BASE_URL');
  setString('smallModel', 'OPENCODE_SMALL_MODEL');
  setPositiveInteger('contextLimit', 'OPENCODE_MODEL_CONTEXT_LIMIT');
  setPositiveInteger('outputLimit', 'OPENCODE_MODEL_OUTPUT_LIMIT');
  setString('inputModalities', 'OPENCODE_MODEL_INPUT_MODALITIES');
}

registerProviderContainerConfig('opencode', (ctx) => {
  const opencodeDir = path.join(ctx.sessionDir, 'opencode-xdg');
  fs.mkdirSync(opencodeDir, { recursive: true });

  const env: Record<string, string> = {
    XDG_DATA_HOME: '/opencode-xdg',
    NO_PROXY: mergeNoProxy(ctx.hostEnv.NO_PROXY, '127.0.0.1,localhost'),
    no_proxy: mergeNoProxy(ctx.hostEnv.no_proxy, '127.0.0.1,localhost'),
  };
  for (const key of [
    'OPENCODE_PROVIDER',
    'OPENCODE_MODEL',
    'OPENCODE_SMALL_MODEL',
    'ANTHROPIC_BASE_URL',
    'OPENCODE_MODEL_CONTEXT_LIMIT',
    'OPENCODE_MODEL_OUTPUT_LIMIT',
    'OPENCODE_MODEL_INPUT_MODALITIES',
  ] as const) {
    const value = ctx.hostEnv[key];
    if (value) env[key] = value;
  }

  // Per-group overrides (G1, 2026-07-25). Keep the sidecar as a compatibility
  // fallback for existing Spark groups, but new provisioning snapshots into
  // container_configs.provider_settings and that typed DB surface wins.
  const readJson = (file: string): Record<string, unknown> | undefined => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  };
  if (ctx.model) env.OPENCODE_MODEL = ctx.model;
  const GROUP_ENV_ALLOWLIST = [
    'OPENCODE_PROVIDER',
    'OPENCODE_MODEL',
    'OPENCODE_SMALL_MODEL',
    'ANTHROPIC_BASE_URL',
    'OPENCODE_MODEL_CONTEXT_LIMIT',
    'OPENCODE_MODEL_OUTPUT_LIMIT',
    'OPENCODE_MODEL_INPUT_MODALITIES',
  ];
  const groupEnv = readJson(path.join(ctx.groupDir, 'provider-env.json'));
  for (const [key, value] of Object.entries(groupEnv ?? {})) {
    if (GROUP_ENV_ALLOWLIST.includes(key) && typeof value === 'string') {
      env[key] = value;
    }
  }

  const opencodeSettings = ctx.providerSettings.opencode;
  applyOpenCodeProviderSettings(
    env,
    typeof opencodeSettings === 'object' && opencodeSettings !== null
      ? (opencodeSettings as OpenCodeProviderSettings)
      : undefined,
  );

  return {
    mounts: [{ hostPath: opencodeDir, containerPath: '/opencode-xdg', readonly: false }],
    env,
  };
});
