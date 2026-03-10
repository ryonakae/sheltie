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
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', notify, { passive: true });
  } else {
    window.addEventListener('scroll', function() {
      if (t) clearTimeout(t);
      t = setTimeout(notify, DELAY);
    }, { passive: true, capture: true });
  }
})();"#;
