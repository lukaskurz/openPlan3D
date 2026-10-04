/**
 * The Assistant conversation: runs the model ↔ plan-tool loop in the browser.
 * Edits land on the plan as a preview; the person applies or discards them,
 * and either way it is one undo step. Each project keeps its conversation in
 * this browser, so it survives a reload.
 */
import { get, writable } from 'svelte/store';
import { currentProject, previewActive, beginPreview, commitPreview, discardPreview } from '$lib/stores/project';
import { previewHighlight } from '$lib/stores/planView';
import { ASSISTANT_MODELS, READ_ONLY_TOOLS, assistantMode } from './definitions';
import { forgetDrawings, isDrawingTool, rememberDrawing, runDrawingTool } from './drawings';
import { runPlanTool } from './planTools';
import { assistantApiKey } from './apiKey';
import { streamTurn, AssistantRequestError, type ApiMessage, type ContentBlock, type ImageSource, type ToolResultPart } from './stream';

export type ActivityKind = 'thinking' | 'reading' | 'catalog' | 'rooms' | 'walls' | 'openings' | 'furniture' | 'adjusting' | 'removing' | 'floors' | 'checking' | 'building' | 'drawing';

export interface ChangeCounts { rooms: number; walls: number; openings: number; furniture: number; floors: number; changed: number; removed: number }

export type ErrorKind = 'unavailable' | 'busy' | 'network' | 'failed' | 'tooLong' | 'badKey';

export type ChatItem =
  | { kind: 'user'; id: number; text: string; images?: string[]; files?: string[] }
  | { kind: 'assistant'; id: number; text: string; streaming: boolean; stopped?: boolean }
  | { kind: 'proposal'; id: number; status: 'pending' | 'applied' | 'discarded'; counts: ChangeCounts }
  | { kind: 'tool'; id: number; toolId: string }
  | { kind: 'error'; id: number; error: ErrorKind; message?: string; retry: boolean };

export interface AssistantState {
  items: ChatItem[];
  busy: boolean;
  activity: ActivityKind | null;
}

/** A photo or PDF ready to send: what the model sees and a small preview for the chat (PDFs have a file name instead of a thumbnail). */
export interface Attachment { mediaType: ImageSource['media_type'] | 'application/pdf'; data: string; thumb: string; name?: string; /** The original file, kept for zooming in. */ source?: Blob }

export const assistant = writable<AssistantState>({ items: [], busy: false, activity: null });

const ACTIVITY: Record<string, ActivityKind> = {
  get_plan: 'reading', search_catalog: 'catalog', add_room: 'rooms', add_walls: 'walls', add_openings: 'openings',
  place_furniture: 'furniture', update_elements: 'adjusting', delete_elements: 'removing',
  switch_floor: 'floors', add_floor: 'floors', check_plan: 'checking', show_tool: 'checking', make_tool: 'building',
  view_drawing: 'drawing', trace_drawing: 'drawing', view_plan: 'checking',
};

let api: ApiMessage[] = [];
let nextId = 1;
let controller: AbortController | null = null;
let lastUser: { text: string; images: Attachment[] } = { text: '', images: [] };
/** Told to the model with the next message, so it knows what happened to its last proposal. */
let outcomeNote: string | null = null;
let proposal: { counts: ChangeCounts; changed: Set<string>; removed: Set<string>; itemId: number | null } | null = null;
let projectId: string | undefined;
/** Identifies the conversation to the server (the development `claude -p` mode keeps one process per conversation). */
let conversationId = newConversationId();

function newConversationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const emptyCounts = (): ChangeCounts => ({ rooms: 0, walls: 0, openings: 0, furniture: 0, floors: 0, changed: 0, removed: 0 });

function update(fn: (state: AssistantState) => void) {
  assistant.update(state => { fn(state); return { ...state, items: [...state.items] }; });
}

function patchItem(id: number, patch: Partial<ChatItem>) {
  update(state => { state.items = state.items.map(item => item.id === id ? { ...item, ...patch } as ChatItem : item); });
}

// ── Keeping the conversation ─────────────────────────────────────────

const STORAGE_PREFIX = 'o3d_assistant_chat_';
const STORAGE_LIMIT = 1_500_000;
interface Saved { v: 1; items: ChatItem[]; api: ApiMessage[]; outcomeNote: string | null }

/** A tool result's picture becomes a note; its text stays. */
const withoutPictures = (parts: ToolResultPart[]): ToolResultPart[] =>
  parts.map(part => part.type === 'image' ? { type: 'text', text: '[The picture from this tool was removed. Call the tool again to see it.]' } : part);

