export interface ExplicitFieldMatch {
  field: string;
  aliases: string[];
}

export interface ExplicitFieldExtraction {
  matchedFields: string[];
  collectedFields: Record<string, string>;
}

const GENERIC_NAME_PREFIX = 'tên ';
const TRAILING_FILLER = /(?:\s|[.,;:!?])+(?:nhé|nhá|nha|ạ)(?:\s|[.,;:!?])*$/iu;
const LEADING_VALUE_CONNECTOR = /^(?:\s|[:\-–—])*(?:(?:của\s+(?:anh|chị|em|tôi|mình|bạn)\s+)?là\s+)?/iu;

/** Normalizes field labels and messages for conservative alias comparisons. */
export function normalizeFieldText(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Produces only aliases that remain semantically tied to the configured field.
 * In particular, a leading "Tên" may be omitted, which makes "Tên NPP" match
 * the common explicit form "NPP ..." without inventing broad synonyms.
 */
export function aliasesForRequiredField(field: string): string[] {
  const normalized = normalizeFieldText(field);
  if (!normalized) return [];

  const aliases = new Set([normalized]);
  if (normalized.startsWith(GENERIC_NAME_PREFIX)) {
    const suffix = normalized.slice(GENERIC_NAME_PREFIX.length).trim();
    if (suffix) aliases.add(suffix);
  }
  for (const acronym of field.match(/\b[A-Z\d]{2,}\b/g) ?? []) {
    aliases.add(normalizeFieldText(acronym));
  }

  return [...aliases].sort((left, right) => right.length - left.length);
}

export function explicitFieldMatches(requiredFields: string[]): ExplicitFieldMatch[] {
  return requiredFields
    .map((field) => ({ field, aliases: aliasesForRequiredField(field) }))
    .filter((match) => match.aliases.length > 0);
}

export function extractExplicitFieldValues(message: string, requiredFields: string[]): ExplicitFieldExtraction {
  const matches = explicitFieldMatches(requiredFields);
  const occurrences = matches.flatMap((match) =>
    match.aliases.flatMap((alias) => findAliasOccurrences(message, alias).map((occurrence) => ({ ...occurrence, field: match.field }))),
  );
  const fieldOccurrences = deduplicateFieldOccurrences(occurrences).sort((left, right) => left.start - right.start);
  const matchedFields = [...new Set(fieldOccurrences.map((occurrence) => occurrence.field))];
  const collectedFields: Record<string, string> = {};

  for (const [index, occurrence] of fieldOccurrences.entries()) {
    const nextField = fieldOccurrences.slice(index + 1).find((candidate) => candidate.start >= occurrence.end);
    const rawValue = message.slice(occurrence.end, nextField?.start);
    const value = cleanExplicitValue(rawValue);
    if (value) collectedFields[occurrence.field] = value;
  }

  return { matchedFields, collectedFields };
}

interface AliasOccurrence {
  start: number;
  end: number;
}

function findAliasOccurrences(message: string, alias: string): AliasOccurrence[] {
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapedAlias})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  const occurrences: AliasOccurrence[] = [];
  let found: RegExpExecArray | null;
  while ((found = expression.exec(message)) !== null) {
    const matchedAlias = found[2];
    const start = found.index + found[0].lastIndexOf(matchedAlias);
    occurrences.push({ start, end: start + matchedAlias.length });
  }
  return occurrences;
}

function deduplicateFieldOccurrences<T extends AliasOccurrence & { field: string }>(occurrences: T[]): T[] {
  const byFieldAndStart = new Map<string, T>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.field}:${occurrence.start}`;
    const current = byFieldAndStart.get(key);
    if (!current || occurrence.end > current.end) byFieldAndStart.set(key, occurrence);
  }
  return [...byFieldAndStart.values()];
}

function cleanExplicitValue(rawValue: string): string | null {
  const beforeSeparator = rawValue.split(/[,;\n]/u, 1)[0] ?? '';
  const withoutConnector = beforeSeparator.replace(LEADING_VALUE_CONNECTOR, '');
  const withoutFiller = withoutConnector.replace(TRAILING_FILLER, '');
  const value = withoutFiller.replace(/^[\s:–—-]+|[\s:–—-]+$/gu, '').trim();
  return value || null;
}
