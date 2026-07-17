import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const script = readFileSync(
  new URL('../../../src-tauri/src/commands/webview/page_automation_script.js', import.meta.url),
  'utf8',
);

type Operation =
  | { kind: 'snapshot' }
  | { kind: 'click'; snapshotId: string; elementRef: string }
  | { kind: 'fill'; snapshotId: string; elementRef: string; text: string }
  | {
      kind: 'fill_form';
      snapshotId: string;
      fields: Array<{ elementRef: string; text: string }>;
    }
  | { kind: 'select_option'; snapshotId: string; elementRef: string; values: string[] }
  | { kind: 'press_key'; key: string }
  | { kind: 'scroll'; deltaX: number; deltaY: number }
  | {
      kind: 'wait';
      condition:
        | { kind: 'time'; milliseconds: number }
        | { kind: 'url'; contains: string }
        | { kind: 'selector'; selector: string }
        | { kind: 'text'; text: string };
      timeoutMs: number;
    };

type BridgeResult = {
  requestId: string;
  documentId: string;
  pageNodeId: string;
  result: {
    snapshot?: {
      documentToken: string;
      elements: Array<{ ref: string; role: string; name: string; value?: string }>;
      compactText: string;
      navigationEpoch: number;
      snapshotId: string;
      frames: Array<{ frameId: string; status: string }>;
    };
    error?: { code: string };
  };
};

type BridgeWindow = Window & {
  __SHELTIE_MCP_PAGE_AUTOMATION__: {
    dispatch: (request: {
      requestId: string;
      documentId: string;
      pageNodeId: string;
      navigationEpoch: number;
      operation: Operation;
    }) => Promise<unknown>;
  };
  __TAURI__: {
    core: { invoke: (command: string, payload: { result: BridgeResult }) => Promise<void> };
  };
  eval: (source: string) => unknown;
  MessageEvent: typeof MessageEvent;
};

const doms: JSDOM[] = [];

afterEach(() => {
  for (const dom of doms.splice(0)) dom.window.close();
  vi.useRealTimers();
});

function install(html: string, url = 'https://example.test/page', tokenBytes?: number[]) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  doms.push(dom);
  const window = dom.window as unknown as BridgeWindow;
  if (tokenBytes) {
    Object.defineProperty(window.crypto, 'getRandomValues', {
      configurable: true,
      value: (bytes: Uint8Array) => {
        bytes.set(tokenBytes);
        return bytes;
      },
    });
  }
  const results: BridgeResult[] = [];
  window.__TAURI__ = {
    core: {
      invoke: async (_command, payload) => {
        results.push(payload.result);
      },
    },
  };
  window.eval(script);
  return { window, results };
}

async function dispatch(
  bridge: ReturnType<typeof install>,
  operation: Operation,
  navigationEpoch = 3,
): Promise<BridgeResult> {
  await bridge.window.__SHELTIE_MCP_PAGE_AUTOMATION__.dispatch({
    requestId: `request-${bridge.results.length + 1}`,
    documentId: 'document-test',
    pageNodeId: 'page-test',
    navigationEpoch,
    operation,
  });
  const result = bridge.results.at(-1);
  if (!result) throw new Error('The bridge did not complete the request');
  return result;
}

function snapshot(result: BridgeResult) {
  const value = result.result.snapshot;
  if (!value) throw new Error('Expected a compact snapshot');
  return value;
}

