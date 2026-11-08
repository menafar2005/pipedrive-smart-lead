import { externalApiFetch } from './externalApi.js';

async function getInstalledAccount(env, companyId = null) {
  if (companyId) {
    const row = await env.DB.prepare(`
      SELECT * FROM oauth_tokens
      WHERE company_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(Number(companyId)).first();
    if (!row) throw new Error('No OAuth token found for this Pipedrive company.');
    return row;
  }

  const row = await env.DB.prepare(`
    SELECT * FROM oauth_tokens
    ORDER BY id DESC
    LIMIT 1
  `).first();
  if (!row) throw new Error('No Pipedrive OAuth token found. Open /oauth/start first.');
  return row;
}

async function refreshAccessToken(env, account) {
  const basicAuth = btoa(`${env.PIPEDRIVE_CLIENT_ID}:${env.PIPEDRIVE_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token
  });

  const response = await externalApiFetch(env, 'pipedrive-oauth', account.company_id, 'https://oauth.pipedrive.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error('Failed to refresh Pipedrive token: ' + JSON.stringify(data));
  }

  const apiDomain = data.api_domain || account.api_domain || 'https://api.pipedrive.com';
  const expiresAt = Date.now() + data.expires_in * 1000;

  await env.DB.prepare(`
    UPDATE oauth_tokens
    SET access_token = ?, refresh_token = ?, api_domain = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.access_token,
    data.refresh_token || account.refresh_token,
    apiDomain,
    expiresAt,
    account.id
  ).run();

  return {
    ...account,
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    api_domain: apiDomain,
    expires_at: expiresAt
  };
}

async function getValidAccount(env, companyId = null) {
  let account = await getInstalledAccount(env, companyId);
  if (account.expires_at <= Date.now() + 60 * 1000) {
    account = await refreshAccessToken(env, account);
  }
  return account;
}

function getBaseHost(account) {
  return account.api_domain || 'https://api.pipedrive.com';
}

async function fetchPipedriveJson(env, account, path, init = {}) {
  const response = await externalApiFetch(
    env,
    'pipedrive',
    account.company_id,
    `${getBaseHost(account)}${path}`,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${account.access_token}`,
        ...(init.headers || {})
      }
    }
  );
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.error_info || `Pipedrive request failed (${response.status}).`);
  }
  return data;
}

export async function getPipedriveUsers(env, companyId = null) {
  const account = await getValidAccount(env, companyId);
  return fetchPipedriveJson(env, account, '/api/v1/users');
}

export async function getPipedriveCurrentUser(env, companyId = null) {
  const account = await getValidAccount(env, companyId);
  return fetchPipedriveJson(env, account, '/api/v1/users/me');
}

export async function getPipedriveDealsForOwner(env, ownerId, cursor = null, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const params = new URLSearchParams({
    owner_id: String(Number(ownerId)),
    limit: '100',
    sort_by: 'add_time',
    sort_direction: 'desc'
  });
  if (cursor) params.set('cursor', cursor);
  return fetchPipedriveJson(env, account, `/api/v2/deals?${params}`);
}

export async function getPipedriveDealById(env, dealId, companyId = null) {
  const account = await getValidAccount(env, companyId);
  return fetchPipedriveJson(env, account, `/api/v2/deals/${Number(dealId)}`);
}

export async function updatePipedriveDealOwner(env, dealId, ownerId, companyId = null) {
  const account = await getValidAccount(env, companyId);
  return fetchPipedriveJson(env, account, `/api/v2/deals/${Number(dealId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_id: Number(ownerId) })
  });
}




export async function getPipedriveDealFields(env, companyId = null) {
	const account = await getValidAccount(env, companyId);
	return fetchPipedriveJson(env, account, '/api/v1/dealFields');
}

export async function createPipedriveDealField(env, companyId, name, fieldType) {
	const account = await getValidAccount(env, companyId);

	return fetchPipedriveJson(env, account, '/api/v1/dealFields', {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			name,
			field_type: fieldType
		})
	});
}

export async function getPipedriveWebhooks(env, companyId = null) {
	const account = await getValidAccount(env, companyId);

	return fetchPipedriveJson(env, account, '/api/v1/webhooks');
}

export async function createPipedriveWebhook(env, companyId, payload) {
	const account = await getValidAccount(env, companyId);

	return fetchPipedriveJson(env, account, '/api/v1/webhooks', {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(payload)
	});
}

export async function updatePipedriveDealCustomField(env, dealId, fieldKey, value, companyId = null) {
	const account = await getValidAccount(env, companyId);

	return fetchPipedriveJson(env, account, `/api/v1/deals/${Number(dealId)}`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			[fieldKey]: value
		})
	});
}

export async function getPipedriveOrganizationAnalysisData(env, organizationId, companyId) {
  const account = await getValidAccount(env, companyId);
  const id = Number(organizationId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid Pipedrive organization ID.');

  const encodedId = encodeURIComponent(String(id));
  const includeFields = [
    'next_activity_id', 'last_activity_id', 'open_deals_count', 'closed_deals_count',
    'won_deals_count', 'lost_deals_count', 'people_count', 'activities_count',
    'done_activities_count', 'undone_activities_count', 'notes_count', 'files_count'
  ].join(',');

  const [organization, fields, deals, people, activities, notes] = await Promise.all([
    fetchPipedriveJson(env, account, `/api/v2/organizations/${encodedId}?include_fields=${includeFields}&include_labels=true&include_option_labels=true`),
    fetchPipedriveJson(env, account, '/api/v2/organizationFields?limit=500'),
    fetchPipedriveJson(env, account, `/api/v2/deals?org_id=${encodedId}&status=open,won,lost&limit=100&sort_by=update_time&sort_direction=desc&include_option_labels=true&include_labels=true`),
    fetchPipedriveJson(env, account, `/api/v2/persons?org_id=${encodedId}&limit=100&include_option_labels=true&include_labels=true`),
    fetchPipedriveJson(env, account, `/api/v2/activities?org_id=${encodedId}&limit=100&sort_by=due_date&sort_direction=desc`),
    fetchPipedriveJson(env, account, `/api/v1/notes?org_id=${encodedId}&limit=50&sort=update_time%20DESC`)
  ]);

  return {
    organization: organization.data,
    organizationFields: Array.isArray(fields.data) ? fields.data : [],
    deals: Array.isArray(deals.data) ? deals.data : [],
    people: Array.isArray(people.data) ? people.data : [],
    activities: Array.isArray(activities.data) ? activities.data : [],
    notes: Array.isArray(notes.data) ? notes.data : []
  };
}
