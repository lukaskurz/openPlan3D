// Development only: the MCP server `claude -p` sees for the in-app Assistant.
// It lists the assistant's plan tools and hands each call to the dev server,
// which passes it to the browser and answers once the browser has run it.
// See docs/assistant-chat.md ("Development with your Claude subscription").
import readline from 'node:readline';

const { BRIDGE_URL, BRIDGE_TOKEN, BRIDGE_CONVERSATION, BRIDGE_AGENT } = process.env;
const headers = { 'content-type': 'application/json', authorization: `Bearer ${BRIDGE_TOKEN}` };
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

async function handle(message) {
  const reply = (result) => send({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'plan', version: '1.0.0' } });
    case 'tools/list': {
      const response = await fetch(`${BRIDGE_URL}/tools${BRIDGE_AGENT ? `?agent=${BRIDGE_AGENT}` : ''}`, { headers });
      return reply({ tools: await response.json() });
    }
    case 'tools/call': {
      try {
        const response = await fetch(`${BRIDGE_URL}/call`, {
          method: 'POST', headers,
          body: JSON.stringify({ conversation: BRIDGE_CONVERSATION, name: message.params.name, input: message.params.arguments ?? {} }),
        });
        const { text, isError, image } = await response.json();
        const content = [{ type: 'text', text }];
        if (image) content.push({ type: 'image', data: image.data, mimeType: image.mediaType });
        return reply({ content, isError: !!isError });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: `error: the plan didn't answer (${error.message})` }], isError: true });
      }
    }
    case 'ping':
      return reply({});
    default:
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  void handle(message);
});