describe('page automation initialization script', () => {
  it('emits semantic controls with normalized text and never exposes hidden or password values', async () => {
    const bridge = install(`
      <main aria-label="Main area">
        <h1>  Account\n settings </h1>
        <label for="email">Email address</label><input id="email" value="me@example.test">
        <button> Save\n changes </button>
        <input type="password" value="not-visible">
        <button hidden>Hidden action</button>
      </main>
    `);

    const result = snapshot(await dispatch(bridge, { kind: 'snapshot' }));

    expect(result.elements).toMatchObject([
      { ref: 'e1', role: 'main', name: 'Main area' },
      { ref: 'e2', role: 'heading', name: 'Account settings' },
      { ref: 'e3', role: 'label', name: 'Email address' },
      { ref: 'e4', role: 'textbox', name: 'Email address', value: 'me@example.test' },
      { ref: 'e5', role: 'button', name: 'Save changes' },
      { ref: 'e6', role: 'textbox', name: '' },
    ]);
    expect(result.elements.some((element) => element.name === 'Hidden action')).toBe(false);
    expect(result.elements.find((element) => element.ref === 'e6')).not.toHaveProperty('value');
    expect(result.compactText).toContain('Account settings');
  });

  it('invalidates old references before dispatching click events', async () => {
    const bridge = install('<button id="save">Save</button>');
    const button = bridge.window.document.querySelector('#save') as HTMLButtonElement;
    const click = vi.fn();
    button.addEventListener('click', click);

    const first = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    await dispatch(bridge, { kind: 'snapshot' });
    const result = await dispatch(bridge, {
      kind: 'click',
      snapshotId: 's3-1',
      elementRef: first.elements[0]!.ref,
    });

    expect(result.result.error).toMatchObject({ code: 'stale_element' });
    expect(click).not.toHaveBeenCalled();
  });

  it('fills controls with native events and validates all FillForm refs before mutation', async () => {
    const bridge = install('<input id="first"><input id="second">');
    const first = bridge.window.document.querySelector('#first') as HTMLInputElement;
    const events: string[] = [];
    first.addEventListener('input', () => events.push('input'));
    first.addEventListener('change', () => events.push('change'));

    const initial = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    await dispatch(bridge, {
      kind: 'fill',
      snapshotId: 's3-1',
      elementRef: initial.elements[0]!.ref,
      text: 'Ada',
    });
    expect(first.value).toBe('Ada');
    expect(events).toEqual(['input', 'change']);

    const current = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const result = await dispatch(bridge, {
      kind: 'fill_form',
      snapshotId: 's3-3',
      fields: [
        { elementRef: current.elements[0]!.ref, text: 'Changed' },
        { elementRef: 'e999', text: 'No mutation' },
      ],
    });
    expect(result.result.error).toMatchObject({ code: 'element_not_found' });
    expect(first.value).toBe('Ada');
  });

  it('selects native options and rejects non-select targets', async () => {
    const bridge = install(
      '<select><option value="a">A</option><option value="b">B</option></select><button>Save</button>',
    );
    const select = bridge.window.document.querySelector('select') as HTMLSelectElement;
    const initial = snapshot(await dispatch(bridge, { kind: 'snapshot' }));

    await dispatch(bridge, {
      kind: 'select_option',
      snapshotId: 's3-1',
      elementRef: initial.elements[0]!.ref,
      values: ['b'],
    });
    expect(select.value).toBe('b');

    const current = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const invalid = await dispatch(bridge, {
      kind: 'select_option',
      snapshotId: current.snapshotId,
      elementRef: current.elements.find((element) => element.role === 'button')!.ref,
      values: ['b'],
    });
    expect(invalid.result.error).toMatchObject({ code: 'element_not_interactable' });
  });

  it('dispatches key event triplets and scrolls by the requested deltas', async () => {
    const bridge = install('<button>Focus</button>');
    const keys: string[] = [];
    bridge.window.document.body.addEventListener('keydown', (event) =>
      keys.push(`down:${event.key}`),
    );
    bridge.window.document.body.addEventListener('keypress', (event) =>
      keys.push(`press:${event.key}`),
    );
    bridge.window.document.body.addEventListener('keyup', (event) => keys.push(`up:${event.key}`));
    const scrollBy = vi.fn();
    Object.defineProperty(bridge.window, 'scrollBy', { value: scrollBy });

    await dispatch(bridge, { kind: 'press_key', key: 'Enter' });
    await dispatch(bridge, { kind: 'scroll', deltaX: -20, deltaY: 40 });

    expect(keys).toEqual(['down:Enter', 'press:Enter', 'up:Enter']);
    expect(scrollBy).toHaveBeenCalledWith({ left: -20, top: 40, behavior: 'instant' });
  });

  it('routes registered child responses and actions by WindowProxy and reports unavailable children', async () => {
    const bridge = install('<h1>Top</h1>');
    const child = new JSDOM('', { runScripts: 'outside-only', url: 'https://child.test/' });
    doms.push(child);
    const source = child.window;
    let childClicked = false;
    let childFormFilled = false;
    vi.spyOn(source, 'postMessage').mockImplementation((message: unknown) => {
      const data = message as {
        requestId?: string;
        type?: string;
        operation?: { kind: string };
      };
      if (data.type !== 'frame-request') return;
      if (data.operation?.kind === 'click') childClicked = true;
      if (data.operation?.kind === 'fill_form') childFormFilled = true;
      bridge.window.dispatchEvent(
        new bridge.window.MessageEvent('message', {
          source: source as unknown as MessageEventSource,
          data: {
            channel: 'sheltie-mcp-page-automation-v1',
            type: 'frame-response',
            requestId: data.requestId,
            result:
              data.operation?.kind === 'snapshot'
                ? {
                    elements: [
                      { ref: 'e1', role: 'button', name: 'Frame action', tagName: 'BUTTON' },
                      { ref: 'e2', role: 'textbox', name: 'Frame field', tagName: 'INPUT' },
                    ],
                    compactText: 'button Frame action',
                    url: 'https://child.test/',
                    title: 'Child',
                    truncated: false,
                  }
                : { ok: true },
          },
        }),
      );
    });
    bridge.window.dispatchEvent(
      new bridge.window.MessageEvent('message', {
        source: source as unknown as MessageEventSource,
        data: { channel: 'sheltie-mcp-page-automation-v1', type: 'frame-ready' },
      }),
    );

    const withChild = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const frameElement = withChild.elements.find((element) => element.ref === 'f1:e1');
    expect(frameElement).toEqual(expect.objectContaining({ name: 'Frame action' }));
    const afterClick = snapshot(
      await dispatch(bridge, {
        kind: 'click',
        snapshotId: withChild.snapshotId,
        elementRef: frameElement!.ref,
      }),
    );
    expect(childClicked).toBe(true);
    await dispatch(bridge, {
      kind: 'fill_form',
      snapshotId: afterClick.snapshotId,
      fields: [
        {
          elementRef: afterClick.elements.find((element) => element.ref === 'f1:e2')!.ref,
          text: 'Frame value',
        },
      ],
    });
    expect(childFormFilled).toBe(true);

    const unregistered = new JSDOM('', { runScripts: 'outside-only' });
    doms.push(unregistered);
    bridge.window.dispatchEvent(
      new bridge.window.MessageEvent('message', {
        source: unregistered.window as unknown as MessageEventSource,
        data: {
          channel: 'sheltie-mcp-page-automation-v1',
          type: 'frame-response',
          requestId: 'request-2',
          result: { elements: [{ ref: 'e1', role: 'button', name: 'Ignored', tagName: 'BUTTON' }] },
        },
      }),
    );
    source.postMessage = (() => undefined) as typeof source.postMessage;
    vi.useFakeTimers();
    const pending = dispatch(bridge, { kind: 'snapshot' });
    await vi.advanceTimersByTimeAsync(750);
    const unavailable = snapshot(await pending);
    expect(unavailable.elements.some((element) => element.name === 'Ignored')).toBe(false);
    expect(unavailable.frames).toContainEqual(
      expect.objectContaining({ frameId: 'f1', status: 'unavailable' }),
    );
  });

  it('does not satisfy text waits from hidden content', async () => {
    const bridge = install('<div hidden>Secret ready text</div><div>Visible text</div>');

    const result = await dispatch(bridge, {
      kind: 'wait',
      condition: { kind: 'text', text: 'Secret ready text' },
      timeoutMs: 100,
    });
    expect(result.result.error).toMatchObject({ code: 'wait_timeout' });
  });

  it('keeps a per-document token stable and echoes the actor navigation epoch', async () => {
    const first = install(
      '<button>One</button>',
      'https://first.test/',
      Array.from({ length: 16 }, (_, index) => index),
    );
    const second = install(
      '<button>Two</button>',
      'https://second.test/',
      Array.from({ length: 16 }, (_, index) => index + 16),
    );

    const firstSnapshot = snapshot(await dispatch(first, { kind: 'snapshot' }, 7));
    const secondSnapshot = snapshot(await dispatch(first, { kind: 'snapshot' }, 8));
    const otherDocument = snapshot(await dispatch(second, { kind: 'snapshot' }, 7));

    expect(firstSnapshot.documentToken).toBe('000102030405060708090a0b0c0d0e0f');
    expect(secondSnapshot.documentToken).toBe(firstSnapshot.documentToken);
    expect(otherDocument.documentToken).toBe('101112131415161718191a1b1c1d1e1f');
    expect(firstSnapshot.navigationEpoch).toBe(7);
    expect(secondSnapshot.navigationEpoch).toBe(8);
  });
});
