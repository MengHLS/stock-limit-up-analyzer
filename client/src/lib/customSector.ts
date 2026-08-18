export function normalizeCustomSector(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}
