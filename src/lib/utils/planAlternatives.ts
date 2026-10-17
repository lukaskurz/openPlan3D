import type { Floor, PlanAlternative, Project } from '$lib/models/types';

/** Floors of every alternative (the live ones first). Use this wherever a check
 * must not drop data that another alternative still uses, e.g. models or photos. */
export function allPlanFloors(project: Project): Floor[] {
  return [...project.floors, ...inactiveAlternatives(project).flatMap(alt => alt.floors)];
}

export function inactiveAlternatives(project: Project): PlanAlternative[] {
  return (project.alternatives ?? []).filter(alt => alt.id !== project.activeAlternativeId);
}

export function activeAlternative(project: Project): PlanAlternative | undefined {
  return project.alternatives?.find(alt => alt.id === project.activeAlternativeId);
}

// ── Version codes (spec §4.7) ────────────────────────────────────────
// Every alternative has a short code shown in the version badge: a letter part
// (A … Z, then AA … ZZ) for a new alternative, plus a number for a branch
// (A → A1, A1 → A2, B → B1). Codes are stored and never change on rename; the
// display name stays free text. Without `alternatives` the plan is implicitly "A".

/** A version code: one or two capital letters, optionally followed by a number from 1. */
export const CODE = /^([A-Z]{1,2})([1-9]\d*)?$/;

/** The code the plan has while it has no alternatives, and that the kept original gets. */
export const FIRST_CODE = 'A';

/** The n-th letter code: A … Z, then AA, AB, … ZZ. */
function letterCode(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
}

/** The letter part of a code ('A1' → 'A'), or null when it is not a code. */
export function codeLetters(code: string | undefined): string | null {
  return code ? CODE.exec(code)?.[1] ?? null : null;
}

/** The first letter code whose letter part no alternative uses yet (A–D and A1 taken → E). */
export function nextLetterCode(alternatives: readonly { code?: string }[]): string {
  const used = new Set(alternatives.map(alt => codeLetters(alt.code)));
  for (let i = 0; ; i++) if (!used.has(letterCode(i))) return letterCode(i);
}

/** The code a branch of `fromCode` gets: its letter part plus the lowest unused number
 * (A → A1, A1 → A2 when A1 exists, B → B1). Never longer than letters plus number. */
export function branchCode(alternatives: readonly { code?: string }[], fromCode: string): string {
  const letters = codeLetters(fromCode) ?? FIRST_CODE;
  const used = new Set(alternatives.map(alt => alt.code));
  for (let n = 1; ; n++) if (!used.has(`${letters}${n}`)) return `${letters}${n}`;
}

/** Default names of earlier versions ("Option C", "Opção C") name their letter. */
const DEFAULT_NAME = /^(?:Option|Opção)\s+([A-Z]{1,2})$/;

/** The letter a legacy name stands for: exactly one letter, or a default name. */
function nameLetter(name: string): string | null {
  const trimmed = name.trim();
  if (/^[A-Za-z]$/.test(trimmed)) return trimmed.toUpperCase();
  return DEFAULT_NAME.exec(trimmed)?.[1] ?? null;
}

/**
 * Codes for a list of alternatives, id → code, without changing them (spec §4.7
 * migration rule). A valid stored code is kept unless an earlier entry already has
 * it; then a name that is exactly one letter, or a default name like "Option C",
 * keeps that letter; every other entry gets the next unused letter in list order.
 */
export function assignAlternativeCodes(alternatives: readonly { id: string; name: string; code?: string }[]): Map<string, string> {
  const codes = new Map<string, string>();
  const used = new Set<string>();
  const give = (id: string, code: string) => { codes.set(id, code); used.add(code); };
  for (const alt of alternatives) if (alt.code && CODE.test(alt.code) && !used.has(alt.code)) give(alt.id, alt.code);
  for (const alt of alternatives) {
    const letter = codes.has(alt.id) ? null : nameLetter(alt.name);
    if (letter && !used.has(letter)) give(alt.id, letter);
  }
  for (const alt of alternatives) {
    if (!codes.has(alt.id)) give(alt.id, nextLetterCode([...used].map(code => ({ code }))));
  }
  return codes;
}

/** Give every alternative a valid, unique code (migration of projects from before
 * codes were stored). Idempotent; returns the project. */
