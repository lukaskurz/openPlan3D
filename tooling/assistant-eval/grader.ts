/**
 * The grader: one Claude Opus 5.5 call per case that scores the assistant's
 * work against the case's rubric, given the plan before and after, the reply
 * and the deterministic check results. Raw fetch, like the rest of the project.
 */
import { ANTHROPIC_MESSAGES_URL } from '$lib/assistant/stream';
import { costOf, readUsage, type Usage } from './pricing';
import type { CheckResult } from './helpers';

export const GRADER_MODEL = 'claude-opus-5-5';

export interface Grade {
  overall: number | null;
  criteria: { criterion: string; score: number; reason: string }[];
  summary: string;
  usage: Usage;
  costUsd: number;
  ms: number;
  error?: string;
}

export interface GradeInput {
  prompt: string;
  planBefore: string;
  planAfter: string;
  reply: string;
  checks: CheckResult[];
  rubric: string[];
  /** Tool calls in order, one line each. */
  toolLog: string;
  /** Problems outside the reply: errors shown in the chat, a proposal that wasn't applied. */
  notes: string[];
}

const score = { type: 'integer', enum: [1, 2, 3, 4, 5] };

export const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'overall', 'summary'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'score', 'reason'],
        properties: { criterion: { type: 'string' }, score, reason: { type: 'string' } },
      },
    },
    overall: score,
    summary: { type: 'string' },
  },
};

const SYSTEM = `You grade the in-app design assistant of openPlan3D, a floor plan editor. A person typed one message; the assistant read the plan, may have edited it with its tools (the edits were applied), and replied in a narrow chat panel.

Score each rubric criterion from 1 to 5: 5 fully met, 4 met with small flaws, 3 partly met, 2 mostly not met, 1 not met or harmful. Base scores on the plan before and after and on the reply, not on what the reply claims. The deterministic checks are measured facts about the final plan; when a check fails, the matching criterion can't score 5 unless the check is clearly too strict for this case. Give each criterion a one-line reason. Then an overall score from 1 to 5 for how well the person was served, and a one- or two-sentence summary. Coordinates are centimetres, x right, y down; rotation 0 means the item's back is towards the top of the plan and it faces down, 90 faces left, 180 up, 270 right.`;

function userMessage(input: GradeInput): string {
  return [
    `<person_said>\n${input.prompt}\n</person_said>`,
    `<plan_before>\n${input.planBefore}\n</plan_before>`,
    `<plan_after>\n${input.planAfter}\n</plan_after>`,
    `<assistant_tool_calls>\n${input.toolLog || '(none)'}\n</assistant_tool_calls>`,
    `<assistant_reply>\n${input.reply || '(no reply)'}\n</assistant_reply>`,
    input.notes.length ? `<notes>\n${input.notes.join('\n')}\n</notes>` : '',
    `<checks>\n${input.checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n') || '(none)'}\n</checks>`,
    `<rubric>\n${input.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n</rubric>`,
    'Score every rubric criterion in order.',
  ].filter(Boolean).join('\n\n');
}

export function graderRequest(input: GradeInput) {
  return {
    model: GRADER_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: GRADE_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(input) }],
  };
}

export async function grade(input: GradeInput, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Grade> {
  const result: Grade = { overall: null, criteria: [], summary: '', usage: readUsage({}), costUsd: 0, ms: 0 };
  const started = Date.now();
  try {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(graderRequest(input)),
    });
    const body = await response.json().catch(() => null) as any;
    if (body?.usage) {
      readUsage(body.usage, result.usage);
      result.costUsd = costOf(String(body.model ?? GRADER_MODEL), result.usage);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.error?.message ?? 'grader request failed'}`);
    if (body?.stop_reason === 'refusal') throw new Error(`grader declined (${body?.stop_details?.category ?? 'no category'})`);
    if (body?.stop_reason === 'max_tokens') throw new Error('grader ran out of tokens');
    const text = (body?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
    const parsed = JSON.parse(text);
    result.overall = typeof parsed.overall === 'number' ? parsed.overall : null;
    result.criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
    result.summary = String(parsed.summary ?? '');
  } catch (error) {
    result.error = (error as Error)?.message ?? 'grader failed';
  }
  result.ms = Date.now() - started;
  return result;
}
