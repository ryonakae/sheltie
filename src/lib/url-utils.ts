/** URL を正規化する（scheme がなければ https:// を補完） */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(normalized);

    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!parsed.hostname) return null;

    // ドットを含まない単純文字列（例: "aaaaa"）は無効。ただし localhost と IP アドレスは許可
    const hostname = parsed.hostname;
    if (hostname !== 'localhost' && !hostname.includes('.')) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}
