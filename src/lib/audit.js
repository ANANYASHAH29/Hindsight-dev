// audit.js - a simple, capped audit log: who added/changed an assumption, and what tripped, and when.
// Stored under ONE key as a list (newest first). We keep only the latest MAX entries to stay small.
import { kvs } from '@forge/kvs';

const KEY = 'audit:log';
const MAX = 200;

// type: 'added' | 'deleted' | 'tripped' | 'recovered' | 'ticket-created' | 'comment-added' | 'settings'
// actor: an accountId, or 'scheduler' / 'app'.
export async function addAudit({ type, actor, assumptionId = null, text = '', detail = '' }) {
  try {
    const log = (await kvs.get(KEY)) || [];
    log.unshift({
      at: new Date().toISOString(),
      type,
      actor: actor || 'app',
      assumptionId,
      text: String(text).slice(0, 200),
      detail: String(detail).slice(0, 300),
    });
    await kvs.set(KEY, log.slice(0, MAX));
  } catch (e) {
    // The audit log must never break the real action, so we only report the problem.
    console.error('Audit log write failed:', e.message);
  }
}

export async function listAudit(limit = 100) {
  return ((await kvs.get(KEY)) || []).slice(0, limit);
}
