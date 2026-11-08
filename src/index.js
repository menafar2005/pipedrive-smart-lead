import { oauthStart, oauthCallback } from './oauth.js';
import { getPipedriveUsers } from './pipedrive.js';
import { getSettingsPage, getCapacities, saveCapacities } from './settings.js';
import { assignDeal, getAssignmentSummary } from './assignment.js';
import { handleJsonLeadScoringModal, getCustomLeadScoringPage } from './leadScoring.js';
import { getSidebarPage } from './sidebar.js';
import { getBitcoinJsonPanel } from './bitcoinPanel.js';
import { getCompanySalesAnalysisPage, handleCompanySalesAnalysis } from './companyAnalysis.js';
import { getSdkLabPage } from './sdkLab.js';
import { requirePipedriveAuth, enforceRateLimit, logRequest } from './auth.js';
import { logFrontendApiCall } from './externalApi.js';
import {
  handlePipedriveWebhook
} from "./webhooks.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestCompanyId = Number(url.searchParams.get('companyId')) || 0;
    const logging = logRequest(env, request, requestCompanyId).catch(error => {
      console.error('Could not log request:', error.message);
    });
    if (ctx?.waitUntil) ctx.waitUntil(logging);
    else await logging;

    try {
      if (url.pathname === '/oauth/start') {
        	return oauthStart(env, request);
      }

      if (url.pathname === '/oauth/callback') {
        return oauthCallback(request, env);
      }

      if (url.pathname === '/settings') {
        await requirePipedriveAuth(request, env);
        return getSettingsPage();
      }

      if (url.pathname === '/custom-lead-scoring') {
        await requirePipedriveAuth(request, env);
        return getCustomLeadScoringPage(request);
      }

      if (url.pathname === '/sidebar') {
        await requirePipedriveAuth(request, env);
        return getSidebarPage();
      }

      if (url.pathname === '/company-sales-analysis' && request.method === 'GET') {
        const authContext = await requirePipedriveAuth(request, env);
        return getCompanySalesAnalysisPage(request, authContext);
      }

      if (url.pathname === '/sdk-lab' && request.method === 'GET') {
        await requirePipedriveAuth(request, env);
        return getSdkLabPage();
      }

      if (url.pathname === '/json-lead-scoring') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'json-lead-scoring', request);
        return handleJsonLeadScoringModal(request, env, authContext);
      }

      if (url.pathname === '/bitcoin-panel') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'bitcoin-panel', request);
        return getBitcoinJsonPanel(env);
      }

      if (url.pathname === '/api/users') {
        const authContext = await requirePipedriveAuth(request, env);
        const result = await getPipedriveUsers(env, authContext.companyId);
        return Response.json(result);
      }

      if (url.pathname === '/api/external-call-log' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await logFrontendApiCall(env, authContext.companyId, await request.json());
        return Response.json({ success: true });
      }

      if (url.pathname === '/api/capacities' && request.method === 'GET') {
        const authContext = await requirePipedriveAuth(request, env);
        return getCapacities(env, authContext);
      }

      if (url.pathname === '/api/capacities' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'save-capacities', request);
        return saveCapacities(request, env, authContext);
      }

      if (url.pathname === '/api/assign' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'assign', request);
        return assignDeal(request, env, authContext);
      }

      if (url.pathname === '/api/assignment-summary' && request.method === 'GET') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'assignment-summary', request);
        return getAssignmentSummary(env, authContext);
      }

      if (url.pathname === '/api/company-sales-analysis' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'company-sales-analysis', request);
        return handleCompanySalesAnalysis(request, env, authContext);
      }

      if (url.pathname === "/webhooks/pipedrive" && request.method === "POST") {
        return handlePipedriveWebhook(request, env);
      }

      return new Response('Pipedrive Smart Assignment App Running');
    } catch (error) {
      if (error instanceof Response) return error;
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }
};
