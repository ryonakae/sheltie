import { describe, expect, it } from 'vitest';

import { isAllowedPageUrl, normalizeUrl } from '@/lib/url-utils';

describe('normalizeUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });

  it('keeps an explicit http scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('allows localhost without a dot', () => {
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173/');
  });

  it('rejects a hostname without a dot', () => {
    expect(normalizeUrl('aaaaa')).toBeNull();
  });

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});

describe('isAllowedPageUrl', () => {
  it('allows an empty string as a URL-less WebPage node', () => {
    expect(isAllowedPageUrl('')).toBe(true);
  });

  it('allows http and https', () => {
    expect(isAllowedPageUrl('https://example.com')).toBe(true);
    expect(isAllowedPageUrl('http://127.0.0.1:8080/path?q=1')).toBe(true);
  });

  it('allows a hostname without a dot, unlike the URL bar policy', () => {
    expect(isAllowedPageUrl('http://intranet/')).toBe(true);
  });

  it('rejects schemes that must never reach a native webview', () => {
    expect(isAllowedPageUrl('file:///Users/victim/.ssh/id_rsa')).toBe(false);
    expect(isAllowedPageUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPageUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isAllowedPageUrl('tauri://localhost')).toBe(false);
    expect(isAllowedPageUrl('asset://localhost/x.png')).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    expect(isAllowedPageUrl('example.com')).toBe(false);
    expect(isAllowedPageUrl('   ')).toBe(false);
  });
});