const withoutPhotos = (messages: ApiMessage[]): ApiMessage[] => messages.map(message => ({
  ...message,
  content: message.content.map(block => block.type === 'image' ? { type: 'text' as const, text: '[A photo the person attached earlier.]' }
    : block.type === 'document' ? { type: 'text' as const, text: '[A PDF the person attached earlier.]' }
    : block.type === 'tool_result' && Array.isArray(block.content) ? { ...block, content: withoutPictures(block.content) }
    : block),
}));

function persist() {
  if (!projectId || typeof localStorage === 'undefined') return;
  try {
    const items = get(assistant).items.filter(item => item.kind !== 'error').slice(-200);
    let messages = withoutPhotos(api);
    let data: Saved = { v: 1, items, api: messages, outcomeNote };
    while (JSON.stringify(data).length > STORAGE_LIMIT && messages.length > 2) {
      const next = messages.findIndex((m, i) => i > 0 && m.role === 'user' && m.content.some(b => b.type === 'text'));
      messages = next > 0 ? messages.slice(next) : messages.slice(2);
      data = { ...data, api: messages, items: data.items.slice(Math.floor(data.items.length / 4)) };
    }
    if (!items.length) localStorage.removeItem(STORAGE_PREFIX + projectId);
    else localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(data));
  } catch { /* storage full or unavailable: the conversation just isn't kept */ }
}

function restore(id: string) {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return;
    const data = JSON.parse(raw) as Saved;
    if (data?.v !== 1 || !Array.isArray(data.items) || !Array.isArray(data.api)) return;
    let unapplied = false;
    // A preview never outlives the page, so a proposal still pending was discarded by the reload.
    const items = data.items.map(item => {
      if (item.kind === 'proposal' && item.status === 'pending') { unapplied = true; return { ...item, status: 'discarded' as const }; }
      if (item.kind === 'assistant' && item.streaming) return { ...item, streaming: false, stopped: true };
      return item;
    });
    api = data.api;
    outcomeNote = unapplied ? 'The page was reloaded before the person applied your last changes, so they were discarded.' : data.outcomeNote;
    nextId = Math.max(0, ...items.map(item => item.id)) + 1;
    assistant.set({ items, busy: false, activity: null });
  } catch { /* unreadable: start fresh */ }
}

// A new project starts (or picks up) its own conversation.
currentProject.subscribe(project => {
  if (project?.id === projectId) return;
  projectId = project?.id;
  resetConversation();
  if (projectId) restore(projectId);
});

// Undo (or anything else) can end a preview from outside the panel.
previewActive.subscribe(active => {
  if (!active && proposal) settleProposal('discarded');
});

function resetConversation() {
  controller?.abort();
  controller = null;
  conversationId = newConversationId();
  api = [];
  forgetDrawings();
  outcomeNote = null;
  proposal = null;
  previewHighlight.set(new Set());
  assistant.set({ items: [], busy: false, activity: null });
}

/** Start over. Any proposal still on the plan is discarded first. */
export function newConversation() {
  if (proposal) discardProposal();
  resetConversation();
  persist();
}

function settleProposal(status: 'applied' | 'discarded') {
  if (!proposal) return;
  const { itemId } = proposal;
  proposal = null;
  previewHighlight.set(new Set());
  outcomeNote = status === 'applied' ? 'The person applied your last changes.' : 'The person discarded your last changes, so the plan is back to how it was before them.';
  if (itemId !== null) patchItem(itemId, { status });
  persist();
}

export function applyProposal() {
  if (!proposal) return;
  const counts = proposal.counts;
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  // Settle before committing: the preview ending would otherwise read as a discard.
  const pending = proposal;
  proposal = null;
  commitPreview(`Assistant: ${parts.join(', ') || 'changes'}`);
  proposal = pending;
  settleProposal('applied');
}

export function discardProposal() {
  if (!proposal) return;
  discardPreview();
  settleProposal('discarded');
}

export function stop() {
  controller?.abort();
}

/**
 * Old plan readouts and photos are the bulk of a long conversation. Before
 * each new message, keep only the latest readout and the two latest photo
 * messages, so every request stays small.
 */
