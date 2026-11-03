// Light or dark, chosen in Grown-ups. These are per-tablet conveniences, so they live in browser
// storage, which the small script in index.html can read before the first paint.
const THEME = 'bar-theme';
const system = matchMedia('(prefers-color-scheme: dark)');

const read = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* the choice just won't be remembered */ }
};

export const themeChoice = () => read(THEME, 'auto');
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function apply() {
  const choice = themeChoice();
  const dark = choice === 'dark' || (choice === 'auto' && system.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.choice = choice;
  document.querySelector('meta[name=theme-color]').content = dark ? '#1C1E22' : '#F7F7F4';
  document.querySelector('meta[name=color-scheme]').content = dark ? 'only dark' : 'only light';
  window.dispatchEvent(new Event('themechange'));
}

export function setTheme(choice) { write(THEME, choice); apply(); }

system.addEventListener('change', apply);
