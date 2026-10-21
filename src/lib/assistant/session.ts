/**
 * The Assistant conversation: runs the model ↔ plan-tool loop in the browser.
 * Edits land on the plan as a preview; the person applies or discards them,
 * and either way it is one undo step. Each project keeps its conversations
 * in this browser, so they survive a reload and the person can go back to an
 * earlier one.
 */
import { get, writable } from 'svelte/store';
import { currentProject, previewActive, beginPreview, commitPreview, discardPreview } from '$lib/stores/project';
import { previewHighlight } from '$lib/stores/planView';
import { ASSISTANT_CONFIG, READ_ONLY_TOOLS } from './definitions';
import { forgetDrawings, rememberDrawing } from './drawings';
import { runAssistantTool } from './tools';
import type { ToolOutcome } from './planTools';
import { AUTO_REVIEW_MIN_CHANGES, MAX_REVIEWS, reviewBrief, reviewEnabled, runReview, type ReviewInput } from './reviewer';
import { assistantApiKey } from './apiKey';
import { streamTurn, AssistantRequestError, type ApiMessage, type ContentBlock, type ImageSource, type ToolResultPart } from './stream';

export type ActivityKind = 'thinking' | 'reading' | 'catalog' | 'rooms' | 'walls' | 'openings' | 'furniture' | 'adjusting' | 'removing' | 'floors' | 'checking' | 'building' | 'drawing' | 'pipes' | 'wiring' | 'looking3d' | 'guide' | 'brief' | 'reviewing';

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
  /** The model's latest progress note while it works; shown with the activity, never saved. */
  note: string | null;
}

/** A photo or PDF ready to send: what the model sees and a small preview for the chat (PDFs have a file name instead of a thumbnail). */
export interface Attachment {
  mediaType: ImageSource['media_type'] | 'application/pdf'; data: string; thumb: string; name?: string;
  /** The original file, kept for zooming in. */
  source?: Blob;
  /** Text the model gets with the picture (a sketch's strokes in plan cm). */
  note?: string;
  /** Drawn on the plan rather than attached. */
  sketch?: boolean;
}

export const assistant = writable<AssistantState>({ items: [], busy: false, activity: null, note: null });

const NOTE_LENGTH = 120;

/**
 * A progress note short enough for the activity line: the last line of the
 * thinking so far, cut to the whole sentences at its end that fit, or to the
 * start of its last sentence when that alone is too long.
 */
