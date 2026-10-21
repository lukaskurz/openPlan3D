import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  currentProject, loadProject, createDefaultProject, previewActive, beginPreview, commitPreview, discardPreview, undo, redo,
  undoHistoryStore, updateProjectBrief, createAlternative, switchPlanAlternative,
} from '$lib/stores/project';
import { BRIEF_CHANGE_ID, BRIEF_MAX_LENGTH, projectBriefForPlan, updateBrief } from '$lib/assistant/brief';
import { runAssistantTool } from '$lib/assistant/tools';
import { assistant, send, applyProposal, discardProposal, newConversation } from '$lib/assistant/session';
import { previewHighlight } from '$lib/stores/planView';
import { undoMessage } from '$lib/i18n/undoMessages';
import { readProject } from '$lib/utils/projectValidation';
import { projectPackageBytes, readProjectPackage } from '$lib/services/projectPackage';
import { createLocalStore } from '$lib/services/datastore';
import { mockStorage } from './fixtures/indexeddb';
import { roomProject } from './fixtures/project';

const brief = () => get(currentProject)!.brief;
const fresh = () => loadProject(createDefaultProject('Brief plan'));

describe('update_brief', () => {
  beforeEach(fresh);

  it('stores the trimmed text and reports a change that outlines nothing', () => {
    const outcome = updateBrief({ text: '  Family of four.\nNo carpets.  ' });
    expect(outcome).toEqual({ text: 'Brief updated.', changed: [BRIEF_CHANGE_ID] });
    expect(brief()).toBe('Family of four.\nNo carpets.');
    // The change id is not an element on any floor, so the plan outlines nothing for it.
    const floor = get(currentProject)!.floors[0];
    expect([...floor.walls, ...floor.furniture, ...floor.doors, ...floor.windows].some(item => item.id === BRIEF_CHANGE_ID)).toBe(false);
  });

  it('is reached through the tool dispatcher', async () => {
    expect(await runAssistantTool('update_brief', { text: 'Budget 20k.' })).toMatchObject({ changed: [BRIEF_CHANGE_ID] });
    expect(brief()).toBe('Budget 20k.');
  });

  it('rejects text that is missing, not a string or too long', () => {
    updateProjectBrief('Keep me.');
    for (const input of [{}, { text: 42 }, { text: ['a'] }, { text: null }]) {
      const outcome = updateBrief(input);
      expect(outcome.isError).toBe(true);
      expect(outcome.changed).toBeUndefined();
    }
    const long = updateBrief({ text: 'x'.repeat(BRIEF_MAX_LENGTH + 1) });
    expect(long.isError).toBe(true);
    expect(long.text).toContain(String(BRIEF_MAX_LENGTH));
    expect(brief()).toBe('Keep me.');
    // Exactly at the cap, counted after trimming.
    expect(updateBrief({ text: ` ${'y'.repeat(BRIEF_MAX_LENGTH)} ` }).isError).toBeFalsy();
    expect(brief()).toHaveLength(BRIEF_MAX_LENGTH);
  });

  it('clears the brief with empty text and reports unchanged text as no change', () => {
    updateProjectBrief('Old notes.');
    expect(updateBrief({ text: 'Old notes.' })).toEqual({ text: 'The brief already says that; nothing changed.' });
    expect(updateBrief({ text: '   ' })).toEqual({ text: 'Brief cleared.', changed: [BRIEF_CHANGE_ID] });
    expect('brief' in get(currentProject)!).toBe(false);
  });

  it('errors without a project', () => {
    currentProject.set(null);
    expect(updateBrief({ text: 'x' }).isError).toBe(true);
    expect(projectBriefForPlan()).toBeNull();
  });
});

