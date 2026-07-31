// Tailwind の dark variant が CSS パース時から正しい色を出せるよう、
// OS テーマに応じた light/dark クラスを最初の paint 前に同期付与する。
// Theme メニューでの上書きは React マウント後に theme-store が反映する。
// CSP の script-src 'self' を成立させるため、inline ではなく外部ファイルにする。
(function () {
  var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.add(isDark ? 'dark' : 'light');
})();