export function progressNote(thinking: string): string | null {
  const line = thinking.split(/\n+/).map(part => part.replace(/\*\*|^[#>*\-\s]+/g, '').trim()).filter(Boolean).at(-1);
  if (!line) return null;
  if (line.length <= NOTE_LENGTH) return line;
  const sentences = line.split(/(?<=[.!?…])\s+/);
  let note = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const longer = note ? `${sentences[i]} ${note}` : sentences[i];
    if (longer.length > NOTE_LENGTH) break;
    note = longer;
  }
  if (note) return note;
  const last = sentences[sentences.length - 1];
  const cut = last.slice(0, NOTE_LENGTH - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`;
}

const ACTIVITY: Record<string, ActivityKind> = {
  get_plan: 'reading', search_catalog: 'catalog', add_room: 'rooms', add_walls: 'walls', add_openings: 'openings',
  place_furniture: 'furniture', update_elements: 'adjusting', delete_elements: 'removing',
  switch_floor: 'floors', add_floor: 'floors', check_plan: 'checking', show_tool: 'checking', make_tool: 'building',
  view_drawing: 'drawing', trace_drawing: 'drawing', view_plan: 'checking', review_proposal: 'reviewing',
  add_pipes: 'pipes', link_switch: 'wiring', view_3d: 'looking3d', read_skill: 'guide', update_brief: 'brief',
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

/** One chat: `o3d_assistant_chat_<project>:<chat>`. Before chat history it was `o3d_assistant_chat_<project>`. */
const STORAGE_PREFIX = 'o3d_assistant_chat_';
/** The project's list of chats and which one is open. */
const INDEX_PREFIX = 'o3d_assistant_chats_';
const STORAGE_LIMIT = 1_000_000;
const MAX_CHATS = 30;
interface Saved { v: 1; items: ChatItem[]; api: ApiMessage[]; outcomeNote: string | null }

/** A chat in the history list. */
export interface ChatSummary { id: string; title: string; updatedAt: number }
interface ChatIndex { v: 1; current: string | null; chats: ChatSummary[] }

/** This project's chats, newest first. The open one is `activeChatId`. */
export const chatHistory = writable<ChatSummary[]>([]);
export const activeChatId = writable<string>('');

const chatKey = (project: string, chat: string) => `${STORAGE_PREFIX}${project}:${chat}`;

function readIndex(project: string): ChatIndex {
  try {
    const data = JSON.parse(localStorage.getItem(INDEX_PREFIX + project) ?? 'null') as ChatIndex | null;
    if (data?.v === 1 && Array.isArray(data.chats)) return data;
  } catch { /* unreadable: start a new list */ }
  return { v: 1, current: null, chats: [] };
}

function writeIndex(project: string, index: ChatIndex) {
  index.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  // Keep the list bounded: the oldest chats go first.
  for (const old of index.chats.splice(MAX_CHATS)) localStorage.removeItem(chatKey(project, old.id));
  localStorage.setItem(INDEX_PREFIX + project, JSON.stringify(index));
  chatHistory.set(index.chats);
}

/** The single conversation saved before chat history becomes the first chat in the list. */
function migrateLegacy(project: string) {
  const legacy = localStorage.getItem(STORAGE_PREFIX + project);
  if (legacy === null || localStorage.getItem(INDEX_PREFIX + project) !== null) return;
  try {
    const data = JSON.parse(legacy) as Saved;
    const id = newConversationId();
    localStorage.setItem(chatKey(project, id), legacy);
    writeIndex(project, { v: 1, current: id, chats: [{ id, title: chatTitle(data.items ?? []), updatedAt: Date.now() }] });
  } catch { /* unreadable: dropped */ }
  localStorage.removeItem(STORAGE_PREFIX + project);
}

/** The first thing the person asked, shortened, or the name of the PDF they sent. */
function chatTitle(items: ChatItem[]): string {
  const first = items.find((item): item is Extract<ChatItem, { kind: 'user' }> => item.kind === 'user');
  const text = first?.text.replace(/\s+/g, ' ').trim() ?? '';
  if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  // Without text the panel shows a translated "Untitled chat".
  return first?.files?.[0] ?? '';
}

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
  const project = projectId, chat = conversationId;
  try {
    const items = get(assistant).items.filter(item => item.kind !== 'error').slice(-200);
    const index = readIndex(project);
    index.chats = index.chats.filter(entry => entry.id !== chat);
    if (!items.length) {
      // An empty chat isn't kept or listed.
      localStorage.removeItem(chatKey(project, chat));
      index.current = null;
      writeIndex(project, index);
      return;
    }
    let messages = withoutPhotos(api);
    let data: Saved = { v: 1, items, api: messages, outcomeNote };
    while (JSON.stringify(data).length > STORAGE_LIMIT && messages.length > 2) {
      const next = messages.findIndex((m, i) => i > 0 && m.role === 'user' && m.content.some(b => b.type === 'text'));
      messages = next > 0 ? messages.slice(next) : messages.slice(2);
      data = { ...data, api: messages, items: data.items.slice(Math.floor(data.items.length / 4)) };
    }
    const raw = JSON.stringify(data);
    index.chats.unshift({ id: chat, title: chatTitle(items), updatedAt: Date.now() });
    index.current = chat;
    for (;;) {
      try { localStorage.setItem(chatKey(project, chat), raw); break; }
      catch (error) {
        // Storage full: make room by dropping the oldest other chat.
        const oldest = index.chats.length > 1 ? index.chats.pop() : undefined;
        if (!oldest) throw error;
        localStorage.removeItem(chatKey(project, oldest.id));
      }
    }
    writeIndex(project, index);
  } catch { /* storage full or unavailable: the conversation just isn't kept */ }
}

/** Load the project's chat list and open the chat that was open last. */
function restoreProject(project: string) {
  if (typeof localStorage === 'undefined') { chatHistory.set([]); return; }
  migrateLegacy(project);
  const index = readIndex(project);
  chatHistory.set(index.chats);
  if (index.current && index.chats.some(chat => chat.id === index.current)) restore(project, index.current);
}

function restore(project: string, chat: string) {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(chatKey(project, chat));
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
    conversationId = chat;
    activeChatId.set(chat);
    outcomeNote = unapplied ? 'The page was reloaded before the person applied your last changes, so they were discarded.' : data.outcomeNote;
    nextId = Math.max(0, ...items.map(item => item.id)) + 1;
    assistant.set({ items, busy: false, activity: null, note: null });
  } catch { /* unreadable: start fresh */ }
}

// A new project starts (or picks up) its own conversation.
currentProject.subscribe(project => {
  if (project?.id === projectId) return;
  projectId = project?.id;
  resetConversation();
  if (projectId) restoreProject(projectId);
  else chatHistory.set([]);
});

// Undo (or anything else) can end a preview from outside the panel.
previewActive.subscribe(active => {
  if (!active && proposal) settleProposal('discarded');
});

function resetConversation() {
  controller?.abort();
  controller = null;
  conversationId = newConversationId();
  activeChatId.set(conversationId);
  api = [];
  forgetDrawings();
  outcomeNote = null;
  proposal = null;
  previewHighlight.set(new Set());
  assistant.set({ items: [], busy: false, activity: null, note: null });
}

/** Start a new chat; the current one stays in the history. Any proposal still on the plan is discarded first. */
export function newConversation() {
  if (proposal) discardProposal();
  persist();
  resetConversation();
  persist();
}

/** Go back to an earlier chat of this project. */
export function openConversation(id: string) {
  if (!projectId || id === conversationId || get(assistant).busy) return;
  if (proposal) discardProposal();
  persist();
  resetConversation();
  restore(projectId, id);
  persist();
}

/** Delete a chat from the history. Deleting the open chat starts a new one. */
export function deleteConversation(id: string) {
  if (!projectId || typeof localStorage === 'undefined') return;
  if (id === conversationId) {
    if (get(assistant).busy) return;
    if (proposal) discardProposal();
    resetConversation();
  }
  try {
    localStorage.removeItem(chatKey(projectId, id));
    const index = readIndex(projectId);
    index.chats = index.chats.filter(chat => chat.id !== id);
    if (index.current === id) index.current = null;
    writeIndex(projectId, index);
  } catch { /* storage unavailable */ }
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
  else if (name === 'update_elements' || name === 'add_pipes' || name === 'link_switch' || name === 'update_brief') counts.changed += changed.filter(id => !proposal!.changed.has(id)).length;
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
    else if (file.data) content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
    if (file.note) content.push({ type: 'text', text: file.note });
  }
  if (outcomeNote) { content.push({ type: 'text', text: `[${outcomeNote}]` }); outcomeNote = null; }
  content.push({ type: 'text', text: text || (images.every(file => file.mediaType === 'application/pdf') ? 'Here is a PDF.' : images.some(file => file.sketch) ? 'Look at what I drew on the plan.' : 'Here is a photo.') });
  api.push({ role: 'user', content });
  update(state => {
    state.items = state.items.filter(item => item.kind !== 'error');
    state.items.push({ kind: 'user', id: nextId++, text, ...(images.some(file => file.thumb) ? { images: images.filter(file => file.thumb).map(file => file.thumb) } : {}), ...(images.some(file => !file.thumb) ? { files: images.filter(file => !file.thumb).map(file => file.name ?? 'PDF') } : {}) });
    state.busy = true;
    state.activity = 'thinking';
    state.note = null;
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

/** Ask the reviewer to look at the proposal; its findings become the tool's result. */
async function reviewProposal(input: unknown, round: number, signal: AbortSignal): Promise<ToolOutcome> {
  if (!get(reviewEnabled)) return { text: 'Review is switched off. Check the proposal yourself, then answer.' };
  if (round > MAX_REVIEWS) return { text: 'This change has been reviewed already. Fix what is left, then answer.' };
  const brief = reviewBrief((input ?? {}) as ReviewInput, {
    personSaid: lastUser.text,
    changed: proposal ? [...proposal.changed] : [],
    removed: proposal ? [...proposal.removed] : [],
  });
  const apiKey = get(assistantApiKey) || undefined;
  const text = await runReview(brief, {
    signal,
    call: messages => streamTurn(messages as ApiMessage[], { signal, agent: 'reviewer', conversation: `${conversationId}-review-${round}`, apiKey }),
    runTool: runAssistantTool,
  });
  return { text: `Review:\n${text}` };
}

async function runLoop() {
  controller = new AbortController();
  const signal = controller.signal;
  const replyId = nextId++;
  let replyShown = false;
  const madeTools: string[] = [];
  let reviews = 0;
  const showReply = (text: string, streaming: boolean) => {
    if (!replyShown) {
      replyShown = true;
      update(state => { state.items.push({ kind: 'assistant', id: replyId, text, streaming }); });
    } else patchItem(replyId, { text, streaming });
  };
  try {
    for (let round = 0; ; round++) {
      if (round >= ASSISTANT_CONFIG.maxRounds) throw new AssistantRequestError(500, 'The assistant took too many steps and stopped.');
      let text = '';
      const turn = await streamTurn(api, {
        signal,
        conversation: conversationId,
        apiKey: get(assistantApiKey) || undefined,
        onText: delta => { text += delta; update(state => { state.activity = null; state.note = null; }); showReply(text, true); },
        onThinking: thinking => {
          const note = progressNote(thinking);
          if (note && note !== get(assistant).note) update(state => { state.note = note; });
        },
      });
      if (turn.stopReason === 'refusal') throw new AssistantRequestError(422, 'The assistant declined this request. Try rephrasing it.');
      api.push({ role: 'assistant', content: turn.content });
      const uses = turn.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
      if (!uses.length || turn.stopReason !== 'tool_use') {
        if (text) showReply(text, false);
        // A bigger proposal finished without a review: have it reviewed, and let the Assistant fix and answer again.
        const size = proposal ? proposal.changed.size + proposal.removed.size : 0;
        if (turn.stopReason !== 'end_turn' || reviews || size < AUTO_REVIEW_MIN_CHANGES || !get(reviewEnabled)) break;
        update(state => { state.activity = 'reviewing'; });
        const review = await reviewProposal({ summary: text }, ++reviews, signal);
        // Nothing to fix, or no review to act on: keep the answer as it is.
        if (/^Review:\s*(No problems found|The review failed|The reviewer (declined|ran out))/i.test(review.text)) break;
        api.push({ role: 'user', content: [{ type: 'text', text: `[A second designer reviewed your proposal before the person saw it.\n${review.text}\nFix the problems that hold up, then give your answer again.]` }] });
        update(state => { state.activity = 'thinking'; });
        continue;
      }
      const results: ContentBlock[] = [];
      for (const use of uses) {
        update(state => { state.activity = ACTIVITY[use.name] ?? 'thinking'; state.note = null; });
        if (!READ_ONLY_TOOLS.has(use.name)) {
          beginPreview();
          proposal ??= { counts: emptyCounts(), changed: new Set(), removed: new Set(), itemId: null };
        }
        const outcome = use.name === 'review_proposal' ? await reviewProposal(use.input, ++reviews, signal) : await runAssistantTool(use.name, use.input);
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
    update(state => { state.busy = false; state.activity = null; state.note = null; });
    persist();
  }
}