function trimHistory() {
  const isReadout = (block: ContentBlock) => block.type === 'tool_result' && typeof block.content === 'string' && block.content.startsWith('Project "');
  let latest = -1;
  api.forEach((message, i) => { if (message.content.some(isReadout)) latest = i; });
  const photoMessages = api.map((m, i) => m.content.some(b => b.type === 'image') ? i : -1).filter(i => i >= 0);
  const keepPhotos = new Set(photoMessages.slice(-2));
  const pdfMessages = api.map((m, i) => m.content.some(b => b.type === 'document') ? i : -1).filter(i => i >= 0);
  const keepPdf = new Set(pdfMessages.slice(-1));
  api = api.map((message, i) => message.role !== 'user' ? message : {
    ...message,
    content: message.content.map(block => {
      if (i !== latest && isReadout(block)) return { ...block, content: '(Older plan readout removed. Call get_plan for the current plan.)' } as ContentBlock;
      if (block.type === 'tool_result' && Array.isArray(block.content)) return { ...block, content: withoutPictures(block.content) } as ContentBlock;
      if (block.type === 'image' && !keepPhotos.has(i)) return { type: 'text', text: '[A photo the person attached earlier.]' } as ContentBlock;
      if (block.type === 'document' && !keepPdf.has(i)) return { type: 'text', text: '[A PDF the person attached earlier.]' } as ContentBlock;
      return block;
    }),
  });
  // Keep the conversation bounded: drop whole exchanges from the start.
  while (JSON.stringify(api).length > 8_000_000 || api.length > 200) {
    const nextUser = api.findIndex((message, i) => i > 0 && message.role === 'user' && message.content.some(block => block.type === 'text'));
    if (nextUser <= 0) break;
    api = api.slice(nextUser);
  }
}

function recordChanges(name: string, outcome: { changed?: string[]; removed?: string[]; isError?: boolean }) {
  if (!proposal) return;
  const counts = proposal.counts;
  const changed = outcome.changed ?? [];
  if (name === 'add_room') counts.rooms += changed.some(id => id.startsWith('room')) ? 1 : 0;
  else if (name === 'add_walls') counts.walls += changed.length;
  else if (name === 'add_openings') counts.openings += changed.length;
  else if (name === 'place_furniture') counts.furniture += changed.length;
  else if (name === 'add_floor') counts.floors += outcome.isError ? 0 : 1;
  else if (name === 'update_elements') counts.changed += changed.filter(id => !proposal!.changed.has(id)).length;
  else if (name === 'delete_elements') counts.removed += (outcome.removed ?? []).filter(id => !proposal!.changed.has(id)).length;
  for (const id of changed) proposal.changed.add(id);
  for (const id of outcome.removed ?? []) { proposal.removed.add(id); proposal.changed.delete(id); }
  previewHighlight.set(new Set(proposal.changed));
}

function errorItem(error: unknown): ChatItem {
  const id = nextId++;
  if (error instanceof AssistantRequestError) {
    if (error.ownKey && (error.status === 401 || error.status === 403)) return { kind: 'error', id, error: 'badKey', message: error.message, retry: false };
    if (error.status === 503 || error.status === 404) return { kind: 'error', id, error: error.ownKey ? 'busy' : 'unavailable', message: error.message, retry: error.ownKey };
    if (error.status === 429 || error.status === 529) return { kind: 'error', id, error: 'busy', message: error.message, retry: true };
    if (error.status === 413) return { kind: 'error', id, error: 'tooLong', retry: false };
    return { kind: 'error', id, error: 'failed', message: error.message, retry: true };
  }
  return { kind: 'error', id, error: 'network', retry: true };
}