export function ensureAlternativeCodes(project: Project): Project {
  if (!project.alternatives?.length) return project;
  const codes = assignAlternativeCodes(project.alternatives);
  for (const alt of project.alternatives) alt.code = codes.get(alt.id);
  return project;
}

/** Put the live floors away into the active alternative's entry. */
function stash(project: Project, now: Date, thumbnail?: string) {
  const current = activeAlternative(project);
  if (!current) return;
  current.floors = structuredClone(project.floors);
  current.activeFloorId = project.activeFloorId;
  current.updatedAt = now;
  if (thumbnail) current.thumbnail = thumbnail;
}

export interface BranchOptions {
  id: string;
  /** Id for the entry that keeps the current plan when the first alternative is made. */
  originalId: string;
  now: Date;
  thumbnail?: string;
  /** Default name of a new alternative from its code, e.g. "Option C". Also names the kept original. */
  nameFor: (letter: string) => string;
  /** Default name of a branch from its parent's code, e.g. "Copy of A". */
  copyNameFor?: (code: string) => string;
  name?: string;
  /** 'branch' continues the active alternative's line (A → A1); 'new' starts the next letter (default). */
  kind?: 'branch' | 'new';
}

/** Keep the current plan as it is and continue in a new alternative that starts as a copy of it. */
export function branchAlternative(project: Project, options: BranchOptions): PlanAlternative {
  if (!project.alternatives?.length) {
    project.alternatives = [{ id: options.originalId, name: options.nameFor(FIRST_CODE), code: FIRST_CODE, floors: [], activeFloorId: project.activeFloorId, updatedAt: options.now }];
    project.activeAlternativeId = options.originalId;
  }
  ensureAlternativeCodes(project);
  stash(project, options.now, options.thumbnail);
  const alternatives = project.alternatives!;
  const parentCode = activeAlternative(project)?.code ?? FIRST_CODE;
  const branch = options.kind === 'branch';
  const code = branch ? branchCode(alternatives, parentCode) : nextLetterCode(alternatives);
  const defaultName = branch ? (options.copyNameFor?.(parentCode) ?? `Copy of ${parentCode}`) : options.nameFor(code);
  // The live floors stay as they are: they are now the new alternative's copy.
  const created: PlanAlternative = {
    id: options.id,
    name: options.name?.trim() || defaultName,
    code, ...(branch ? { parentCode } : {}),
    floors: [], activeFloorId: project.activeFloorId, updatedAt: options.now,
  };
  const at = alternatives.findIndex(alt => alt.id === project.activeAlternativeId);
  alternatives.splice(at + 1, 0, created);
  project.activeAlternativeId = created.id;
  return created;
}

/** Make another alternative the live plan. Returns false when there is nothing to switch. */
export function switchAlternative(project: Project, id: string, now: Date, thumbnail?: string): boolean {
  const target = project.alternatives?.find(alt => alt.id === id);
  if (!target || id === project.activeAlternativeId || !target.floors.length) return false;
  stash(project, now, thumbnail);
  project.floors = target.floors;
  project.activeFloorId = target.floors.some(floor => floor.id === target.activeFloorId) ? target.activeFloorId : target.floors[0].id;
  target.floors = [];
  project.activeAlternativeId = id;
  return true;
}

export function renameAlternative(project: Project, id: string, name: string): boolean {
  const alt = project.alternatives?.find(alt => alt.id === id);
  const trimmed = name.trim();
  if (!alt || !trimmed || alt.name === trimmed) return false;
  alt.name = trimmed;
  return true;
}

/** Remove an alternative. Removing the active one switches to its neighbour first;
 * when only one is left the plan goes back to having no alternatives, and so is
 * implicitly "A" again. The others keep their codes. */
export function deleteAlternative(project: Project, id: string, now: Date): boolean {
  const list = project.alternatives;
  const index = list?.findIndex(alt => alt.id === id) ?? -1;
  if (!list || index < 0 || list.length < 2) return false;
  if (id === project.activeAlternativeId) switchAlternative(project, list[index + 1]?.id ?? list[index - 1].id, now);
  list.splice(list.findIndex(alt => alt.id === id), 1);
  if (list.length === 1) {
    delete project.alternatives;
    delete project.activeAlternativeId;
  }
  return true;
}
