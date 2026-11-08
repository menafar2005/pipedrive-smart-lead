import {
	getPipedriveDealById,
	updatePipedriveDealCustomField
} from "./pipedrive.js";

import {
	getInstallationSettings
} from "./appSetup.js";

import {
	parsePipedriveDateTime,
	toShamsiDateString
} from "./jalali.js";

function timingSafeEqualString(a, b) {
	const aBytes = new TextEncoder().encode(a || "");
	const bBytes = new TextEncoder().encode(b || "");

	if (aBytes.length !== bBytes.length) {
		return false;
	}

	let diff = 0;

	for (let i = 0; i < aBytes.length; i++) {
		diff |= aBytes[i] ^ bBytes[i];
	}

	return diff === 0;
}

function parseBasicAuth(request) {
	const authorization = request.headers.get("Authorization") || "";

	if (!authorization.startsWith("Basic ")) {
		return null;
	}

	const encoded = authorization.slice("Basic ".length);
	const decoded = atob(encoded);

	const separatorIndex = decoded.indexOf(":");

	if (separatorIndex === -1) {
		return null;
	}

	return {
		username: decoded.slice(0, separatorIndex),
		password: decoded.slice(separatorIndex + 1)
	};
}

function requireWebhookAuth(request, env) {
	const auth = parseBasicAuth(request);

	if (!auth) {
		throw new Response("Unauthorized", {
			status: 401
		});
	}

	const validUser = timingSafeEqualString(
		auth.username,
		env.PIPEDRIVE_WEBHOOK_AUTH_USER
	);

	const validPassword = timingSafeEqualString(
		auth.password,
		env.PIPEDRIVE_WEBHOOK_AUTH_PASSWORD
	);

	if (!validUser || !validPassword) {
		throw new Response("Unauthorized", {
			status: 401
		});
	}
}

function extractCompanyId(payload) {
	return Number(
		payload.company_id ||
		payload.companyId ||
		payload.meta?.company_id ||
		payload.meta?.companyId ||
		0
	);
}

function extractDealId(payload) {
	return Number(
		payload.data?.id ||
		payload.current?.id ||
		payload.object?.id ||
		payload.id ||
		0
	);
}

function extractEventAction(payload) {
	return String(
		payload.event_action ||
		payload.meta?.action ||
		payload.action ||
		""
	);
}

function extractEventObject(payload) {
	return String(
		payload.event_object ||
		payload.meta?.object ||
		payload.object ||
		""
	);
}

function getDealCreatedAtFromDeal(deal) {
	const data = deal?.data || deal;

	return (
		data.add_time ||
		data.addTime ||
		data.created_at ||
		data.createdAt ||
		null
	);
}

async function processDealCreatedWebhook(env, payload) {
	const companyId = extractCompanyId(payload);
	const dealId = extractDealId(payload);

	if (!companyId || !dealId) {
		return {
			ignored: true,
			reason: "Missing company_id or deal_id."
		};
	}

	const installationSettings = await getInstallationSettings(env, companyId);

	const dealResponse = await getPipedriveDealById(env, dealId, companyId);
	const createdAt = getDealCreatedAtFromDeal(dealResponse);

	const shamsiDate = toShamsiDateString(
		parsePipedriveDateTime(createdAt)
	);

	await updatePipedriveDealCustomField(
		env,
		dealId,
		installationSettings.shamsi_deal_field_key,
		shamsiDate,
		companyId
	);

	return {
		updated: true,
		companyId,
		dealId,
		shamsiDate
	};
}

export async function handlePipedriveWebhook(request, env) {
	requireWebhookAuth(request, env);

	let payload;

	try {
		payload = await request.json();
	} catch (error) {
		return Response.json({
			success: true,
			ignored: true,
			reason: "Invalid JSON payload."
		});
	}

	const action = extractEventAction(payload);
	const object = extractEventObject(payload);

	if (action && object && !(action === "create" && object === "deal")) {
		return Response.json({
			success: true,
			ignored: true,
			reason: `Ignored event ${action}.${object}.`
		});
	}

	try {
		const result = await processDealCreatedWebhook(env, payload);

		return Response.json({
			success: true,
			...result
		});
	} catch (error) {
		console.log("Webhook processing error:", error.message);

		return Response.json({
			success: true,
			warning: error.message
		});
	}
}