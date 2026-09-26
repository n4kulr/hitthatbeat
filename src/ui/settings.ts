import { audioCtx } from '../audio/engine';
import { playSfx } from '../audio/sfx';
import { keyLabel, saveSettings, settings } from '../lib/settings';
import { h } from '../lib/util';
import type { Settings } from '../types';

export function openSettings(onClose?: () => void) {
  const el = h(`
    <div class="modal-veil">
      <div class="modal settings-modal">
        <button class="close" aria-label="close">×</button>
        <div class="card-label">settings</div>
        <h2>tune it up</h2>

        <div class="setting">
          <div class="setting-head"><span>scroll speed</span><b data-out="speed"></b></div>
          <input type="range" min="1" max="10" step="0.5" data-key="speed" />
        </div>

        <div class="setting">
          <div class="setting-head"><span>audio offset</span><b data-out="offsetMs"></b></div>
          <input type="range" min="-250" max="250" step="1" data-key="offsetMs" />
          <div class="setting-hint">raise it if you keep hitting late. or let the game figure it out:</div>
          <button class="btn btn-small" data-act="calibrate">calibrate ♪</button>
          <div class="calib hidden">
            <div class="calib-dots">${'<span></span>'.repeat(4)}</div>
            <div class="calib-text">tap <kbd>space</kbd> on every click</div>
          </div>
        </div>

        <div class="setting">
          <div class="setting-head"><span>keys</span><small>click to rebind</small></div>
          <div class="keys">${[0, 1, 2, 3].map((i) => `<button class="keycap lane-${i}" data-lane="${i}"></button>`).join('')}</div>
        </div>

        <div class="setting two">
          <div>
            <div class="setting-head"><span>music</span><b data-out="musicVolume"></b></div>
            <input type="range" min="0" max="1" step="0.05" data-key="musicVolume" />
          </div>
          <div>
            <div class="setting-head"><span>hit sounds</span><b data-out="hitVolume"></b></div>
            <input type="range" min="0" max="1" step="0.05" data-key="hitVolume" />
          </div>
        </div>

        <div class="setting toggles">
          <label class="toggle"><input type="checkbox" data-key="showTiming" /><span></span> early / late + timing bar</label>
          <label class="toggle"><input type="checkbox" data-key="effects" /><span></span> particles + starfield</label>
        </div>
      </div>
    </div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));

  const fmt: Partial<Record<keyof Settings, (v: number) => string>> = {
    speed: (v) => v.toFixed(1),
    offsetMs: (v) => `${v > 0 ? '+' : ''}${v} ms`,
    musicVolume: (v) => `${Math.round(v * 100)}%`,
    hitVolume: (v) => `${Math.round(v * 100)}%`,
  };

  const refresh = () => {
    el.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((input) => {
      const key = input.dataset.key as keyof Settings;
      if (input.type === 'checkbox') input.checked = settings[key] as boolean;
      else input.value = String(settings[key]);
    });
    el.querySelectorAll<HTMLElement>('[data-out]').forEach((out) => {
      const key = out.dataset.out as keyof Settings;
      out.textContent = fmt[key]?.(settings[key] as number) ?? '';
    });
    el.querySelectorAll<HTMLElement>('.keycap').forEach((k) => {
      k.textContent = keyLabel(settings.keys[+k.dataset.lane!]);
    });
  };
  refresh();

  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.key as keyof Settings | undefined;
    if (!key) return;
    saveSettings({ [key]: input.type === 'checkbox' ? input.checked : parseFloat(input.value) } as Partial<Settings>);
    if (key === 'hitVolume') playSfx('hit');
    refresh();
  });

  let rebinding: HTMLElement | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (rebinding) {
      e.preventDefault();
      const lane = +rebinding.dataset.lane!;
      if (e.code !== 'Escape') {
        const keys = [...settings.keys] as Settings['keys'];
        const clash = keys.indexOf(e.code);
        if (clash >= 0) keys[clash] = keys[lane];
        keys[lane] = e.code;
        saveSettings({ keys });
      }
      rebinding.classList.remove('listening');
      rebinding = null;
      refresh();
      return;
    }
    if (calibrating) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) calibTap(e.timeStamp);
      } else if (e.code === 'Escape') stopCalibration();
      return;
    }
    if (e.code === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);

  el.querySelector('.keys')!.addEventListener('click', (e) => {
    const cap = (e.target as HTMLElement).closest<HTMLElement>('.keycap');
    if (!cap) return;
    rebinding?.classList.remove('listening');
    rebinding = cap;
    cap.classList.add('listening');
    cap.textContent = '?';
  });

  // ----------------------------------------------------------- calibration
  const PERIOD = 0.6;
  const BEATS = 16;
  const WARMUP = 4;
  let calibrating = false;
  let calibStart = 0;
  let taps: number[] = [];
  let dotTimer = 0;
  const calib = el.querySelector<HTMLElement>('.calib')!;
  const calibText = el.querySelector<HTMLElement>('.calib-text')!;
  const dots = [...el.querySelectorAll<HTMLElement>('.calib-dots span')];

  const heardTime = (perfMs: number) => {
    const ctx = audioCtx();
    const ts = ctx.getOutputTimestamp?.();
    if (ts?.contextTime && ts.performanceTime) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - (performance.now() - perfMs) / 1000;
  };

  const calibTap = (perfMs: number) => {
    const t = heardTime(perfMs) - calibStart;
    const beat = Math.round(t / PERIOD);
    if (beat < WARMUP || beat >= BEATS) return;
    taps.push(t - beat * PERIOD);
    calibText.textContent = `${taps.length} taps…`;
  };

  const stopCalibration = () => {
    calibrating = false;
    clearInterval(dotTimer);
    calib.classList.add('hidden');
  };

  el.querySelector('[data-act="calibrate"]')!.addEventListener('click', () => {
    if (calibrating) return;
    const ctx = audioCtx();
    calibrating = true;
    taps = [];
    calib.classList.remove('hidden');
    calibText.innerHTML = 'tap <kbd>space</kbd> on every click';
    calibStart = ctx.currentTime + 0.6;
    for (let i = 0; i < BEATS; i++) playSfx(i % 4 === 0 ? 'tickHi' : 'tick', 0.7, calibStart + i * PERIOD);
    dotTimer = window.setInterval(() => {
      const t = heardTime(performance.now()) - calibStart;
      const beat = Math.floor(t / PERIOD);
      dots.forEach((d, i) => d.classList.toggle('on', t >= 0 && beat % 4 === i && t - beat * PERIOD < 0.15));
      if (t > BEATS * PERIOD + 0.3) {
        stopCalibration();
        if (taps.length < 5) {
          calibText.textContent = 'not enough taps — try again';
          calib.classList.remove('hidden');
          return;
        }
        const sorted = [...taps].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        saveSettings({ offsetMs: Math.round(med * 1000) });
        refresh();
        calib.classList.remove('hidden');
        calibText.textContent = `done! offset set to ${settings.offsetMs > 0 ? '+' : ''}${settings.offsetMs} ms`;
      }
    }, 16);
  });

  const close = () => {
    stopCalibration();
    window.removeEventListener('keydown', onKey);
    el.classList.remove('open');
    setTimeout(() => el.remove(), 200);
    onClose?.();
  };
  el.querySelector('.close')!.addEventListener('click', close);
  el.addEventListener('pointerdown', (e) => e.target === el && close());
}
