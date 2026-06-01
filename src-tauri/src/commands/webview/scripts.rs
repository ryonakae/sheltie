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
  var t = null, orig = '', DELAY = 150;
  function notify() {
    orig = document.title;
    document.title = '\x02scroll-end';
    requestAnimationFrame(function() { document.title = orig; });
  }
  // scroll はバブルしないため capture:true で内側スクロールコンテナの scroll も捕捉する。
  // scrollend はサポート時のみ即時通知に使い、未サポート/未発火環境では debounce が拾う。
  window.addEventListener('scroll', function() {
    if (t) clearTimeout(t);
    t = setTimeout(notify, DELAY);
  }, { passive: true, capture: true });
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', function() {
      if (t) { clearTimeout(t); t = null; }
      notify();
    }, { passive: true, capture: true });
  }
})();"#;
