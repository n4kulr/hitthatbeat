import type { Settings } from '../types';

const KEY = 'hitthatbeat.settings';

const DEFAULTS: Settings = {
  speed: 5,
  offsetMs: 0,
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  musicVolume: 0.8,
  showTiming: true,
  effects: true,
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

export function saveSettings(patch: Partial<Settings> = {}) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: '␣',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Semicolon: ';',
    Comma: ',',
    Period: '.',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Quote: "'",
    ShiftLeft: 'LS',
    ShiftRight: 'RS',
  };
  return map[code] ?? code.replace(/(Left|Right)$/, '').slice(0, 3);
}
