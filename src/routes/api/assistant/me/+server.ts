import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { accessConfig, resolveAccess } from '$lib/server/assistantAuth';
import { assistantBudget } from '$lib/server/assistantBudget';
import { describeAssistantAccess } from '$lib/server/assistantChat';
import type { RequestHandler } from './$types';

/** Whether this server's assistant is open to the caller, and what they have spent. Same Authorization header as the chat. */
export const GET: RequestHandler = async ({ request }) => {
  const headers = { 'Cache-Control': 'no-store' };
  // `claude -p` development mode needs neither a key nor sign-in.
  if (dev && env.ASSISTANT_DEV_CLAUDE === '1') return json({ available: true, access: 'open' }, { headers });
  const config = accessConfig(env, dev);
  return json(await describeAssistantAccess(request, {
    env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    access: req => resolveAccess(req, config),
    budget: assistantBudget(env),
  }), { headers });
};
