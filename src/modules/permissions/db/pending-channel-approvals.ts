/**
 * CRUD for pending_channel_approvals — the in-flight state for the
 * unknown-channel registration flow. A row exists while an owner-approval
 * card is outstanding; it's deleted on approve (after wiring is created)
 * or deny (after denied_at is set on the messaging_group).
 *
 * PRIMARY KEY on messaging_group_id gives free in-flight dedup. A second
 * mention/DM while a card is pending resolves via
 * `hasInFlightChannelApproval` in the request flow and drops silently
 * instead of spamming the owner.
 */
import { getDb } from '../../../db/connection.js';

export interface PendingChannelApproval {
  messaging_group_id: string;
  agent_group_id: string;
  original_message: string;
  approver_user_id: string;
  created_at: string;
  /** Card title shown at creation and re-used by getAskQuestionRender on click. */
  title: string;
  /** Original card body retained when the approval reaches a terminal state. */
  question: string;
  /** Normalized options (JSON-encoded NormalizedOption[]) — same shape persisted on pending_approvals. */
  options_json: string;
  provisioning_step:
    | 'idle'
    | 'awaiting_name'
    | 'awaiting_provider'
    | 'awaiting_model_query'
    | 'awaiting_model'
    | 'awaiting_confirmation';
  new_agent_name: string | null;
  selected_provider_id: string | null;
  selected_model_id: string | null;
}

export async function createPendingChannelApproval(
  row: Pick<
    PendingChannelApproval,
    | 'messaging_group_id'
    | 'agent_group_id'
    | 'original_message'
    | 'approver_user_id'
    | 'created_at'
    | 'title'
    | 'question'
    | 'options_json'
  >,
): Promise<void> {
  await getDb().run(
    `INSERT INTO pending_channel_approvals (
         messaging_group_id, agent_group_id, original_message,
         approver_user_id, created_at, title, question, options_json
       )
       VALUES (
         @messaging_group_id, @agent_group_id, @original_message,
         @approver_user_id, @created_at, @title, @question, @options_json
       )`,
    row,
  );
}

export async function getPendingChannelApproval(messagingGroupId: string): Promise<PendingChannelApproval | undefined> {
  return getDb().get<PendingChannelApproval>(
    'SELECT * FROM pending_channel_approvals WHERE messaging_group_id = ?',
    messagingGroupId,
  );
}

export async function hasInFlightChannelApproval(messagingGroupId: string): Promise<boolean> {
  const row = await getDb().get<{ x: number }>(
    'SELECT 1 AS x FROM pending_channel_approvals WHERE messaging_group_id = ?',
    messagingGroupId,
  );
  return row !== undefined;
}

export async function updatePendingChannelApprovalCard(
  messagingGroupId: string,
  title: string,
  question: string,
  optionsJson: string,
): Promise<void> {
  await getDb().run(
    'UPDATE pending_channel_approvals SET title = ?, question = ?, options_json = ? WHERE messaging_group_id = ?',
    title,
    question,
    optionsJson,
    messagingGroupId,
  );
}

export async function updatePendingChannelProvisioning(
  messagingGroupId: string,
  updates: Partial<
    Pick<PendingChannelApproval, 'provisioning_step' | 'new_agent_name' | 'selected_provider_id' | 'selected_model_id'>
  >,
): Promise<void> {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;
  const values: Record<string, unknown> = { messaging_group_id: messagingGroupId };
  const set = entries.map(([key, value]) => {
    values[key] = value;
    return `${key} = @${key}`;
  });
  await getDb().run(
    `UPDATE pending_channel_approvals SET ${set.join(', ')} WHERE messaging_group_id = @messaging_group_id`,
    values,
  );
}

/** Oldest restart-safe name or model-search prompt for this approver. */
export async function getPendingTextInputForApprover(
  approverUserId: string,
): Promise<PendingChannelApproval | undefined> {
  return getDb().get<PendingChannelApproval>(
    `SELECT * FROM pending_channel_approvals
        WHERE approver_user_id = ? AND provisioning_step IN ('awaiting_name', 'awaiting_model_query')
        ORDER BY created_at, messaging_group_id
        LIMIT 1`,
    approverUserId,
  );
}

export async function deletePendingChannelApproval(messagingGroupId: string): Promise<void> {
  await getDb().run('DELETE FROM pending_channel_approvals WHERE messaging_group_id = ?', messagingGroupId);
}
