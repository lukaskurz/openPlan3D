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

/** A, B, … Z, then AA, AB, …, skipping letters whose default name is taken. */
export function nextAlternativeLetter(project: Project, nameFor: (letter: string) => string): string {
  const taken = new Set((project.alternatives ?? []).map(alt => alt.name));
  for (let i = 0; ; i++) {
    const letter = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
    if (!taken.has(nameFor(letter))) return letter;
  }
}

/** The n-th code letter: A … Z, then AA, AB, … like `nextAlternativeLetter`. */
function codeLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
}

/**
 * Short codes for the version badge ('A', 'B', …), derived until codes are stored
 * (spec §4.7 migration rule): a name that is exactly one letter A–Z keeps that
 * letter, as does a default name (`nameFor(letter)`, e.g. "Option C") when given;
 * every other alternative gets the next unused letter in list order.
 * Returns id → code.
 */
export function alternativeCodes(alternatives: readonly Pick<PlanAlternative, 'id' | 'name'>[], nameFor?: (letter: string) => string): Map<string, string> {
  const codes = new Map<string, string>();
  const used = new Set<string>();
  const ownLetter = (name: string): string | null => {
    const trimmed = name.trim();
    if (/^[A-Za-z]$/.test(trimmed)) return trimmed.toUpperCase();
    if (!nameFor) return null;
    for (let i = 0; i < 26; i++) if (nameFor(codeLetter(i)) === trimmed) return codeLetter(i);
    return null;
  };
  for (const alt of alternatives) {
    const letter = ownLetter(alt.name);
    if (letter && !used.has(letter)) { codes.set(alt.id, letter); used.add(letter); }
  }
  let next = 0;
  for (const alt of alternatives) {
    if (codes.has(alt.id)) continue;
    while (used.has(codeLetter(next))) next++;
    codes.set(alt.id, codeLetter(next));
    used.add(codeLetter(next));
  }
  return codes;
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
  nameFor: (letter: string) => string;
  name?: string;
}

/** Keep the current plan as it is and continue in a new alternative that starts as a copy of it. */
export function branchAlternative(project: Project, options: BranchOptions): PlanAlternative {
  if (!project.alternatives?.length) {
    project.alternatives = [{ id: options.originalId, name: options.nameFor('A'), floors: [], activeFloorId: project.activeFloorId, updatedAt: options.now }];
    project.activeAlternativeId = options.originalId;
  }
  stash(project, options.now, options.thumbnail);
  // The live floors stay as they are: they are now the new alternative's copy.
  const created: PlanAlternative = {
    id: options.id,
    name: options.name?.trim() || options.nameFor(nextAlternativeLetter(project, options.nameFor)),
    floors: [], activeFloorId: project.activeFloorId, updatedAt: options.now,
  };
  const at = project.alternatives!.findIndex(alt => alt.id === project.activeAlternativeId);
  project.alternatives!.splice(at + 1, 0, created);
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
 * when only one is left the plan goes back to having no alternatives. */
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
