// visibility.js - "which assumptions may THIS person see?" Used by the dashboard, the release views and the Rovo agent.
// An assumption is visible only if the person can open the Confluence page it belongs to (checked AS THAT PERSON).
import api from '@forge/api';
import { getPageTitle } from './confluence.js';
import { listAllAssumptions } from './storage.js';

export async function visibleAssumptions(requester = api.asUser()) {
  const all = await listAllAssumptions();
  const pageIds = [...new Set(all.map((a) => a.pageId))];
  const titles = {};
  await Promise.all(pageIds.map(async (id) => {
    try {
      titles[id] = await getPageTitle(id, requester); // null = missing, or the person may not see it
    } catch (e) {
      titles[id] = '(title unavailable)'; // a temporary error must not hide the assumption
    }
  }));
  const visible = all.filter((a) => titles[a.pageId] !== null).map((a) => ({ ...a, pageTitle: titles[a.pageId] }));
  return { visible, hiddenCount: all.length - visible.length };
}
