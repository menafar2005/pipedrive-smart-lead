import { getPipedriveDealsForOwner, updatePipedriveDealOwner, getPipedriveDealById } from './pipedrive.js';

async function getInstalledAccount(env, companyId) {
	const row = await env.DB.prepare(
		`
    SELECT * FROM oauth_tokens
    WHERE company_id = ?
    ORDER BY id DESC
    LIMIT 1
  `,
	)
		.bind(Number(companyId))
		.first();

	if (!row) {
		throw new Error('No Pipedrive OAuth token found for this company.');
	}

	return row;
}

async function getActiveCapacities(env, companyId) {
	const result = await env.DB.prepare(
		`
    SELECT
      pipedrive_user_id,
      user_name,
      daily_capacity,
      sort_order,
      paused_until_date
    FROM user_capacities
    WHERE company_id = ?
    AND active = 1
    AND daily_capacity > 0
    ORDER BY sort_order ASC, user_name ASC
  `,
	)
		.bind(companyId)
		.all();

	return result.results || [];
}

function getTodayStartLocalIso() {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	return start.toISOString();
}

function getTodayLocalDate() {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function isPausedToday(row, todayDate) {
	return String(row.paused_until_date || '') === todayDate;
}

function getDealAddTime(deal) {
	return deal.add_time || deal.addTime || null;
}

function getDealOwnerId(deal) {
	const ownerId = deal.owner_id || deal.ownerId || (deal.owner && deal.owner.id) || null;
	return ownerId ? Number(ownerId) : null;
}

function isCreatedToday(deal, todayStartIso) {
	const addTime = getDealAddTime(deal);

	if (!addTime) {
		return false;
	}

	return new Date(addTime).getTime() >= new Date(todayStartIso).getTime();
}

async function countTodayDealsForUser(env, userId, todayStartIso, companyId) {
	let count = 0;
	let cursor = null;
	let shouldContinue = true;
	const checkedDeals = [];

	while (shouldContinue) {
		const response = await getPipedriveDealsForOwner(env, userId, cursor, companyId);
		const deals = Array.isArray(response.data) ? response.data : [];

		for (const deal of deals) {
			const dealOwnerId = getDealOwnerId(deal);
			const createdToday = isCreatedToday(deal, todayStartIso);
			const counted = createdToday && dealOwnerId === Number(userId);

			checkedDeals.push({
				id: deal.id,
				title: deal.title,
				owner_id: dealOwnerId,
				add_time: getDealAddTime(deal),
				counted,
			});

			if (!createdToday) {
				shouldContinue = false;
				continue;
			}

			if (counted) {
				count++;
			}
		}

		const nextCursor = response.additional_data && response.additional_data.pagination && response.additional_data.pagination.next_cursor;

		if (!nextCursor || deals.length === 0) {
			shouldContinue = false;
		}

		cursor = nextCursor;
	}

	return {
		count,
		checkedDeals,
	};
}

async function getLastAssignedUserId(env, companyId) {
	const row = await env.DB.prepare(
		`
    SELECT last_assigned_user_id
    FROM assignment_state
    WHERE company_id = ?
  `,
	)
		.bind(companyId)
		.first();

	return row ? Number(row.last_assigned_user_id) : null;
}

async function updateLastAssignedUserId(env, companyId, userId) {
	await env.DB.prepare(
		`
    INSERT INTO assignment_state (company_id, last_assigned_user_id, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id)
    DO UPDATE SET
      last_assigned_user_id = excluded.last_assigned_user_id,
      updated_at = CURRENT_TIMESTAMP
  `,
	)
		.bind(companyId, Number(userId))
		.run();
}

function buildRoundRobinCandidates(capacityRows, todayCounts, todayDate) {
	return capacityRows.map((row) => {
		const userId = Number(row.pipedrive_user_id);
		const assignedToday = todayCounts[userId] || 0;
		const dailyCapacity = Number(row.daily_capacity);
		const remaining = dailyCapacity - assignedToday;
		const pausedToday = isPausedToday(row, todayDate);

		return {
			user_id: userId,
			user_name: row.user_name,
			daily_capacity: dailyCapacity,
			assigned_today: assignedToday,
			remaining,
			paused_today: pausedToday,
			paused_until_date: row.paused_until_date || null,
			eligible_today: !pausedToday && remaining > 0,
			status: pausedToday ? 'paused' : remaining <= 0 ? 'full' : 'available',
			sort_order: Number(row.sort_order || 0),
		};
	});
}

function chooseRoundRobinAssignee(capacityRows, todayCounts, lastAssignedUserId, todayDate) {
	const candidates = buildRoundRobinCandidates(capacityRows, todayCounts, todayDate);

	if (candidates.filter((item) => item.eligible_today).length === 0) {
		return {
			assignee: null,
			candidates,
		};
	}

	const orderedUserIds = candidates.map((item) => item.user_id);
	let startIndex = 0;

	if (lastAssignedUserId) {
		const lastIndex = orderedUserIds.indexOf(Number(lastAssignedUserId));

		if (lastIndex >= 0) {
			startIndex = (lastIndex + 1) % orderedUserIds.length;
		}
	}

	for (let offset = 0; offset < candidates.length; offset++) {
		const index = (startIndex + offset) % candidates.length;
		const candidate = candidates[index];

		if (candidate.eligible_today) {
			return {
				assignee: candidate,
				candidates,
			};
		}
	}

	return {
		assignee: null,
		candidates,
	};
}

async function logAssignment(env, companyId, dealId, assignee, score) {
	await env.DB.prepare(
		`
    INSERT INTO assignment_logs (company_id, deal_id, assigned_user_id, assigned_user_name, score)
    VALUES (?, ?, ?, ?, ?)
  `,
	)
		.bind(companyId, Number(dealId), assignee.user_id, assignee.user_name || '', Number(score || 0))
		.run();
}

async function getLatestAssignments(env, companyId) {
	const result = await env.DB.prepare(
		`
    SELECT deal_id, assigned_user_id, assigned_user_name, score, created_at
    FROM assignment_logs
    WHERE company_id = ?
    ORDER BY id DESC
    LIMIT 10
  `,
	)
		.bind(companyId)
		.all();

	return result.results || [];
}

export async function buildAssignmentSummary(env, authContext) {
	const account = await getInstalledAccount(env, authContext.companyId);
	const capacities = await getActiveCapacities(env, account.company_id);
	const todayStartIso = getTodayStartLocalIso();
	const todayDate = getTodayLocalDate();
	const todayCounts = {};

	for (const row of capacities) {
		const userId = Number(row.pipedrive_user_id);
		const result = await countTodayDealsForUser(env, userId, todayStartIso, account.company_id);
		todayCounts[userId] = result.count;
	}

	const lastAssignedUserId = await getLastAssignedUserId(env, account.company_id);
	const latestAssignments = await getLatestAssignments(env, account.company_id);
	const choice = chooseRoundRobinAssignee(capacities, todayCounts, lastAssignedUserId, todayDate);
	const users = choice.candidates;

	const totalAssignedToday = users.reduce((sum, user) => sum + Number(user.assigned_today || 0), 0);
	const totalRemaining = users
		.filter((user) => !user.paused_today)
		.reduce((sum, user) => sum + Math.max(0, Number(user.remaining || 0)), 0);
	const fullUsers = users.filter((user) => user.status === 'full');
	const pausedUsers = users.filter((user) => user.status === 'paused');

	return {
		success: true,
		company_id: account.company_id,
		company_name: account.company_name,
		today_start_iso: todayStartIso,
		today_date: todayDate,
		total_assigned_today: totalAssignedToday,
		total_remaining: totalRemaining,
		full_users: fullUsers,
		paused_users: pausedUsers,
		last_assigned_user_id: lastAssignedUserId,
		next_available_user: choice.assignee
			? {
					id: choice.assignee.user_id,
					name: choice.assignee.user_name,
				}
			: null,
		users,
		latest_assignments: latestAssignments,
	};
}

export async function getAssignmentSummary(env, authContext) {
	return Response.json(await buildAssignmentSummary(env, authContext));
}

export async function assignDealCore({ env, dealId, score, authContext }) {
	if (!authContext || !authContext.companyId || !authContext.userId) {
		return {
			success: false,
			assigned: false,
			message: 'Unauthorized assignment request.',
		};
	}

	if (!dealId) {
		return {
			success: false,
			assigned: false,
			message: 'deal_id is required.',
		};
	}

	const account = await getInstalledAccount(env, authContext.companyId);

	try {
		await getPipedriveDealById(env, dealId, authContext.companyId);
	} catch (error) {
		return {
			success: false,
			assigned: false,
			message: 'Deal does not belong to this Pipedrive company or is not accessible.',
		};
	}

	const capacities = await getActiveCapacities(env, account.company_id);

	if (capacities.length === 0) {
		return {
			success: true,
			assigned: false,
			message: 'No user capacity is configured.',
		};
	}

	const todayStartIso = getTodayStartLocalIso();
	const todayDate = getTodayLocalDate();
	const todayCounts = {};
	const debugCounts = {};

	for (const row of capacities) {
		const userId = Number(row.pipedrive_user_id);
		const result = await countTodayDealsForUser(env, userId, todayStartIso, account.company_id);

		todayCounts[userId] = result.count;

		debugCounts[userId] = {
			user_name: row.user_name,
			daily_capacity: Number(row.daily_capacity),
			paused_today: isPausedToday(row, todayDate),
			paused_until_date: row.paused_until_date || null,
			counted_today: result.count,
			remaining: Number(row.daily_capacity) - result.count,
			checked_deals: result.checkedDeals,
		};
	}

	const lastAssignedUserId = await getLastAssignedUserId(env, account.company_id);
	const choice = chooseRoundRobinAssignee(capacities, todayCounts, lastAssignedUserId, todayDate);
	const assignee = choice.assignee;

	if (!assignee) {
		return {
			success: true,
			assigned: false,
			message: 'All available users are paused or have reached their daily capacity. Deal was not assigned.',
			today_counts: todayCounts,
			candidates: choice.candidates,
			last_assigned_user_id: lastAssignedUserId,
			debug_counts: debugCounts,
		};
	}

	const updateResponse = await updatePipedriveDealOwner(env, dealId, assignee.user_id, authContext.companyId);

	const updatedOwnerId = updateResponse && updateResponse.data && Number(updateResponse.data.owner_id);

	if (updatedOwnerId !== Number(assignee.user_id)) {
		return {
			success: false,
			assigned: false,
			message: 'Pipedrive returned success, but deal owner was not changed.',
			expected_owner_id: Number(assignee.user_id),
			actual_owner_id: updatedOwnerId,
			pipedrive_response: updateResponse,
			debug_counts: debugCounts,
		};
	}

	await logAssignment(env, account.company_id, dealId, assignee, score);
	await updateLastAssignedUserId(env, account.company_id, assignee.user_id);

	return {
		success: true,
		assigned: true,
		assigned_user: {
			id: assignee.user_id,
			name: assignee.user_name,
		},
		score,
		today_counts: todayCounts,
		candidates: choice.candidates,
		last_assigned_user_id: lastAssignedUserId,
		next_round_robin_user_id: assignee.user_id,
		pipedrive_response: updateResponse,
		debug_counts: debugCounts,
		message: 'Deal assigned successfully.',
	};
}

export async function assignDeal(request, env, authContext) {
	const body = await request.json();

	const result = await assignDealCore({
		env,
		dealId: Number(body.deal_id),
		score: Number(body.score || 0),
		authContext,
	});

	return Response.json(result, {
		status: result.success ? 200 : 400,
	});
}
