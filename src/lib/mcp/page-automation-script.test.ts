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
      kind: 'click_coordinates';
      snapshotId: string;
      x: number;
      y: number;
      button: 'left' | 'middle' | 'right';
      clickCount: 1 | 2;
      highlight?: { x: number; y: number; width: number; height: number };
    }
  | { kind: 'evaluate'; script: string }
  | {
      kind: 'upload_files';
      snapshotId: string;
      elementRef: string;
      files: Array<{ name: string; mimeType: string; size: number; bytesBase64: string }>;
    }
  | { kind: 'set_dialog_handler'; action: 'accept' | 'dismiss'; promptText?: string }
  | { kind: 'screenshot_element'; snapshotId: string; elementRef: string; annotate: boolean }
  | { kind: 'screenshot_full_page'; annotate: boolean }
  | { kind: 'screenshot_scroll'; x: number; y: number }
  | { kind: 'screenshot_restore'; x: number; y: number }
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
    action?: {
      kind: string;
      inputTrusted?: boolean;
      value?: unknown;
      files?: Array<{ name: string; size: number }>;
      dialogs?: Array<{ type: string; message: string }>;
      geometry?: Record<string, unknown>;
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
  Event: typeof Event;
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
    const iframe = bridge.window.document.createElement('iframe');
    Object.defineProperties(iframe, {
      contentWindow: { value: source },
      clientWidth: { value: 200 },
      clientHeight: { value: 100 },
      clientLeft: { value: 2 },
      clientTop: { value: 3 },
      getBoundingClientRect: {
        value: () => ({ x: 100, y: 50, width: 204, height: 106 }),
      },
    });
    bridge.window.document.body.appendChild(iframe);
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
                : data.operation?.kind === 'press_key'
                  ? {
                      ok: true,
                      action: {
                        dialogs: [{ type: 'confirm', message: 'Child confirmation' }],
                      },
                    }
                  : data.operation?.kind === 'screenshot_element'
                    ? {
                        ok: true,
                        action: {
                          geometry: {
                            element: { x: 10, y: 10, width: 20, height: 15 },
                            viewport: {
                              viewportWidth: 200,
                              viewportHeight: 100,
                              documentWidth: 200,
                              documentHeight: 100,
                              scrollX: 0,
                              scrollY: 0,
                            },
                          },
                        },
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
    const childElementScreenshot = await dispatch(bridge, {
      kind: 'screenshot_element',
      snapshotId: withChild.snapshotId,
      elementRef: frameElement!.ref,
      annotate: false,
    });
    expect(childElementScreenshot.result.error).toBeUndefined();
    expect(childElementScreenshot.result.action?.geometry).toMatchObject({
      element: { x: 112, y: 63, width: 20, height: 15 },
    });
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
    const childDialog = await dispatch(bridge, { kind: 'press_key', key: 'Enter' });
    expect(childDialog.result.action?.dialogs).toContainEqual({
      type: 'confirm',
      message: 'Child confirmation',
    });

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

  it('accepts nested-frame element geometry relayed through its direct parent', async () => {
    const bridge = install('<h1>Top</h1>');
    const parent = new JSDOM('', { runScripts: 'outside-only', url: 'https://parent.test/' });
    const nested = new JSDOM('', { runScripts: 'outside-only', url: 'https://nested.test/' });
    doms.push(parent, nested);
    const parentSource = parent.window;
    const nestedSource = nested.window;
    const iframe = bridge.window.document.createElement('iframe');
    Object.defineProperties(iframe, {
      contentWindow: { value: parentSource },
      clientWidth: { value: 300 },
      clientHeight: { value: 200 },
      clientLeft: { value: 2 },
      clientTop: { value: 3 },
      getBoundingClientRect: {
        value: () => ({ x: 100, y: 50, width: 304, height: 206 }),
      },
    });
    bridge.window.document.body.appendChild(iframe);
    let nestedFrameId = '';
    let nestedFrameToken = '';

    const respond = (
      source: typeof parentSource,
      requestId: string,
      result: Record<string, unknown>,
    ) => {
      bridge.window.dispatchEvent(
        new bridge.window.MessageEvent('message', {
          source: source as unknown as MessageEventSource,
          data: {
            channel: 'sheltie-mcp-page-automation-v1',
            type: 'frame-response',
            requestId,
            result,
          },
        }),
      );
    };
    vi.spyOn(parentSource, 'postMessage').mockImplementation((message: unknown) => {
      const data = message as { type?: string; requestId?: string; operation?: { kind: string } };
      if (data.type === 'frame-request' && data.operation?.kind === 'snapshot') {
        respond(parentSource, data.requestId!, {
          elements: [],
          compactText: '',
          url: 'https://parent.test/',
          title: 'Parent',
          truncated: false,
        });
      }
    });
    vi.spyOn(nestedSource, 'postMessage').mockImplementation((message: unknown) => {
      const data = message as {
        type?: string;
        frameId?: string;
        frameToken?: string;
        requestId?: string;
        operation?: { kind: string };
      };
      if (data.type === 'frame-assigned') {
        nestedFrameId = data.frameId!;
        nestedFrameToken = data.frameToken!;
      } else if (data.type === 'frame-request' && data.operation?.kind === 'snapshot') {
        respond(nestedSource, data.requestId!, {
          elements: [{ ref: 'e1', role: 'button', name: 'Nested target', tagName: 'BUTTON' }],
          compactText: 'button Nested target',
          url: 'https://nested.test/',
          title: 'Nested',
          truncated: false,
        });
      } else if (data.type === 'frame-request' && data.operation?.kind === 'screenshot_element') {
        bridge.window.dispatchEvent(
          new bridge.window.MessageEvent('message', {
            source: parentSource as unknown as MessageEventSource,
            data: {
              channel: 'sheltie-mcp-page-automation-v1',
              type: 'frame-geometry-relay',
              requestId: data.requestId,
              frameId: nestedFrameId,
              frameToken: nestedFrameToken,
              result: {
                ok: true,
                action: {
                  geometry: {
                    element: { x: 10, y: 12, width: 20, height: 15 },
                    viewport: {
                      viewportWidth: 300,
                      viewportHeight: 200,
                      documentWidth: 300,
                      documentHeight: 200,
                      scrollX: 0,
                      scrollY: 0,
                    },
                  },
                },
              },
            },
          }),
        );
      }
    });
    for (const source of [parentSource, nestedSource]) {
      bridge.window.dispatchEvent(
        new bridge.window.MessageEvent('message', {
          source: source as unknown as MessageEventSource,
          data: { channel: 'sheltie-mcp-page-automation-v1', type: 'frame-ready' },
        }),
      );
    }

    const initial = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const target = initial.elements.find((element) => element.name === 'Nested target')!;
    const result = await dispatch(bridge, {
      kind: 'screenshot_element',
      snapshotId: initial.snapshotId,
      elementRef: target.ref,
      annotate: false,
    });

    expect(result.result.error).toBeUndefined();
    expect(result.result.action?.geometry).toMatchObject({
      element: { x: 112, y: 65, width: 20, height: 15 },
    });
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

  it('dispatches coordinate click events at CSS viewport coordinates and marks them untrusted', async () => {
    const bridge = install('<button id="canvas">Canvas target</button>');
    const target = bridge.window.document.querySelector('#canvas') as HTMLButtonElement;
    let targetLeft = 20;
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ x: targetLeft, y: 30, width: 24, height: 16 }),
    });
    Object.defineProperty(bridge.window, 'requestAnimationFrame', {
      value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    });
    const eventTypes: string[] = [];
    const overlayStyles: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(type, (event) => {
        eventTypes.push(type);
        expect(event.isTrusted).toBe(false);
        if (eventTypes.length === 1) {
          const overlay = bridge.window.document.querySelector(
            '[data-sheltie-mcp-highlight]',
          ) as HTMLElement;
          overlayStyles.push(
            overlay.style.pointerEvents,
            overlay.style.border,
            overlay.style.background,
          );
        }
        if (type === 'click') {
          targetLeft = 50;
          bridge.window.dispatchEvent(new bridge.window.Event('scroll'));
          bridge.window.dispatchEvent(new bridge.window.Event('resize'));
        }
      });
    }
    Object.defineProperty(bridge.window.document, 'elementFromPoint', {
      value: (x: number, y: number) => {
        expect([x, y]).toEqual([30, 40]);
        return target;
      },
    });

    const initial = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const result = await dispatch(bridge, {
      kind: 'click_coordinates',
      snapshotId: initial.snapshotId,
      x: 30,
      y: 40,
      button: 'left',
      clickCount: 1,
      highlight: { x: 20, y: 30, width: 24, height: 16 },
    });

    expect(eventTypes).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(overlayStyles).toEqual([
      'none',
      '2px solid rgb(99, 102, 241)',
      'rgba(99, 102, 241, 0.14)',
    ]);
    expect(result.result.action).toMatchObject({ kind: 'click_coordinates', inputTrusted: false });
    expect(
      (bridge.window.document.querySelector('[data-sheltie-mcp-highlight]') as HTMLElement).style
        .left,
    ).toBe('50px');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bridge.window.document.querySelector('[data-sheltie-mcp-highlight]')).toBeNull();
  });

  it('uses a one-time synchronous dialog policy and resets to safe defaults', async () => {
    const bridge = install('<button>Open dialog</button>');

    const configured = await dispatch(bridge, {
      kind: 'set_dialog_handler',
      action: 'accept',
    });
    expect(configured.result.action).toMatchObject({
      kind: 'set_dialog_handler',
      configured: true,
    });
    expect(configured.result.snapshot).toBeUndefined();
    expect(bridge.window.confirm('Continue?')).toBe(true);
    expect(bridge.window.confirm('Default dismissal')).toBe(false);
    await dispatch(bridge, {
      kind: 'set_dialog_handler',
      action: 'accept',
      promptText: 'Approved',
    });
    expect(bridge.window.prompt('Name?', 'Guest')).toBe('Approved');
    expect(bridge.window.alert('Notice')).toBeUndefined();
    await dispatch(bridge, { kind: 'set_dialog_handler', action: 'accept' });
    expect(bridge.window.prompt('Count?', 0 as unknown as string)).toBe('0');

    const result = await dispatch(bridge, { kind: 'press_key', key: 'Enter' });
    expect(result.result.action?.dialogs).toEqual([
      { type: 'confirm', message: 'Continue?' },
      { type: 'confirm', message: 'Default dismissal' },
      { type: 'prompt', message: 'Name?' },
      { type: 'alert', message: 'Notice' },
      { type: 'prompt', message: 'Count?' },
    ]);
    expect(JSON.stringify(result)).not.toContain('Guest');
  });

  it('bounds dialog metadata and reports omitted entries', async () => {
    const bridge = install('<button>Dialogs</button>');
    for (let index = 0; index < 25; index += 1) {
      bridge.window.alert(`Dialog ${index}`);
    }

    const result = await dispatch(bridge, { kind: 'press_key', key: 'Enter' });

    expect(result.result.action?.dialogs).toHaveLength(20);
    expect(result.result.action?.dialogs?.at(-1)).toEqual({
      type: 'alert',
      message: 'Additional dialogs were omitted.',
    });
  });

  it('evaluates JSON-safe values through the typed operation only', async () => {
    const bridge = install('<main>Evaluate</main>');

    const value = await dispatch(bridge, {
      kind: 'evaluate',
      script: 'Promise.resolve({ ok: true })',
    });
    expect(value.result.action).toMatchObject({ kind: 'evaluate', value: { ok: true } });

    const undefinedResult = await dispatch(bridge, { kind: 'evaluate', script: 'undefined' });
    expect(undefinedResult.result.error).toMatchObject({ code: 'evaluate_not_json' });

    const circularResult = await dispatch(bridge, {
      kind: 'evaluate',
      script: '(() => { const value = {}; value.self = value; return value; })()',
    });
    expect(circularResult.result.error).toMatchObject({ code: 'evaluate_not_json' });

    const unknown = await dispatch(bridge, { kind: 'unknown_evaluate' } as never);
    expect(unknown.result.error).toMatchObject({ code: 'invalid_argument' });

    vi.useFakeTimers();
    const slow = dispatch(bridge, {
      kind: 'evaluate',
      script: 'new Promise(() => {})',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await slow).result.error).toMatchObject({ code: 'evaluate_timeout' });
    vi.useRealTimers();
    expect(snapshot(await dispatch(bridge, { kind: 'snapshot' })).snapshotId).toBeTruthy();
  });

  it('assigns only current file inputs and returns file metadata without bytes', async () => {
    const bridge = install('<input id="upload" type="file"><input id="text">');
    const input = bridge.window.document.querySelector('#upload') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    class TestDataTransfer {
      readonly files: File[] = [];
      readonly items = { add: (file: File) => this.files.push(file) };
    }
    Object.defineProperty(bridge.window, 'DataTransfer', { value: TestDataTransfer });
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [] });

    const initial = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const result = await dispatch(bridge, {
      kind: 'upload_files',
      snapshotId: initial.snapshotId,
      elementRef: initial.elements[0]!.ref,
      files: [{ name: '../secret.txt', mimeType: 'text/plain', size: 2, bytesBase64: 'aGk=' }],
    });
    expect(events).toEqual(['input', 'change']);
    expect(result.result.action).toMatchObject({
      kind: 'upload_files',
      inputTrusted: false,
      files: [{ name: 'secret.txt', size: 2 }],
    });
    expect(JSON.stringify(result)).not.toContain('aGk=');

    const current = snapshot(await dispatch(bridge, { kind: 'snapshot' }));
    const invalid = await dispatch(bridge, {
      kind: 'upload_files',
      snapshotId: current.snapshotId,
      elementRef: current.elements.at(-1)!.ref,
      files: [{ name: 'a.txt', mimeType: 'text/plain', size: 1, bytesBase64: 'YQ==' }],
    });
    expect(invalid.result.error).toMatchObject({ code: 'upload_target_not_file_input' });
  });

  it('reports full-page geometry and scroll helpers restore a saved viewport after two frames', async () => {
    const bridge = install('<main>Long page</main>');
    let x = 11;
    let y = 17;
    Object.defineProperties(bridge.window, {
      innerWidth: { value: 320, configurable: true },
      innerHeight: { value: 240, configurable: true },
      pageXOffset: { get: () => x, configurable: true },
      pageYOffset: { get: () => y, configurable: true },
      scrollTo: {
        value: (options: ScrollToOptions) => {
          expect(options.behavior).toBe('instant');
          expect(bridge.window.document.documentElement.style.scrollBehavior).toBe('auto');
          x = options.left ?? 0;
          y = options.top ?? 0;
        },
        configurable: true,
      },
      requestAnimationFrame: {
        value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
        configurable: true,
      },
    });
    Object.defineProperties(bridge.window.document.documentElement, {
      scrollWidth: { value: 640, configurable: true },
      scrollHeight: { value: 960, configurable: true },
    });

    const geometry = await dispatch(bridge, { kind: 'screenshot_full_page', annotate: false });
    expect(geometry.result.snapshot).toBeUndefined();
    expect(geometry.result.action?.geometry).toMatchObject({
      viewportWidth: 320,
      viewportHeight: 240,
      documentWidth: 640,
      documentHeight: 960,
      scrollX: 11,
      scrollY: 17,
    });
    await dispatch(bridge, { kind: 'screenshot_scroll', x: 0, y: 239 });
    expect([x, y]).toEqual([0, 239]);
    await dispatch(bridge, { kind: 'screenshot_restore', x: 11, y: 17 });
    expect([x, y]).toEqual([11, 17]);
    expect(bridge.window.document.documentElement.style.scrollBehavior).toBe('');

    Object.defineProperty(bridge.window, 'requestAnimationFrame', {
      value: () => 0,
      configurable: true,
    });
    vi.useFakeTimers();
    const throttled = dispatch(bridge, { kind: 'screenshot_scroll', x: 0, y: 100 });
    await vi.advanceTimersByTimeAsync(250);
    await throttled;
    expect([x, y]).toEqual([0, 100]);
  });
});
