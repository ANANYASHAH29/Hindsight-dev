// permissions.js - who may do what. We ask Jira, as the signed-in user, whether they are a site administrator.
import api, { route } from '@forge/api';
import { sendWithRetry, failWith } from './http.js';

// True if the current user is a Jira site administrator.
export async function isAdmin() {
  const res = await sendWithRetry(() => api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } }));
  if (!res.ok) await failWith(res, 'Checking your permissions');
  return Boolean((await res.json()).permissions?.ADMINISTER?.havePermission);
}

// Throws a friendly error unless the user is an administrator.
export async function requireAdmin(action = 'do that') {
  if (!(await isAdmin())) throw new Error(`Only Jira site administrators can ${action}.`);
}
