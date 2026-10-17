#!/usr/bin/env node
// Stands in for `claude -p --input-format stream-json …` in tests: asks for the plan
// through the real MCP bridge, then answers with what the tool returned.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const args = process.argv.slice(2);
const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.plan;
const bridge = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: bridge.stdout }).on('line', line => {
  const message = JSON.parse(line);
  pending.get(message.id)?.(message.result);
});
const rpc = (method, params) => new Promise(resolve => {
  const id = nextId++;
  pending.set(id, resolve);
  bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const out = event => process.stdout.write(JSON.stringify(event) + '\n');
const stream = event => out({ type: 'stream_event', event });

await rpc('initialize', { protocolVersion: '2025-06-18' });
const tools = await rpc('tools/list', {});
let turn = 0;
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  const text = message.message.content[0].text;
  turn++;
  stream({ type: 'message_start', message: { usage: {} } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${turn}`, name: 'mcp__plan__get_plan', input: {} } });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } });
  stream({ type: 'content_block_stop', index: 0 });
  stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
  stream({ type: 'message_stop' });
  const result = await rpc('tools/call', { name: 'get_plan', arguments: {} });
  stream({ type: 'message_start', message: { usage: {} } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Saw: ${result.content[0].text} (${tools.tools.length} tools, turn ${turn}, "${text}")` } });
  stream({ type: 'content_block_stop', index: 0 });
  stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  stream({ type: 'message_stop' });
  out({ type: 'result', subtype: 'success', num_turns: 2, total_cost_usd: 0.01 });
});
process.stdin.on('end', () => { bridge.kill(); process.exit(0); });
