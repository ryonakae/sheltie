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

/**
 * 文書ファイル・MCP 経由で受け取る WebPage URL の許可判定。
 * ネイティブ Webview へ渡る値なので http / https だけを許可する。
 * 空文字は URL 未入力の WebPage ノードという正当な状態なので許可する。
 * URL バー用の normalizeUrl とは違い、ドットを含まないホスト名は拒否しない。
 */
export function isAllowedPageUrl(value: string): boolean {
  if (value === '') return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
