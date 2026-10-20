/**
 * Version of the saved plan format, stamped into every plan this build saves (`formatVersion`).
 *
 * Bump it whenever a change adds or changes plan data that an older build would drop, misread or
 * overwrite with something wrong. An older build (a stale deployment, a cached tab on another device)
 * can then still show such a plan, but refuses to save it and never lets library sync overwrite it in
 * the cloud (docs/cloud-sync.md). Plans saved before stamping began read as format 0.
 */
export const PROJECT_FORMAT = 1;

/** The format a plan, or its JSON text, was saved in. */
export function projectFormat(value: unknown): number {
  let plan = value;
  if (typeof value === 'string') {
    try { plan = JSON.parse(value); } catch { return 0; }
  }
  const format = (plan as { formatVersion?: unknown } | null)?.formatVersion;
  return typeof format === 'number' && Number.isInteger(format) && format > 0 ? format : 0;
}

export const isNewerFormat = (value: unknown) => projectFormat(value) > PROJECT_FORMAT;
