(function installSheltiePageAutomationBridge() {
  'use strict';

  const CHANNEL = 'sheltie-mcp-page-automation-v1';
  const FRAME_RESPONSE_TIMEOUT_MS = 750;
  const SETTLE_DELAY_MS = 250;
  const WAIT_POLL_MS = 50;
  const MAX_ELEMENTS = 200;
  const MAX_CHARS = 20_000;
  const MAX_TEXT_CHARS = 512;
  const isTopFrame = window.top === window;
  const state = {
    documentToken: createDocumentToken(),
    snapshotSequence: 0,
    currentSnapshotId: null,
    elements: new Map(),
    frames: new Map(),
    nextFrameId: 1,
    nextFrameRequestSequence: 1,
    pendingFrameRequests: new Map(),
  };

  function createDocumentToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function complete(result) {
    if (!isTopFrame) return;
    return window.__TAURI__.core.invoke('complete_page_automation_request', { result });
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(value, limit) {
    const text = String(value || '');
    if (text.length <= limit) return text;
    const end = text.charCodeAt(limit - 1);
    return text.slice(0, end >= 0xd800 && end <= 0xdbff ? limit - 1 : limit);
  }

  function isPasswordOrOtp(element) {
    return (
      (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') ||
      (element.getAttribute('autocomplete') || '').toLowerCase().includes('one-time-code')
    );
  }

  function isVisible(element) {
    for (let current = element; current instanceof Element; current = current.parentElement) {
      if (
        current.hidden ||
        current.inert ||
        current.getAttribute('aria-hidden') === 'true' ||
        current.hasAttribute('hidden')
      ) {
        return false;
      }
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        return false;
      }
    }
    return true;
  }

  function roleFor(element) {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'main' || tag === 'nav' || tag === 'aside' || tag === 'header' || tag === 'footer')
      return tag;
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image')
        return 'button';
      return 'textbox';
    }
    if (element.getAttribute('contenteditable') === 'true') return 'textbox';
    return tag;
  }

  function nameFor(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) return truncate(ariaLabel, MAX_TEXT_CHARS);
    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const text = labelledBy
        .split(' ')
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((target) => normalizeText(target.textContent))
        .join(' ');
      if (text) return truncate(text, MAX_TEXT_CHARS);
    }
    if ('labels' in element && element.labels && element.labels.length) {
      const text = Array.from(element.labels)
        .map((label) => normalizeText(label.textContent))
        .join(' ');
      if (text) return truncate(text, MAX_TEXT_CHARS);
    }
    const text = normalizeText(element.textContent);
    if (text) return truncate(text, MAX_TEXT_CHARS);
    const alt = normalizeText(element.getAttribute('alt'));
    if (alt) return truncate(alt, MAX_TEXT_CHARS);
    const title = normalizeText(element.getAttribute('title'));
    if (title) return truncate(title, MAX_TEXT_CHARS);
    return truncate(normalizeText(element.getAttribute('placeholder')), MAX_TEXT_CHARS);
  }

  function candidateElements() {
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex^="-"])',
      'h1, h2, h3, h4, h5, h6',
      'label',
      'main, nav, aside, header, footer',
    ].join(',');
    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  }

  function elementData(element, ref, frameId) {
    const data = {
      ref,
      role: roleFor(element),
      name: nameFor(element),
      tagName: element.tagName,
      frameId,
    };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (!isPasswordOrOtp(element) && element.value)
        data.value = truncate(element.value, MAX_TEXT_CHARS);
      if (element.type === 'checkbox' || element.type === 'radio') data.checked = element.checked;
    }
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      if (element.disabled) data.disabled = true;
    }
    if (element.hasAttribute('aria-expanded'))
      data.expanded = element.getAttribute('aria-expanded') === 'true';
    if (element instanceof HTMLOptionElement) data.selected = element.selected;
    if (element instanceof HTMLAnchorElement) data.href = element.href;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.placeholder) data.placeholder = element.placeholder;
    }
    return data;
  }

  function localSnapshot(navigationEpoch, frameId) {
    const elements = [];
    const refs = new Map();
    const candidates = candidateElements();
    for (const element of candidates) {
      if (elements.length >= MAX_ELEMENTS) break;
      const ref = `e${elements.length + 1}`;
      elements.push(elementData(element, ref, frameId));
      refs.set(ref, element);
    }
    const untruncatedCompactText = elements
      .map((element) => `${element.role}${element.name ? ` ${element.name}` : ''}`)
      .join('\n');
    const compactText = truncate(untruncatedCompactText, MAX_CHARS);
    return {
      elements,
      refs,
      compactText,
      url: location.href,
      title: document.title,
      navigationEpoch,
      truncated: candidates.length > elements.length || untruncatedCompactText.length > MAX_CHARS,
    };
  }

  function resetSnapshot() {
    state.currentSnapshotId = null;
    state.elements.clear();
  }

  function bridgeResult(request, result) {
    return {
      requestId: request.requestId,
      documentId: request.documentId,
      pageNodeId: request.pageNodeId,
      result,
    };
  }

  function error(code, message, retry) {
    const result = { code, message };
    if (retry) result.retry = retry;
    return { error: result };
  }

  function staleElement() {
    return error(
      'stale_element',
      'The page changed after this element was observed.',
      'Call browser_snapshot and use a returned elementRef',
    );
  }

  function isInteractable(element) {
    return (
      isVisible(element) &&
      !element.inert &&
      !element.closest('[inert]') &&
      !('disabled' in element && element.disabled)
    );
  }

  function resolveElement(operation) {
    if (operation.snapshotId !== state.currentSnapshotId) return { failure: staleElement() };
    const record = state.elements.get(operation.elementRef);
    if (!record)
      return {
        failure: error('element_not_found', 'The element is not present in the current snapshot.'),
      };
    if (record.source) return { frame: record };
    if (!isInteractable(record.element)) {
      return {
        failure: error('element_not_interactable', 'The element is hidden, disabled, or inert.'),
      };
    }
    return { element: record.element };
  }

  function setNativeValue(element, value) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(element, value);
  }

  function fillElement(element, text) {
    if (isPasswordOrOtp(element)) {
      return error(
        'element_not_interactable',
        'Password and one-time-code fields cannot be filled.',
      );
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, text);
    } else if (element.getAttribute('contenteditable') === 'true') {
      element.textContent = text;
    } else {
      return error('element_not_interactable', 'The element does not accept text input.');
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  }

  function runLocalOperation(operation, options) {
    const allowSnapshot = options && options.allowSnapshot;
    if (operation.kind === 'snapshot' && allowSnapshot) return { ok: true };
    if (operation.kind === 'press_key') {
      const target = document.activeElement || document.body;
      for (const type of ['keydown', 'keypress', 'keyup']) {
        target.dispatchEvent(new KeyboardEvent(type, { key: operation.key, bubbles: true }));
      }
      return { ok: true };
    }
    if (operation.kind === 'scroll') {
      window.scrollBy({ left: operation.deltaX, top: operation.deltaY, behavior: 'instant' });
      return { ok: true };
    }
    if (operation.kind === 'wait') return { wait: true };
    if (operation.kind === 'fill_form') {
      if (operation.snapshotId !== state.currentSnapshotId) return { failure: staleElement() };
      const records = operation.fields.map((field) => ({
        field,
        record: state.elements.get(field.elementRef),
      }));
      if (records.some(({ record }) => !record)) {
        return {
          failure: error(
            'element_not_found',
            'The element is not present in the current snapshot.',
          ),
        };
      }
      const frameRecords = records.filter(({ record }) => record.source);
      if (frameRecords.length > 0) {
        const frame = frameRecords[0].record;
        if (
          frameRecords.length !== records.length ||
          frameRecords.some(({ record }) => record.source !== frame.source)
        ) {
          return {
            failure: error(
              'invalid_argument',
              'FillForm fields must belong to one document frame.',
            ),
          };
        }
        return {
          frame,
          frameOperation: {
            ...operation,
            fields: frameRecords.map(({ field, record }) => ({
              elementRef: record.childRef,
              text: field.text,
            })),
          },
        };
      }

      const elements = [];
      for (const { field, record } of records) {
        if (!isInteractable(record.element))
          return {
            failure: error(
              'element_not_interactable',
              'The element is hidden, disabled, or inert.',
            ),
          };
        if (
          !(
            record.element instanceof HTMLInputElement ||
            record.element instanceof HTMLTextAreaElement ||
            record.element.getAttribute('contenteditable') === 'true'
          ) ||
          isPasswordOrOtp(record.element)
        ) {
          return {
            failure: error('element_not_interactable', 'The element does not accept text input.'),
          };
        }
        elements.push([record.element, field.text]);
      }
      for (const [element, text] of elements) fillElement(element, text);
      return { ok: true };
    }
    const resolved = resolveElement(operation);
    if (resolved.failure || resolved.frame) return resolved;
    const element = resolved.element;
    if (operation.kind === 'click') {
      element.focus();
      element.click();
      return { ok: true };
    }
    if (operation.kind === 'hover') {
      for (const type of ['pointerover', 'mouseover', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      return { ok: true };
    }
    if (operation.kind === 'fill') return { failure: fillElement(element, operation.text) };
    if (operation.kind === 'select_option') {
      if (!(element instanceof HTMLSelectElement)) {
        return {
          failure: error('element_not_interactable', 'The element is not a native select.'),
        };
      }
      const values = new Set(operation.values);
      const matching = Array.from(element.options).filter((option) => values.has(option.value));
      if (!matching.length)
        return {
          failure: error('invalid_argument', 'No select option matches the requested value.'),
        };
      for (const option of element.options)
        option.selected = matching.includes(option) && (element.multiple || option === matching[0]);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    return {
      failure: error('invalid_argument', 'The operation is not supported by the page bridge.'),
    };
  }

  function visibleDocumentText() {
    if (!document.body) return '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(parent.tagName)) continue;
      if (!isVisible(parent)) continue;
      const text = normalizeText(node.nodeValue);
      if (text) parts.push(text);
    }
    return normalizeText(parts.join(' '));
  }

  function waitForCondition(operation) {
    const condition = operation.condition;
    const timeout = operation.timeoutMs;
    const startedAt = Date.now();
    return new Promise((resolve) => {
      function matches() {
        if (condition.kind === 'time') return Date.now() - startedAt >= condition.milliseconds;
        if (condition.kind === 'url') return location.href.includes(condition.contains);
        if (condition.kind === 'selector') {
          try {
            return Boolean(document.querySelector(condition.selector));
          } catch (_) {
            return false;
          }
        }
        if (condition.kind === 'text')
          return visibleDocumentText().includes(normalizeText(condition.text));
        return false;
      }
      function poll() {
        if (matches()) return resolve({ ok: true });
        if (Date.now() - startedAt >= timeout) {
          return resolve({
            failure: error(
              'wait_timeout',
              'The wait condition was not met before the timeout.',
              'Call browser_snapshot and choose a new condition.',
            ),
          });
        }
        setTimeout(poll, WAIT_POLL_MS);
      }
      poll();
    });
  }

  function requestFrames(request, requestedFrames, timeoutMs = FRAME_RESPONSE_TIMEOUT_MS) {
    const frames = requestedFrames || Array.from(state.frames.values());
    if (!frames.length) return Promise.resolve([]);
    const frameRequestId = `${request.requestId}:frame-${state.nextFrameRequestSequence++}`;
    return new Promise((resolve) => {
      const pending = {
        expected: new Set(frames.map((frame) => frame.id)),
        responses: new Map(),
        frames,
        resolve,
      };
      state.pendingFrameRequests.set(frameRequestId, pending);
      for (const frame of frames) {
        frame.source.postMessage(
          {
            channel: CHANNEL,
            type: 'frame-request',
            requestId: frameRequestId,
            operation: request.operation,
            navigationEpoch: request.navigationEpoch,
          },
          '*',
        );
      }
      setTimeout(() => finishFrameRequest(frameRequestId), timeoutMs);
    });
  }

  function finishFrameRequest(requestId) {
    const pending = state.pendingFrameRequests.get(requestId);
    if (!pending) return;
    state.pendingFrameRequests.delete(requestId);
    pending.resolve(
      pending.frames.map((frame) => ({
        frame,
        result: pending.responses.get(frame.id),
        unavailable: !pending.responses.has(frame.id),
      })),
    );
  }

  function createTopSnapshot(request, frameResponses) {
    const local = localSnapshot(request.navigationEpoch, 'top');
    state.snapshotSequence += 1;
    state.currentSnapshotId = `s${request.navigationEpoch}-${state.snapshotSequence}`;
    state.elements.clear();
    for (const [ref, element] of local.refs) state.elements.set(ref, { element });
    const elements = [...local.elements];
    const frames = [{ frameId: 'top', url: local.url, status: 'ok' }];
    let compactText = local.compactText;
    let truncated = local.truncated;
    for (const response of frameResponses) {
      if (response.unavailable || !response.result) {
        frames.push({ frameId: response.frame.id, url: '', status: 'unavailable' });
        continue;
      }
      frames.push({ frameId: response.frame.id, url: response.result.url || '', status: 'ok' });
      const childElements = response.result.elements || [];
      for (const childElement of childElements) {
        if (elements.length >= MAX_ELEMENTS) {
          truncated = true;
          break;
        }
        const ref = `${response.frame.id}:${childElement.ref}`;
        const data = { ...childElement, ref, frameId: response.frame.id };
        elements.push(data);
        state.elements.set(ref, {
          id: response.frame.id,
          source: response.frame.source,
          frameId: response.frame.id,
          childRef: childElement.ref,
        });
      }
      if (response.result.compactText) {
        const combinedText = `${compactText}\n${response.result.compactText}`;
        if (combinedText.length > MAX_CHARS) truncated = true;
        compactText = truncate(combinedText, MAX_CHARS);
      }
      if (response.result.truncated) truncated = true;
    }
    return {
      navigationEpoch: request.navigationEpoch,
      documentToken: state.documentToken,
      snapshotId: state.currentSnapshotId,
      url: local.url,
      title: local.title,
      compactText,
      elements,
      frames,
      truncated,
    };
  }

  async function dispatchTopFrame(request) {
    const frameWideAction = ['press_key', 'scroll', 'wait'].includes(request.operation.kind)
      ? requestFrames(
          request,
          undefined,
          request.operation.kind === 'wait'
            ? request.operation.timeoutMs + WAIT_POLL_MS
            : FRAME_RESPONSE_TIMEOUT_MS,
        )
      : null;
    let operationResult = runLocalOperation(request.operation, { allowSnapshot: true });
    if (request.operation.kind === 'wait')
      operationResult = await waitForCondition(request.operation);
    if (frameWideAction) {
      const childResponses = await frameWideAction;
      const childSucceeded = childResponses.some(
        (response) => !response.unavailable && response.result && response.result.ok,
      );
      if (operationResult.failure && childSucceeded) operationResult = { ok: true };
    }
    if (operationResult.failure) return complete(bridgeResult(request, operationResult.failure));
    if (operationResult.frame) {
      const frameRequest = {
        ...request,
        operation: operationResult.frameOperation || {
          ...request.operation,
          elementRef: operationResult.frame.childRef,
        },
      };
      const [response] = await requestFrames(frameRequest, [operationResult.frame]);
      if (!response || response.unavailable) {
        return complete(
          bridgeResult(
            request,
            error(
              'element_not_found',
              'The child frame did not respond to the element action.',
              'Call browser_snapshot',
            ),
          ),
        );
      }
      if (response.result && response.result.error) {
        return complete(bridgeResult(request, { error: response.result.error }));
      }
    }
    if (request.operation.kind !== 'snapshot')
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
    const frameResponses = await requestFrames({ ...request, operation: { kind: 'snapshot' } });
    const snapshot = createTopSnapshot(request, frameResponses);
    const result =
      request.operation.kind === 'snapshot'
        ? { snapshot }
        : { action: { kind: request.operation.kind }, snapshot };
    return complete(bridgeResult(request, result));
  }

  function installTopFrameMessaging() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.channel !== CHANNEL) return;
      if (data.type === 'frame-ready') {
        if (!event.source || state.frames.has(event.source)) return;
        const frame = { id: `f${state.nextFrameId++}`, source: event.source };
        state.frames.set(event.source, frame);
        event.source.postMessage(
          { channel: CHANNEL, type: 'frame-assigned', frameId: frame.id },
          '*',
        );
        return;
      }
      if (data.type !== 'frame-response' || !event.source) return;
      const frame = state.frames.get(event.source);
      const pending = state.pendingFrameRequests.get(data.requestId);
      if (!frame || !pending || !pending.expected.has(frame.id)) return;
      pending.responses.set(frame.id, data.result);
      if (pending.responses.size === pending.expected.size) finishFrameRequest(data.requestId);
    });
  }

  function installChildFrameMessaging() {
    let frameId = null;
    window.top.postMessage({ channel: CHANNEL, type: 'frame-ready' }, '*');
    window.addEventListener('message', async (event) => {
      const data = event.data;
      if (!data || data.channel !== CHANNEL || event.source !== window.top) return;
      if (data.type === 'frame-assigned') {
        frameId = data.frameId;
        return;
      }
      if (data.type !== 'frame-request' || !frameId) return;

      if (data.operation.kind === 'snapshot') {
        const local = localSnapshot(data.navigationEpoch, frameId);
        state.currentSnapshotId = `s${data.navigationEpoch}-${++state.snapshotSequence}`;
        state.elements.clear();
        for (const [ref, element] of local.refs) state.elements.set(ref, { element });
        event.source.postMessage(
          {
            channel: CHANNEL,
            type: 'frame-response',
            requestId: data.requestId,
            result: {
              elements: local.elements,
              compactText: local.compactText,
              url: local.url,
              title: local.title,
              truncated: local.truncated,
            },
          },
          '*',
        );
        return;
      }

      const operation = { ...data.operation, snapshotId: state.currentSnapshotId };
      let result = runLocalOperation(operation, { allowSnapshot: false });
      if (operation.kind === 'wait') result = await waitForCondition(operation);
      event.source.postMessage(
        {
          channel: CHANNEL,
          type: 'frame-response',
          requestId: data.requestId,
          result: result.failure ? { error: result.failure.error } : { ok: true },
        },
        '*',
      );
    });
  }

  function installNavigationInvalidation() {
    for (const eventName of ['pageshow', 'popstate', 'hashchange'])
      window.addEventListener(eventName, resetSnapshot);
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function () {
        const value = original.apply(this, arguments);
        resetSnapshot();
        return value;
      };
    }
  }

  installNavigationInvalidation();
  if (isTopFrame) installTopFrameMessaging();
  else installChildFrameMessaging();

  window.__SHELTIE_MCP_PAGE_AUTOMATION__ = {
    dispatch(request) {
      if (!isTopFrame) throw new Error('Only the top frame accepts native dispatch.');
      return dispatchTopFrame(request);
    },
  };
})();
