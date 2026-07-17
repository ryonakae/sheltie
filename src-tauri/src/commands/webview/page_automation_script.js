(function installSheltiePageAutomationBridge() {
  'use strict';

  const CHANNEL = 'sheltie-mcp-page-automation-v1';
  const FRAME_RESPONSE_TIMEOUT_MS = 750;
  const SETTLE_DELAY_MS = 250;
  const EVALUATE_TIMEOUT_MS = 10000;
  const HIGHLIGHT_FADE_MS = 180;
  const WAIT_POLL_MS = 50;
  const MAX_ELEMENTS = 200;
  const MAX_DIALOGS = 20;
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
    dialogPolicy: { action: 'dismiss', promptText: null },
    dialogs: [],
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

  function installDialogShim() {
    function consumePolicy() {
      const policy = state.dialogPolicy;
      state.dialogPolicy = { action: 'dismiss', promptText: null };
      return policy;
    }
    const dialogMessage = (message) => truncate(normalizeText(message), MAX_TEXT_CHARS);
    const recordDialog = (dialog) => {
      if (state.dialogs.length < MAX_DIALOGS) {
        state.dialogs.push(dialog);
      } else {
        state.dialogs[MAX_DIALOGS - 1] = {
          type: 'alert',
          message: 'Additional dialogs were omitted.',
        };
      }
    };
    window.alert = function (message) {
      recordDialog({ type: 'alert', message: dialogMessage(message) });
      consumePolicy();
    };
    window.confirm = function (message) {
      recordDialog({ type: 'confirm', message: dialogMessage(message) });
      return consumePolicy().action === 'accept';
    };
    window.prompt = function (message, defaultValue) {
      recordDialog({ type: 'prompt', message: dialogMessage(message) });
      const policy = consumePolicy();
      return policy.action === 'accept'
        ? policy.promptText === null
          ? defaultValue === undefined
            ? ''
            : String(defaultValue)
          : policy.promptText
        : null;
    };
  }

  function takeDialogs() {
    const dialogs = state.dialogs;
    state.dialogs = [];
    return dialogs;
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

  function cssRectFromElement(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function frameElementForSource(source) {
    return Array.from(document.querySelectorAll('iframe')).find(
      (frameElement) => frameElement.contentWindow === source,
    );
  }

  function parentFrameElementGeometry(frameElement, childGeometry) {
    const childElement = childGeometry && childGeometry.element;
    const childViewport = childGeometry && childGeometry.viewport;
    if (!frameElement || !childElement || !childViewport) return null;
    const frameRect = frameElement.getBoundingClientRect();
    const contentWidth = Number(frameElement.clientWidth);
    const contentHeight = Number(frameElement.clientHeight);
    if (
      !Number.isFinite(contentWidth) ||
      !Number.isFinite(contentHeight) ||
      contentWidth <= 0 ||
      contentHeight <= 0 ||
      childViewport.viewportWidth <= 0 ||
      childViewport.viewportHeight <= 0
    ) {
      return null;
    }
    const scaleX = contentWidth / childViewport.viewportWidth;
    const scaleY = contentHeight / childViewport.viewportHeight;
    const element = {
      x: frameRect.x + frameElement.clientLeft + childElement.x * scaleX,
      y: frameRect.y + frameElement.clientTop + childElement.y * scaleY,
      width: childElement.width * scaleX,
      height: childElement.height * scaleY,
    };
    if (
      element.x < 0 ||
      element.y < 0 ||
      element.x + element.width > window.innerWidth ||
      element.y + element.height > window.innerHeight
    ) {
      return null;
    }
    return { element, viewport: fullPageGeometry() };
  }

  function showHighlight(rect, target) {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-sheltie-mcp-highlight', '');
    overlay.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'pointer-events:none',
      'box-sizing:border-box',
      'border:2px solid #6366f1',
      'background:rgba(99,102,241,.14)',
      'border-radius:4px',
      'transition:opacity 180ms ease-out',
    ].join(';');
    const update = () => {
      const current = target ? cssRectFromElement(target) : rect;
      overlay.style.left = `${current.x}px`;
      overlay.style.top = `${current.y}px`;
      overlay.style.width = `${Math.max(1, current.width)}px`;
      overlay.style.height = `${Math.max(1, current.height)}px`;
    };
    let animationFrame = null;
    const scheduleUpdate = () => {
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        update();
      });
    };
    update();
    document.documentElement.appendChild(overlay);
    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    return () => {
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), HIGHLIGHT_FADE_MS);
    };
  }

  function pointerButton(button) {
    return button === 'middle' ? 1 : button === 'right' ? 2 : 0;
  }

  function dispatchCoordinateClick(operation) {
    if (operation.snapshotId !== state.currentSnapshotId) return { failure: staleElement() };
    const target = document.elementFromPoint(operation.x, operation.y);
    if (!target) {
      return {
        failure: error(
          'element_not_found',
          'No page element exists at the requested CSS viewport coordinates.',
        ),
      };
    }
    const rect = operation.highlight || { x: operation.x, y: operation.y, width: 1, height: 1 };
    const cleanupHighlight = showHighlight(rect, target);
    const button = pointerButton(operation.button);
    const pointerEvents = typeof PointerEvent === 'function';
    for (let click = 0; click < operation.clickCount; click += 1) {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const init = {
          bubbles: true,
          cancelable: true,
          clientX: operation.x,
          clientY: operation.y,
          button,
          buttons: type.endsWith('down') ? 1 << button : 0,
          detail: click + 1,
        };
        const EventConstructor =
          type.startsWith('pointer') && pointerEvents ? PointerEvent : MouseEvent;
        target.dispatchEvent(new EventConstructor(type, init));
      }
    }
    return { ok: true, action: { inputTrusted: false }, cleanupHighlight };
  }

  async function evaluateForMcp(source) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('evaluate_timeout')), EVALUATE_TIMEOUT_MS);
    });
    try {
      const value = await Promise.race([Promise.resolve((0, eval)(source)), timeout]);
      let json;
      try {
        json = JSON.stringify(value);
      } catch (_) {
        throw new Error('evaluate_not_json');
      }
      if (json === undefined) throw new Error('evaluate_not_json');
      return JSON.parse(json);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function sanitizeBasename(name) {
    const value =
      String(name || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .pop() || 'upload';
    return value.replace(/[\u0000-\u001f]/g, '_');
  }

  function decodeBase64(value) {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }

  function uploadFiles(element, files) {
    if (!(element instanceof HTMLInputElement) || element.type.toLowerCase() !== 'file') {
      return {
        failure: error(
          'upload_target_not_file_input',
          'The referenced element is not a current file input.',
        ),
      };
    }
    try {
      const transfer = new DataTransfer();
      const metadata = [];
      for (const file of files) {
        const name = sanitizeBasename(file.name);
        const bytes = decodeBase64(file.bytesBase64);
        transfer.items.add(
          new File([bytes], name, { type: file.mimeType || 'application/octet-stream' }),
        );
        metadata.push({ name, size: bytes.byteLength });
      }
      element.files = transfer.files;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: { inputTrusted: false, files: metadata } };
    } catch (_) {
      return {
        failure: error(
          'upload_file_invalid',
          'The upload files could not be assigned to the page.',
        ),
      };
    }
  }

  function fullPageGeometry() {
    const root = document.documentElement;
    const body = document.body;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0, window.innerWidth),
      documentHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0, window.innerHeight),
      scrollX: window.pageXOffset,
      scrollY: window.pageYOffset,
    };
  }

  function afterTwoAnimationFrames() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function runLocalOperation(operation, options) {
    const allowSnapshot = options && options.allowSnapshot;
    if (operation.kind === 'snapshot' && allowSnapshot) return { ok: true };
    if (operation.kind === 'set_dialog_handler') {
      state.dialogPolicy = {
        action: operation.action === 'accept' ? 'accept' : 'dismiss',
        promptText: operation.promptText === undefined ? null : String(operation.promptText),
      };
      return { ok: true, action: { configured: true } };
    }
    if (operation.kind === 'click_coordinates') return dispatchCoordinateClick(operation);
    if (operation.kind === 'evaluate') {
      try {
        return { ok: true, action: { value: await evaluateForMcp(operation.script) } };
      } catch (cause) {
        const code =
          cause && cause.message === 'evaluate_timeout' ? 'evaluate_timeout' : 'evaluate_not_json';
        return {
          failure: error(
            code,
            code === 'evaluate_timeout'
              ? 'Page evaluation did not finish before the timeout.'
              : 'The evaluated value is not JSON serializable.',
          ),
        };
      }
    }
    if (operation.kind === 'screenshot_full_page') {
      return { ok: true, action: { geometry: fullPageGeometry() } };
    }
    if (operation.kind === 'screenshot_scroll' || operation.kind === 'screenshot_restore') {
      const root = document.documentElement;
      const previousBehavior = root.style.getPropertyValue('scroll-behavior');
      const previousPriority = root.style.getPropertyPriority('scroll-behavior');
      root.style.setProperty('scroll-behavior', 'auto', 'important');
      try {
        window.scrollTo({ left: operation.x, top: operation.y, behavior: 'instant' });
        await afterTwoAnimationFrames();
      } finally {
        if (previousBehavior) {
          root.style.setProperty('scroll-behavior', previousBehavior, previousPriority);
        } else {
          root.style.removeProperty('scroll-behavior');
        }
      }
      return { ok: true, action: { geometry: fullPageGeometry() } };
    }
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
      const highlighted = elements[elements.length - 1][0];
      return {
        ok: true,
        cleanupHighlight: showHighlight(cssRectFromElement(highlighted), highlighted),
      };
    }
    if (
      !['click', 'hover', 'fill', 'select_option', 'screenshot_element', 'upload_files'].includes(
        operation.kind,
      )
    ) {
      return {
        failure: error('invalid_argument', 'The operation is not supported by the page bridge.'),
      };
    }
    const resolved = resolveElement(operation);
    if (resolved.failure) return resolved;
    if (resolved.frame) return resolved;
    const element = resolved.element;
    if (operation.kind === 'screenshot_element') {
      const rect = cssRectFromElement(element);
      if (
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > window.innerWidth ||
        rect.y + rect.height > window.innerHeight
      ) {
        return {
          failure: error(
            'screenshot_target_not_visible',
            'The requested screenshot target is not fully visible in the native WebPage.',
          ),
        };
      }
      return { ok: true, action: { geometry: { element: rect, viewport: fullPageGeometry() } } };
    }
    if (operation.kind === 'upload_files') {
      const result = uploadFiles(element, operation.files);
      return result.failure
        ? result
        : { ...result, cleanupHighlight: showHighlight(cssRectFromElement(element), element) };
    }
    if (operation.kind === 'click') {
      const cleanupHighlight = showHighlight(cssRectFromElement(element), element);
      element.focus();
      element.click();
      return { ok: true, cleanupHighlight };
    }
    if (operation.kind === 'hover') {
      const cleanupHighlight = showHighlight(cssRectFromElement(element), element);
      for (const type of ['pointerover', 'mouseover', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      return { ok: true, cleanupHighlight };
    }
    if (operation.kind === 'fill') {
      const failure = fillElement(element, operation.text);
      return failure
        ? { failure }
        : { ok: true, cleanupHighlight: showHighlight(cssRectFromElement(element), element) };
    }
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
      return {
        ok: true,
        cleanupHighlight: showHighlight(cssRectFromElement(element), element),
      };
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
          element: response.frame.element,
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
    const frameWideAction = ['press_key', 'scroll', 'wait', 'set_dialog_handler'].includes(
      request.operation.kind,
    )
      ? requestFrames(
          request,
          undefined,
          request.operation.kind === 'wait'
            ? request.operation.timeoutMs + WAIT_POLL_MS
            : FRAME_RESPONSE_TIMEOUT_MS,
        )
      : null;
    let operationResult = await runLocalOperation(request.operation, { allowSnapshot: true });
    if (request.operation.kind === 'wait')
      operationResult = await waitForCondition(request.operation);
    const childDialogs = [];
    if (frameWideAction) {
      const childResponses = await frameWideAction;
      const childSucceeded = childResponses.some(
        (response) => !response.unavailable && response.result && response.result.ok,
      );
      for (const response of childResponses) {
        const dialogs = response.result && response.result.action && response.result.action.dialogs;
        if (Array.isArray(dialogs)) childDialogs.push(...dialogs);
      }
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
      if (response.result && response.result.action) {
        if (request.operation.kind === 'screenshot_element') {
          const geometry = response.result.__geometryRelayed
            ? response.result.action.geometry
            : parentFrameElementGeometry(
                operationResult.frame.element,
                response.result.action.geometry,
              );
          if (!geometry) {
            return complete(
              bridgeResult(
                request,
                error(
                  'screenshot_target_not_visible',
                  'The requested descendant-frame target is not fully visible in the native WebPage.',
                ),
              ),
            );
          }
          operationResult.action = { ...operationResult.action, geometry };
        } else {
          operationResult.action = { ...operationResult.action, ...response.result.action };
        }
      }
    }
    const rawResultKinds = [
      'set_dialog_handler',
      'screenshot_element',
      'screenshot_full_page',
      'screenshot_scroll',
      'screenshot_restore',
    ];
    if (rawResultKinds.includes(request.operation.kind)) {
      return complete(
        bridgeResult(request, {
          action: { kind: request.operation.kind, ...operationResult.action },
        }),
      );
    }
    if (request.operation.kind !== 'snapshot')
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
    const frameResponses = await requestFrames({ ...request, operation: { kind: 'snapshot' } });
    const snapshot = createTopSnapshot(request, frameResponses);
    const dialogs =
      request.operation.kind === 'set_dialog_handler' ? [] : [...takeDialogs(), ...childDialogs];
    const result =
      request.operation.kind === 'snapshot'
        ? { snapshot }
        : {
            action: {
              kind: request.operation.kind,
              ...operationResult.action,
              ...(dialogs.length ? { dialogs } : {}),
            },
            snapshot,
          };
    if (operationResult.cleanupHighlight) operationResult.cleanupHighlight();
    return complete(bridgeResult(request, result));
  }

  function installFrameGeometryRelay() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.channel !== CHANNEL || data.type !== 'frame-geometry-relay') return;
      const frameElement = frameElementForSource(event.source);
      const geometry = parentFrameElementGeometry(
        frameElement,
        data.result && data.result.action && data.result.action.geometry,
      );
      const result = geometry
        ? {
            ...data.result,
            action: { ...data.result.action, geometry },
          }
        : {
            error: error(
              'screenshot_target_not_visible',
              'The requested nested-frame target is not fully visible in the native WebPage.',
            ).error,
          };
      if (!isTopFrame) {
        window.parent.postMessage({ ...data, result }, '*');
        return;
      }
      const frame = Array.from(state.frames.values()).find(
        (candidate) => candidate.id === data.frameId && candidate.token === data.frameToken,
      );
      const pending = state.pendingFrameRequests.get(data.requestId);
      if (!frame || !pending || !pending.expected.has(frame.id)) return;
      pending.responses.set(frame.id, { ...result, __geometryRelayed: true });
      if (pending.responses.size === pending.expected.size) finishFrameRequest(data.requestId);
    });
  }

  function installTopFrameMessaging() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.channel !== CHANNEL) return;
      if (data.type === 'frame-ready') {
        if (!event.source || state.frames.has(event.source)) return;
        const frame = {
          id: `f${state.nextFrameId++}`,
          source: event.source,
          element: frameElementForSource(event.source),
          token: createDocumentToken(),
        };
        state.frames.set(event.source, frame);
        event.source.postMessage(
          {
            channel: CHANNEL,
            type: 'frame-assigned',
            frameId: frame.id,
            frameToken: frame.token,
          },
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
    let frameToken = null;
    window.top.postMessage({ channel: CHANNEL, type: 'frame-ready' }, '*');
    window.addEventListener('message', async (event) => {
      const data = event.data;
      if (!data || data.channel !== CHANNEL || event.source !== window.top) return;
      if (data.type === 'frame-assigned') {
        frameId = data.frameId;
        frameToken = data.frameToken;
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
      let result = await runLocalOperation(operation, { allowSnapshot: false });
      if (operation.kind === 'wait') result = await waitForCondition(operation);
      const dialogs = data.operation.kind === 'set_dialog_handler' ? [] : takeDialogs();
      if (result.cleanupHighlight) setTimeout(result.cleanupHighlight, SETTLE_DELAY_MS);
      if (
        operation.kind === 'screenshot_element' &&
        result.action &&
        result.action.geometry &&
        frameToken
      ) {
        window.parent.postMessage(
          {
            channel: CHANNEL,
            type: 'frame-geometry-relay',
            requestId: data.requestId,
            frameId,
            frameToken,
            result: { ok: true, action: result.action },
          },
          '*',
        );
        return;
      }
      event.source.postMessage(
        {
          channel: CHANNEL,
          type: 'frame-response',
          requestId: data.requestId,
          result: result.failure
            ? { error: result.failure.error }
            : {
                ok: true,
                ...(result.action ? { action: result.action } : {}),
                ...(dialogs.length ? { action: { ...result.action, dialogs } } : {}),
              },
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
  installDialogShim();
  installFrameGeometryRelay();
  if (isTopFrame) installTopFrameMessaging();
  else installChildFrameMessaging();

  window.__SHELTIE_MCP_PAGE_AUTOMATION__ = {
    dispatch(request) {
      if (!isTopFrame) throw new Error('Only the top frame accepts native dispatch.');
      return dispatchTopFrame(request);
    },
  };
})();