describe('projectBriefForPlan', () => {
  beforeEach(fresh);

  it('shows the brief, or says it is empty and how to add one', () => {
    expect(projectBriefForPlan()).toMatch(/^Project brief: \(empty; add one with update_brief/);
    updateProjectBrief('Wheelchair access everywhere.\nKeep the kitchen.');
    expect(projectBriefForPlan()).toBe('Project brief:\nWheelchair access everywhere.\nKeep the kitchen.');
  });
});

describe('updateProjectBrief', () => {
  beforeEach(fresh);

  it('is undoable with a translated history entry, and empty text removes the field', () => {
    updateProjectBrief('First.');
    expect(get(undoHistoryStore).entries.at(-1)?.description).toBe('Changed project brief');
    expect(undoMessage('Changed project brief', 'pt')).toBe('Resumo do projeto alterado');
    undo();
    expect(brief()).toBeUndefined();
    redo();
    expect(brief()).toBe('First.');
    updateProjectBrief('');
    expect('brief' in get(currentProject)!).toBe(false);
    const entries = get(undoHistoryStore).entries.length;
    updateProjectBrief('');
    expect(get(undoHistoryStore).entries).toHaveLength(entries);
  });

  it('is part of a preview: discarding restores the old brief, committing makes one undo step', () => {
    updateProjectBrief('Before.');
    const entries = get(undoHistoryStore).entries.length;
    beginPreview();
    updateBrief({ text: 'During the proposal.' });
    expect(brief()).toBe('During the proposal.');
    discardPreview();
    expect(brief()).toBe('Before.');
    expect(get(undoHistoryStore).entries).toHaveLength(entries);

    beginPreview();
    updateBrief({ text: 'Applied.' });
    commitPreview('Assistant: 1 changed');
    expect(get(previewActive)).toBe(false);
    expect(brief()).toBe('Applied.');
    expect(get(undoHistoryStore).entries).toHaveLength(entries + 1);
    undo();
    expect(brief()).toBe('Before.');
  });

  it('is shared by every plan alternative', () => {
    updateProjectBrief('Shared notes.');
    createAlternative({ name: 'Option B' });
    const project = get(currentProject)!;
    const other = project.alternatives!.find(alt => alt.id !== project.activeAlternativeId)!;
    switchPlanAlternative(other.id);
    expect(brief()).toBe('Shared notes.');
    updateProjectBrief('Changed in B.');
    switchPlanAlternative(get(currentProject)!.alternatives!.find(alt => alt.id !== get(currentProject)!.activeAlternativeId)!.id);
    expect(brief()).toBe('Changed in B.');
  });
});

// ── A brief-only Assistant turn ─────────────────────────────────────

function sse(events: unknown[]): string {
  return events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function reply(blocks: ({ text: string } | { tool: string; input: unknown; id: string })[]) {
  const stop = blocks.some(b => 'tool' in b) ? 'tool_use' : 'end_turn';
  const events: unknown[] = [{ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }];
  blocks.forEach((block, index) => {
    if ('text' in block) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.tool, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 20 } }, { type: 'message_stop' });
  return sse(events);
}

describe('a brief-only turn', () => {
  beforeEach(() => {
    fresh();
    updateProjectBrief('Two adults.');
    newConversation();
  });

  function script(replies: string[]) {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const next = replies.shift();
      return next ? new Response(next, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) : new Response('{}', { status: 500 });
    }));
  }

  const turn = () => script([
    reply([{ tool: 'update_brief', input: { text: 'Two adults.\nNo open kitchen.' }, id: 'a' }]),
    reply([{ text: 'Noted in the brief.' }]),
  ]);

  it('becomes a proposal the person can apply', async () => {
    turn();
    await send('We never want an open kitchen.');
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'proposal', status: 'pending', counts: { changed: 1 } });
    expect(get(previewActive)).toBe(true);
    expect(get(previewHighlight).has(BRIEF_CHANGE_ID)).toBe(true);
    applyProposal();
    expect(brief()).toBe('Two adults.\nNo open kitchen.');
  });

  it('is undone by Not now', async () => {
    turn();
    await send('We never want an open kitchen.');
    discardProposal();
    expect(brief()).toBe('Two adults.');
    expect(get(previewActive)).toBe(false);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('brief persistence', () => {
  beforeEach(() => { mockStorage(); });

  function withBrief() {
    const project = roomProject();
    project.brief = 'For Ana and Rui.\nKeep the fireplace; no carpets.';
    return project;
  }

  it('survives a JSON file round trip and rejects a brief that is not text', () => {
    const project = withBrief();
    expect(readProject(JSON.parse(JSON.stringify(project))).brief).toBe(project.brief);
    expect(readProject(JSON.parse(JSON.stringify(roomProject())))).not.toHaveProperty('brief');
    expect(() => readProject({ ...JSON.parse(JSON.stringify(project)), brief: 7 })).toThrow('brief');
  });

  it('survives saving to and loading from the browser library', async () => {
    const store = createLocalStore(), project = withBrief();
    await store.save(project);
    expect((await store.load(project.id))?.brief).toBe(project.brief);
    const copy = await store.duplicate(project.id);
    expect(copy?.brief).toBe(project.brief);
  });

  it('survives the project package, and a package opened again', () => {
    const project = withBrief();
    const first = readProjectPackage(projectPackageBytes(project)).project;
    expect(first.brief).toBe(project.brief);
    const second = readProjectPackage(projectPackageBytes(first)).project;
    expect(second.brief).toBe(project.brief);
  });

  it('stays separate from the description (the package plan notes)', () => {
    const project = withBrief();
    project.description = 'Printed on the title block.';
    const back = readProjectPackage(projectPackageBytes(project)).project;
    expect(back.description).toBe('Printed on the title block.');
    expect(back.brief).toBe(project.brief);
  });
});
