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

#[cfg(test)]
mod tests {
    use crate::{
        commands::webview::page_automation::PAGE_AUTOMATION_SCRIPT,
        mcp::page_automation::protocol::{
            PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS, PAGE_AUTOMATION_FRAME_RESPONSE_TIMEOUT_MS,
            PAGE_AUTOMATION_HIGHLIGHT_FADE_MS,
        },
    };

    #[test]
    fn page_automation_source_has_the_all_frame_bridge_contract() {
        for required in [
            "__SHELTIE_MCP_PAGE_AUTOMATION__",
            "CHANNEL",
            "postMessage",
            "crypto.getRandomValues",
            "complete_page_automation_request",
        ] {
            assert!(
                PAGE_AUTOMATION_SCRIPT.contains(required),
                "missing {required}"
            );
        }
        for forbidden in [
            "document.cookie",
            "localStorage",
            "sessionStorage",
            "window.eval",
            "new Function",
        ] {
            assert!(
                !PAGE_AUTOMATION_SCRIPT.contains(forbidden),
                "contains forbidden source {forbidden}"
            );
        }
        assert_eq!(
            PAGE_AUTOMATION_SCRIPT.matches("(0, eval)(source)").count(),
            1,
            "the typed Evaluate operation must use exactly one indirect evaluation site"
        );
        for expected in [
            format!(
                "const FRAME_RESPONSE_TIMEOUT_MS = {PAGE_AUTOMATION_FRAME_RESPONSE_TIMEOUT_MS};"
            ),
            format!("const EVALUATE_TIMEOUT_MS = {PAGE_AUTOMATION_EVALUATE_TIMEOUT_MS};"),
            format!("const HIGHLIGHT_FADE_MS = {PAGE_AUTOMATION_HIGHLIGHT_FADE_MS};"),
        ] {
            assert!(PAGE_AUTOMATION_SCRIPT.contains(&expected));
        }
    }
}
