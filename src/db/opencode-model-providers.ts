import type { OpenCodeModelProvider } from '../types.js';
import { getDb } from './connection.js';

export async function getOpenCodeModelProvider(id: string): Promise<OpenCodeModelProvider | undefined> {
  return getDb().get<OpenCodeModelProvider>('SELECT * FROM opencode_model_providers WHERE id = ?', id);
}

export async function getEnabledOpenCodeModelProvider(id: string): Promise<OpenCodeModelProvider | undefined> {
  return getDb().get<OpenCodeModelProvider>('SELECT * FROM opencode_model_providers WHERE id = ? AND enabled = 1', id);
}

export async function listEnabledOpenCodeModelProviders(): Promise<OpenCodeModelProvider[]> {
  return getDb().all<OpenCodeModelProvider>(
    'SELECT * FROM opencode_model_providers WHERE enabled = 1 ORDER BY name, id',
  );
}
