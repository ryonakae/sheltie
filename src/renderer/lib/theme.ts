/** document の root 要素に dark/light クラス・data-theme 属性・color-scheme を設定してテーマを反映する */
export function applyThemeToDocument(isDark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  root.style.colorScheme = isDark ? 'dark' : 'light';
}
