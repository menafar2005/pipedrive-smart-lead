import {
	getPipedriveDealFields,
	createPipedriveDealField,
	getPipedriveWebhooks,
	createPipedriveWebhook
} from "./pipedrive.js";

const SHAMSI_FIELD_NAME = "تاریخ شمسی";
const SHAMSI_FIELD_TYPE = "varchar";
const WEBHOOK_NAME = "Smart Assignment - Deal Created Shamsi Date";

function getBaseUrl(request) {
	const url = new URL(request.url);

	return `${url.protocol}//${url.host}`;
}

async function getStoredInstallationSettings(env, companyId) {
	return env.DB.prepare(`
		SELECT *
		FROM app_installation_settings
		WHERE company_id = ?
	`)
		.bind(Number(companyId))
		.first();
}

async function saveInstallationSettings(env, companyId, data) {
	const existing = await getStoredInstallationSettings(env, companyId);

	if (existing) {
		await env.DB.prepare(`
			UPDATE app_installation_settings
			SET shamsi_deal_field_id = ?,
				shamsi_deal_field_key = ?,
				deal_created_webhook_id = ?,
				webhook_auth_user = ?,
				webhook_auth_password = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE company_id = ?
		`)
			.bind(
				data.shamsiDealFieldId || existing.shamsi_deal_field_id,
				data.shamsiDealFieldKey || existing.shamsi_deal_field_key,
				data.dealCreatedWebhookId || existing.deal_created_webhook_id,
				data.webhookAuthUser || existing.webhook_auth_user,
				data.webhookAuthPassword || existing.webhook_auth_password,
				Number(companyId)
			)
			.run();

		return;
	}

	await env.DB.prepare(`
		INSERT INTO app_installation_settings (
			company_id,
			shamsi_deal_field_id,
			shamsi_deal_field_key,
			deal_created_webhook_id,
			webhook_auth_user,
			webhook_auth_password
		)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
		.bind(
			Number(companyId),
			data.shamsiDealFieldId || null,
			data.shamsiDealFieldKey || null,
			data.dealCreatedWebhookId || null,
			data.webhookAuthUser || null,
			data.webhookAuthPassword || null
		)
		.run();
}

async function ensureShamsiDealField(env, companyId) {
	const stored = await getStoredInstallationSettings(env, companyId);

	if (stored?.shamsi_deal_field_key) {
		return {
			id: stored.shamsi_deal_field_id,
			key: stored.shamsi_deal_field_key
		};
	}

	const fieldsResponse = await getPipedriveDealFields(env, companyId);
	const fields = Array.isArray(fieldsResponse.data) ? fieldsResponse.data : [];

	const existingField = fields.find(field => {
		return (
			field.name === SHAMSI_FIELD_NAME &&
			field.field_type === SHAMSI_FIELD_TYPE
		);
	});

	if (existingField) {
		await saveInstallationSettings(env, companyId, {
			shamsiDealFieldId: existingField.id,
			shamsiDealFieldKey: existingField.key
		});

		return {
			id: existingField.id,
			key: existingField.key
		};
	}

	const created = await createPipedriveDealField(
		env,
		companyId,
		SHAMSI_FIELD_NAME,
		SHAMSI_FIELD_TYPE
	);

	await saveInstallationSettings(env, companyId, {
		shamsiDealFieldId: created.data.id,
		shamsiDealFieldKey: created.data.key
	});

	return {
		id: created.data.id,
		key: created.data.key
	};
}

async function ensureDealCreatedWebhook(env, companyId, request) {
	const stored = await getStoredInstallationSettings(env, companyId);

	if (stored?.deal_created_webhook_id) {
		return {
			id: stored.deal_created_webhook_id
		};
	}

	const baseUrl = getBaseUrl(request);
	const subscriptionUrl = `${baseUrl}/webhooks/pipedrive`;

	const webhooksResponse = await getPipedriveWebhooks(env, companyId);
	const webhooks = Array.isArray(webhooksResponse.data) ? webhooksResponse.data : [];

	const existingWebhook = webhooks.find(webhook => {
		return (
			webhook.subscription_url === subscriptionUrl &&
			webhook.event_action === "create" &&
			webhook.event_object === "deal"
		);
	});

	if (existingWebhook) {
		await saveInstallationSettings(env, companyId, {
			dealCreatedWebhookId: existingWebhook.id,
			webhookAuthUser: env.PIPEDRIVE_WEBHOOK_AUTH_USER,
			webhookAuthPassword: env.PIPEDRIVE_WEBHOOK_AUTH_PASSWORD
		});

		return {
			id: existingWebhook.id
		};
	}

	const created = await createPipedriveWebhook(env, companyId, {
		subscription_url: subscriptionUrl,
		event_action: "create",
		event_object: "deal",
		name: WEBHOOK_NAME,
		version: "2.0",
		http_auth_user: env.PIPEDRIVE_WEBHOOK_AUTH_USER,
		http_auth_password: env.PIPEDRIVE_WEBHOOK_AUTH_PASSWORD
	});

	await saveInstallationSettings(env, companyId, {
		dealCreatedWebhookId: created.data.id,
		webhookAuthUser: env.PIPEDRIVE_WEBHOOK_AUTH_USER,
		webhookAuthPassword: env.PIPEDRIVE_WEBHOOK_AUTH_PASSWORD
	});

	return {
		id: created.data.id
	};
}

export async function setupInstalledCompany(env, companyId, request) {
	if (!env.PIPEDRIVE_WEBHOOK_AUTH_USER || !env.PIPEDRIVE_WEBHOOK_AUTH_PASSWORD) {
		throw new Error("Pipedrive webhook auth secrets are not configured.");
	}

	const shamsiField = await ensureShamsiDealField(env, companyId);
	const webhook = await ensureDealCreatedWebhook(env, companyId, request);

	return {
		shamsiField,
		webhook
	};
}

export async function getInstallationSettings(env, companyId) {
	const settings = await getStoredInstallationSettings(env, companyId);

	if (!settings?.shamsi_deal_field_key) {
		throw new Error("Shamsi deal field is not configured for this company.");
	}

	return settings;
}