export async function send(text: string, images: Attachment[] = []) {
  text = text.trim();
  if ((!text && !images.length) || get(assistant).busy || !get(currentProject)) return;
  lastUser = { text, images };
  trimHistory();
  const content: ContentBlock[] = [];
  for (const file of images.slice(0, 3)) {
    if (file.source) rememberDrawing(file.name ?? (file.mediaType === 'application/pdf' ? 'drawing.pdf' : 'photo'), file.source);
    if (file.mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
  }
  if (outcomeNote) { content.push({ type: 'text', text: `[${outcomeNote}]` }); outcomeNote = null; }
  content.push({ type: 'text', text: text || (images.every(file => file.mediaType === 'application/pdf') ? 'Here is a PDF.' : 'Here is a photo.') });
  api.push({ role: 'user', content });
  update(state => {
    state.items = state.items.filter(item => item.kind !== 'error');
    state.items.push({ kind: 'user', id: nextId++, text, ...(images.some(file => file.thumb) ? { images: images.filter(file => file.thumb).map(file => file.thumb) } : {}), ...(images.some(file => !file.thumb) ? { files: images.filter(file => !file.thumb).map(file => file.name ?? 'PDF') } : {}) });
    state.busy = true;
    state.activity = 'thinking';
  });
  await runLoop();
}

/** Send the last message again after an error. */
export async function retry() {
  if (get(assistant).busy) return;
  // Drop the unanswered turn; send() adds it back.
  while (api.length && api[api.length - 1].role === 'user') api.pop();
  update(state => {
    state.items = state.items.filter(item => item.kind !== 'error');
    const last = state.items[state.items.length - 1];
    if (last?.kind === 'user') state.items.pop();
  });
  await send(lastUser.text, lastUser.images);
}

async function runLoop() {
  controller = new AbortController();
  const signal = controller.signal;
  const replyId = nextId++;
  let replyShown = false;
  const madeTools: string[] = [];
  const showReply = (text: string, streaming: boolean) => {
    if (!replyShown) {
      replyShown = true;
      update(state => { state.items.push({ kind: 'assistant', id: replyId, text, streaming }); });
    } else patchItem(replyId, { text, streaming });
  };
  const maxRounds = ASSISTANT_MODELS[assistantMode(api)].maxRounds;
  try {
    for (let round = 0; ; round++) {
      if (round >= maxRounds) throw new AssistantRequestError(500, 'The assistant took too many steps and stopped.');
      let text = '';
      const turn = await streamTurn(api, {
        signal,
        conversation: conversationId,
        apiKey: get(assistantApiKey) || undefined,
        onText: delta => { text += delta; update(state => { state.activity = null; }); showReply(text, true); },
      });
      if (turn.stopReason === 'refusal') throw new AssistantRequestError(422, 'The assistant declined this request. Try rephrasing it.');
      api.push({ role: 'assistant', content: turn.content });
      const uses = turn.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
      if (!uses.length || turn.stopReason !== 'tool_use') {
        if (text) showReply(text, false);
        break;
      }
      const results: ContentBlock[] = [];
      for (const use of uses) {
        update(state => { state.activity = ACTIVITY[use.name] ?? 'thinking'; });
        if (!READ_ONLY_TOOLS.has(use.name)) {
          beginPreview();
          proposal ??= { counts: emptyCounts(), changed: new Set(), removed: new Set(), itemId: null };
        }
        const outcome = isDrawingTool(use.name) ? await runDrawingTool(use.name, use.input) : runPlanTool(use.name, use.input);
        if (!READ_ONLY_TOOLS.has(use.name)) recordChanges(use.name, outcome);
        if (outcome.madeTool) madeTools.push(outcome.madeTool);
        const content = outcome.image ? [{ type: 'text' as const, text: outcome.text }, { type: 'image' as const, source: { type: 'base64' as const, media_type: outcome.image.mediaType, data: outcome.image.data } }] : outcome.text;
        results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      api.push({ role: 'user', content: results });
      update(state => { state.activity = 'thinking'; });
    }
  } catch (error) {
    if (signal.aborted) {
      if (replyShown) patchItem(replyId, { streaming: false, stopped: true });
      else update(state => { state.items.push({ kind: 'assistant', id: replyId, text: '', streaming: false, stopped: true }); });
    } else {
      if (replyShown) patchItem(replyId, { streaming: false });
      update(state => { state.items.push(errorItem(error)); });
    }
    // Every tool call needs a result, and a stopped turn needs a reply, before the next message.
    const last = api[api.length - 1];
    if (last?.role === 'assistant') {
      const pending = last.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
      if (pending.length) api.push({ role: 'user', content: pending.map(block => ({ type: 'tool_result' as const, tool_use_id: block.id, content: 'Stopped before this ran.', is_error: true })) });
    }
    const tail = api[api.length - 1];
    if (tail?.role === 'user' && (signal.aborted || tail.content.some(block => block.type === 'tool_result'))) {
      api.push({ role: 'assistant', content: [{ type: 'text', text: '(Stopped.)' }] });
    }
  } finally {
    controller = null;
    if (madeTools.length) update(state => { for (const toolId of madeTools) state.items.push({ kind: 'tool', id: nextId++, toolId }); });
    if (proposal && get(previewActive)) {
      const hasChanges = proposal.changed.size > 0 || proposal.removed.size > 0 || proposal.counts.floors > 0;
      if (hasChanges) {
        // One live proposal: it moves below the newest reply.
        const card: ChatItem = { kind: 'proposal', id: nextId++, status: 'pending', counts: { ...proposal.counts } };
        const previous = proposal.itemId;
        proposal.itemId = card.id;
        update(state => {
          state.items = state.items.filter(item => item.id !== previous);
          state.items.push(card);
        });
      } else if (proposal.itemId === null) {
        // Edits that all failed leave nothing to apply: end the preview quietly.
        proposal = null;
        discardPreview();
        previewHighlight.set(new Set());
      }
    }
    update(state => { state.busy = false; state.activity = null; });
    persist();
  }
}
