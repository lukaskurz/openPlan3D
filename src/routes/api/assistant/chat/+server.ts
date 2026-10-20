import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { accessConfig, resolveAccess } from '$lib/server/assistantAuth';
import { assistantBudget } from '$lib/server/assistantBudget';
import { handleAssistantChat } from '$lib/server/assistantChat';
import type { RequestHandler } from './$types';

/** App Hosting sits behind Google's front end, so the socket address is the proxy's. */
function clientKey(request: Request, getClientAddress: () => string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try { return getClientAddress(); } catch { return 'unknown'; }
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  // Development only: run on your own Claude subscription through `claude -p`.
  if (dev && env.ASSISTANT_DEV_CLAUDE === '1') {
    const { handleDevChat } = await import('$lib/server/assistantDevClaude');
    return handleDevChat(request);
  }
  const config = accessConfig(env, dev);
  return handleAssistantChat(request, {
    env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ASSISTANT_CHAT_UPSTREAM: env.ASSISTANT_CHAT_UPSTREAM },
    client: clientKey(request, getClientAddress),
    access: req => resolveAccess(req, config),
    budget: assistantBudget(env),
  });
};
