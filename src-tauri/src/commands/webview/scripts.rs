pub const SPA_URL_DETECTION_SCRIPT: &str = r#"(function() {
  var lastUrl = location.href;
  function onUrlChange() {
    var newUrl = location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;
    var orig = document.title;
    document.title = '\x01' + newUrl;
    requestAnimationFrame(function() { document.title = orig; });
  }
  var origPush = history.pushState;
  history.pushState = function() {
    var r = origPush.apply(this, arguments);
    onUrlChange();
    return r;
  };
  var origReplace = history.replaceState;
  history.replaceState = function() {
    var r = origReplace.apply(this, arguments);
    onUrlChange();
    return r;
  };
  window.addEventListener('popstate', onUrlChange);
})();"#;

pub const SCROLL_DETECTION_SCRIPT: &str = r#"(function() {
  var t = null, orig = '', DELAY = 150, isScrolling = false;
  function emit(kind) {
    orig = document.title;
    document.title = '\x02' + kind;
    requestAnimationFrame(function() { document.title = orig; });
  }
  function clearTimer() {
    if (!t) return;
    clearTimeout(t);
    t = null;
  }
  function notifyStart() {
    if (isScrolling) return;
    isScrolling = true;
    emit('scroll-start');
  }
  function notifyEnd() {
    if (!isScrolling) return;
    isScrolling = false;
    clearTimer();
    emit('scroll-end');
  }
  function scheduleEnd() {
    clearTimer();
    t = setTimeout(notifyEnd, DELAY);
  }
  function handleScroll() {
    notifyStart();
    scheduleEnd();
  }
  if ('onscrollend' in window) {
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    window.addEventListener('scrollend', notifyEnd, { passive: true });
  } else {
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  }
})();"#;
