/** document の root 要素に dark/light クラスを設定してテーマを反映する */
export function applyThemeToDocument(isDark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
}
