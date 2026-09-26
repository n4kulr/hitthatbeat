import type { Lane } from '../types';
import { Crowd } from './crowd';

export const LANE_COLORS = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff'];
export const INK = '#1b1a1f';
export const CREAM = '#f7f1e3';

export type Judgment = 'perfect' | 'great' | 'okay' | 'miss';

export const JUDGMENT_STYLE: Record<Judgment, { label: string; color: string }> = {
  perfect: { label: 'PERFECT', color: '#ffd84d' },
  great: { label: 'GREAT', color: '#3fe0b5' },
  okay: { label: 'OKAY', color: '#8fa0ff' },
  miss: { label: 'MISS', color: '#ff5a6a' },
};

export interface RNote {
  t: number;
  end?: number;
  lane: Lane;
  state: 'pending' | 'holding' | 'done' | 'missed' | 'dropped';
}

export interface FrameState {
  t: number;
  lookahead: number;
  notes: RNote[];
  from: number;
  beats: number[];
  downbeat: number;
  pressed: boolean[];
  combo: number;
  keyLabels: string[];
  bass: number;
  effects: boolean;
  showTiming: boolean;
}

interface Burst {
  x: number;
  y: number;
  r: number;
  color: string;
  born: number;
  big: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  born: number;
  life: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  color: string;
}

const Z_DEPTH = 2;

export class Renderer {
  private g: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private cx = 0;
  private vpY = 0;
  private baseY = 0;
  spacing = 0;
  private arc = 0;
  private noteR = 0;

  private bursts: Burst[] = [];
  private parts: Particle[] = [];
  private stars: Star[] = [];
  private shake = 0;
  private receptorPunch = [0, 0, 0, 0];
  private judgment: { kind: Judgment; born: number; err: number } | null = null;
  private errors: { err: number; born: number; kind: Judgment }[] = [];
  private comboBorn = 0;
  private lastCombo = 0;
  private milestone: { text: string; born: number } | null = null;
  private edgeFlash = 0;
  private lastFrame = performance.now();
  private crowd = new Crowd();

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: { centerX?: number; sideHud?: boolean } = {},
  ) {
    this.g = canvas.getContext('2d')!;
    for (let i = 0; i < 160; i++) this.stars.push(this.newStar(Math.random()));
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = rect.width;
    this.H = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.W * (this.W < 1000 ? 0.5 : (this.opts.centerX ?? 0.5));
    this.vpY = this.H * 0.08;
    this.baseY = this.H * 0.83;
    this.spacing = Math.min(this.W * 0.14, this.H * 0.17, 150);
    this.arc = this.spacing * 0.3;
    this.noteR = this.spacing * 0.39;
  }

  // ------------------------------------------------------------- geometry

  private scaleAt(p: number) {
    return 1 / (1 + Math.max(-0.4, (1 - p) * Z_DEPTH));
  }

  private proj(o: number, p: number) {
    const s = this.scaleAt(p);
    const bx = this.cx + o * this.spacing;
    const by = this.baseY - this.arc * (o / 1.5) ** 2;
    return { x: this.cx + (bx - this.cx) * s, y: this.vpY + (by - this.vpY) * s, s };
  }

  laneAtX(x: number): number {
    const o = (x - this.cx) / this.spacing + 1.5;
    return Math.max(0, Math.min(3, Math.round(o)));
  }

  receptor(lane: number) {
    return this.proj(lane - 1.5, 1);
  }

  // ------------------------------------------------------------- events

  hit(lane: number, kind: Judgment, err: number, chord = false) {
    const now = performance.now();
    this.judgment = { kind, born: now, err };
    this.errors.push({ err, born: now, kind });
    if (this.errors.length > 30) this.errors.shift();
    const { x, y } = this.receptor(lane);
    const color = LANE_COLORS[lane];
    this.bursts.push({ x, y, r: this.noteR, color, born: now, big: kind === 'perfect' });
    this.receptorPunch[lane] = 1;
    const count = kind === 'perfect' ? 14 : kind === 'great' ? 9 : 5;
    for (let i = 0; i < count; i++) this.spawnParticle(x, y, i % 3 === 0 ? CREAM : color, 1);
    if (chord) this.shake = Math.max(this.shake, 3);
  }

  holdSpark(lane: number) {
    const { x, y } = this.receptor(lane);
    this.spawnParticle(x, y, LANE_COLORS[lane], 0.6);
  }

  miss(lane: number, breakCombo: boolean) {
    this.judgment = { kind: 'miss', born: performance.now(), err: 0 };
    this.receptorPunch[lane] = -1;
    if (breakCombo) this.shake = Math.max(this.shake, 7);
  }

  celebrate(combo: number) {
    this.milestone = { text: `${combo} COMBO!`, born: performance.now() };
    this.edgeFlash = 1;
    this.crowd.cheerNow();
  }

  private spawnParticle(x: number, y: number, color: string, power: number) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const v = (3 + Math.random() * 6) * power;
    this.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      size: 4 + Math.random() * 6,
      color,
      born: performance.now(),
      life: 450 + Math.random() * 300,
    });
  }

  private newStar(z = 1): Star {
    const pick = Math.random();
    return {
      x: (Math.random() - 0.5) * 2.4,
      y: (Math.random() - 0.5) * 1.6,
      z,
      color: pick < 0.6 ? CREAM : LANE_COLORS[Math.floor(Math.random() * 4)],
    };
  }

  // ------------------------------------------------------------- draw

  draw(st: FrameState) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const g = this.g;
    const { W, H } = this;

    if (st.combo > this.lastCombo) this.comboBorn = now;
    this.lastCombo = st.combo;

    const beatPulse = this.beatPulse(st);
    const hype = st.combo >= 100 ? 2 : st.combo >= 50 ? 1 : 0;

    g.save();
    if (this.shake > 0.2 && st.effects) {
      g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.shake *= 0.86;

    this.drawBackground(st, beatPulse, hype, dt);
    this.crowd.draw(g, {
      W,
      H,
      cx: this.cx,
      trackHalf: Math.abs(this.proj(2.3, 1.1).x - this.cx),
      t: st.t,
      beats: st.beats,
      combo: st.combo,
      effects: st.effects,
      dt,
    });
    this.drawTrack(st, beatPulse, hype, now);
    this.drawReceptors(st, dt);
    this.drawNotes(st, now);
    this.drawEffects(now, dt, st.effects);
    this.drawCombo(st, now, hype);
    this.drawJudgment(now, st.showTiming);
    if (st.showTiming) this.drawErrorMeter(now);
    g.restore();

    // subtle vignette
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }

  private beatPulse(st: FrameState) {
    const i = upperBound(st.beats, st.t) - 1;
    if (i < 0) return 0;
    const since = st.t - st.beats[i];
    const strong = (i - st.downbeat) % 4 === 0 ? 1 : 0.55;
    return Math.exp(-since * 7) * strong;
  }

  private drawBackground(st: FrameState, pulse: number, hype: number, dt: number) {
    const g = this.g;
    const { W, H, cx, vpY } = this;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1033');
    bg.addColorStop(0.55, '#140d29');
    bg.addColorStop(1, '#0b0816');
    g.fillStyle = bg;
    g.fillRect(-20, -20, W + 40, H + 40);

    // glowing "sun" at the vanishing point
    const sunR = this.spacing * (1.6 + st.bass * 1.2 + pulse * 0.4 + hype * 0.3);
    const sun = g.createRadialGradient(cx, vpY + H * 0.12, 0, cx, vpY + H * 0.12, sunR * 2.2);
    const hue = hype === 2 ? (performance.now() / 20) % 360 : 330;
    sun.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.35 + st.bass * 0.3})`);
    sun.addColorStop(0.4, `hsla(${hue + 40}, 100%, 60%, 0.12)`);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);

    if (!st.effects) return;
    // starfield rushing toward the camera
    const speed = (0.25 + st.bass * 0.9 + hype * 0.25) * (1.2 / st.lookahead);
    const focal = Math.min(W, H) * 0.5;
    const oy = vpY + H * 0.12;
    for (const s of this.stars) {
      s.z -= speed * dt;
      if (s.z <= 0.02) Object.assign(s, this.newStar(1));
      const x = cx + (s.x / s.z) * focal;
      const y = oy + (s.y / s.z) * focal;
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) {
        Object.assign(s, this.newStar(1));
        continue;
      }
      const size = Math.max(1, (1 - s.z) * 4);
      g.globalAlpha = Math.min(1, (1 - s.z) * 1.4) * 0.8;
      g.fillStyle = s.color;
      g.fillRect(x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;
  }

  private arcPath(p: number, o0 = -2, o1 = 2, steps = 20) {
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(this.proj(o0 + ((o1 - o0) * i) / steps, p));
    return pts;
  }

  private drawTrack(st: FrameState, pulse: number, hype: number, now: number) {
    const g = this.g;
    const pNear = 1.3;
    const far = this.arcPath(0);
    const near = this.arcPath(pNear);

    // body
    g.beginPath();
    far.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
    for (let i = near.length - 1; i >= 0; i--) g.lineTo(near[i].x, near[i].y);
    g.closePath();
    const fill = g.createLinearGradient(0, far[10].y, 0, near[10].y);
    fill.addColorStop(0, 'rgba(20,14,40,0)');
    fill.addColorStop(0.35, 'rgba(24,17,48,0.75)');
    fill.addColorStop(1, 'rgba(12,9,26,0.95)');
    g.fillStyle = fill;
    g.fill();

    // pressed-lane glow
    for (let l = 0; l < 4; l++) {
      if (!st.pressed[l]) continue;
      const a = this.arcPath(0.25, l - 2, l - 1, 4);
      const b = this.arcPath(1.05, l - 2, l - 1, 4);
      g.beginPath();
      a.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      for (let i = b.length - 1; i >= 0; i--) g.lineTo(b[i].x, b[i].y);
      g.closePath();
      const lg = g.createLinearGradient(0, a[2].y, 0, b[2].y);
      lg.addColorStop(0, hexA(LANE_COLORS[l], 0));
      lg.addColorStop(1, hexA(LANE_COLORS[l], 0.38));
      g.fillStyle = lg;
      g.fill();
    }

    // beat lines
    const i0 = upperBound(st.beats, st.t - 0.1);
    for (let i = i0; i < st.beats.length; i++) {
      const until = st.beats[i] - st.t;
      if (until > st.lookahead) break;
      const p = 1 - until / st.lookahead;
      const down = (i - st.downbeat) % 4 === 0;
      const pts = this.arcPath(p, -2, 2, 12);
      g.beginPath();
      pts.forEach((pt, k) => (k ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      g.strokeStyle = down ? 'rgba(247,241,227,0.22)' : 'rgba(247,241,227,0.08)';
      g.lineWidth = (down ? 3 : 1.5) * pts[6].s;
      g.stroke();
    }

    // lane dividers
    for (const o of [-1, 0, 1]) {
      const a = this.proj(o, 0);
      const b = this.proj(o, pNear);
      const lg = g.createLinearGradient(a.x, a.y, b.x, b.y);
      lg.addColorStop(0, 'rgba(247,241,227,0)');
      lg.addColorStop(1, 'rgba(247,241,227,0.14)');
      g.strokeStyle = lg;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // glowing edges, hotter with combo
    this.edgeFlash *= 0.95;
    const glow = 0.35 + pulse * 0.5 + this.edgeFlash;
    for (const o of [-2, 2]) {
      const a = this.proj(o, 0);
      const b = this.proj(o, pNear);
      const lg = g.createLinearGradient(a.x, a.y, b.x, b.y);
      if (hype === 2) {
        const h = (now / 8) % 360;
        lg.addColorStop(0, `hsla(${h},100%,65%,0)`);
        lg.addColorStop(0.5, `hsla(${h + 60},100%,65%,${glow})`);
        lg.addColorStop(1, `hsla(${h + 120},100%,65%,${Math.min(1, glow + 0.3)})`);
      } else {
        const c = hype === 1 ? LANE_COLORS[1] : o < 0 ? LANE_COLORS[0] : LANE_COLORS[3];
        lg.addColorStop(0, hexA(c, 0));
        lg.addColorStop(1, hexA(c, Math.min(1, glow + 0.2)));
      }
      g.strokeStyle = lg;
      g.lineWidth = 3 + pulse * 3 + hype;
      g.shadowColor = hype === 1 ? LANE_COLORS[1] : '#ff4f8b';
      g.shadowBlur = st.effects ? 12 + pulse * 18 : 0;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.shadowBlur = 0;
    }

    // hit line
    const line = this.arcPath(1, -2, 2, 20);
    g.beginPath();
    line.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
    g.strokeStyle = `rgba(247,241,227,${0.25 + pulse * 0.25})`;
    g.lineWidth = 2;
    g.stroke();
  }

  private drawReceptors(st: FrameState, dt: number) {
    const g = this.g;
    for (let l = 0; l < 4; l++) {
      const { x, y } = this.receptor(l);
      const punch = this.receptorPunch[l];
      this.receptorPunch[l] *= Math.pow(0.001, dt * 3);
      const pressed = st.pressed[l];
      const r = this.noteR * (pressed ? 0.9 : 1) * (1 + Math.max(0, punch) * 0.18);
      const color = punch < -0.1 ? '#ff5a6a' : LANE_COLORS[l];

      g.beginPath();
      g.arc(x, y + 5, r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();

      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = pressed ? hexA(color, 0.45) : 'rgba(18,12,36,0.9)';
      g.fill();
      g.lineWidth = r * 0.16;
      g.strokeStyle = color;
      g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.beginPath();
      g.arc(x, y, r + r * 0.08 + 1.5, 0, Math.PI * 2);
      g.stroke();

      g.fillStyle = pressed ? INK : hexA(CREAM, 0.85);
      g.font = `700 ${Math.round(r * 0.62)}px Rubik, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(st.keyLabels[l], x, y + 1);
    }
  }

  private drawNotes(st: FrameState, now: number) {
    const visible: RNote[] = [];
    for (let i = st.from; i < st.notes.length; i++) {
      const n = st.notes[i];
      if (n.t - st.t > st.lookahead) break;
      if (n.state === 'done' && n.end === undefined) continue;
      visible.push(n);
    }
    // bodies first, then heads far → near so closer notes overlap
    for (const n of visible) if (n.end !== undefined) this.drawHoldBody(n, st, now);
    for (let i = visible.length - 1; i >= 0; i--) {
      const n = visible[i];
      if (n.state === 'done' || n.state === 'dropped') continue;
      let p = 1 - (n.t - st.t) / st.lookahead;
      if (n.state === 'holding') p = 1;
      if (p > 1.25) continue;
      const fade = n.state === 'missed' ? Math.max(0, 1 - (p - 1) * 4) * 0.5 : 1;
      this.drawGem(n.lane, p, fade, n.end !== undefined);
    }
  }

  private drawGem(lane: number, p: number, alpha: number, isHold: boolean) {
    const g = this.g;
    const { x, y, s } = this.proj(lane - 1.5, p);
    const r = this.noteR * s * 0.92;
    const appear = Math.min(1, p * 6);
    g.globalAlpha = alpha * appear;
    const color = alpha < 1 ? '#6d6780' : LANE_COLORS[lane];

    g.beginPath();
    g.arc(x, y + r * 0.18, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fill();

    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, lighten(color, 0.45));
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, darken(color, 0.25));
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = Math.max(2, r * 0.14);
    g.strokeStyle = INK;
    g.stroke();

    if (isHold) {
      g.beginPath();
      g.arc(x, y, r * 0.45, 0, Math.PI * 2);
      g.lineWidth = Math.max(1.5, r * 0.1);
      g.strokeStyle = hexA(CREAM, 0.9);
      g.stroke();
    }
    // shine
    g.beginPath();
    g.ellipse(x - r * 0.28, y - r * 0.38, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.fill();
    g.globalAlpha = 1;
  }

  private drawHoldBody(n: RNote, st: FrameState, now: number) {
    const g = this.g;
    const o = n.lane - 1.5;
    const pHead = n.state === 'holding' ? 1 : Math.min(1.25, 1 - (n.t - st.t) / st.lookahead);
    const pTail = Math.max(0, 1 - (n.end! - st.t) / st.lookahead);
    if (pTail >= pHead || n.state === 'done') return;
    const h = this.proj(o, pHead);
    const tl = this.proj(o, pTail);
    const dx = h.x - tl.x;
    const dy = h.y - tl.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const wh = this.noteR * h.s * 0.55;
    const wt = this.noteR * tl.s * 0.55;

    const holding = n.state === 'holding';
    const dead = n.state === 'missed' || n.state === 'dropped';
    const color = dead ? '#4d475e' : LANE_COLORS[n.lane];

    g.beginPath();
    g.moveTo(h.x + nx * wh, h.y + ny * wh);
    g.lineTo(tl.x + nx * wt, tl.y + ny * wt);
    g.arc(tl.x, tl.y, wt, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
    g.lineTo(h.x - nx * wh, h.y - ny * wh);
    g.closePath();
    const lg = g.createLinearGradient(tl.x, tl.y, h.x, h.y);
    lg.addColorStop(0, hexA(color, dead ? 0.35 : 0.5));
    lg.addColorStop(1, hexA(color, dead ? 0.4 : holding ? 0.95 : 0.75));
    g.fillStyle = lg;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = INK;
    g.stroke();

    if (holding) {
      // marching stripes while held
      const phase = (now / 90) % 1;
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 3;
      for (let k = 0; k < 12; k++) {
        const f = (k + phase) / 12;
        const px = tl.x + dx * f;
        const py = tl.y + dy * f;
        const w = wt + (wh - wt) * f;
        g.beginPath();
        g.moveTo(px + nx * w, py + ny * w);
        g.lineTo(px - nx * w, py - ny * w);
        g.stroke();
      }
      g.restore();
    }
  }

  private drawEffects(now: number, dt: number, effects: boolean) {
    const g = this.g;
    this.bursts = this.bursts.filter((b) => now - b.born < 320);
    for (const b of this.bursts) {
      const k = (now - b.born) / 320;
      const r = b.r * (1 + k * (b.big ? 1.3 : 0.9));
      g.beginPath();
      g.arc(b.x, b.y, r, 0, Math.PI * 2);
      g.strokeStyle = hexA(b.color, 1 - k);
      g.lineWidth = (1 - k) * (b.big ? 10 : 6);
      g.stroke();
      if (b.big) {
        g.beginPath();
        g.arc(b.x, b.y, r * 0.7, 0, Math.PI * 2);
        g.fillStyle = `rgba(255,255,255,${(1 - k) * 0.35})`;
        g.fill();
      }
    }
    if (!effects) {
      this.parts.length = 0;
      return;
    }
    const step = dt * 60;
    this.parts = this.parts.filter((p) => now - p.born < p.life);
    for (const p of this.parts) {
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += 0.35 * step;
      p.vx *= 0.97;
      p.rot += p.vr * step;
      const k = (now - p.born) / p.life;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.globalAlpha = 1 - k;
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  private stickerText(text: string, x: number, y: number, size: number, color: string, rot = 0, alpha = 1) {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.globalAlpha = alpha;
    g.font = `400 ${Math.round(size)}px Bungee, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, size * 0.2);
    g.strokeStyle = INK;
    g.strokeText(text, size * 0.06, size * 0.08);
    g.strokeText(text, 0, 0);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** In-game HUD sits beside the track (combo left, judgement right) so it never covers notes. */
  private hudPos(side: -1 | 1, centerY: number) {
    if (!this.opts.sideHud) return { x: this.cx, y: centerY };
    const edge = this.proj(side * 2.2, 0.8);
    const room = side < 0 ? edge.x : this.W - edge.x;
    if (room > this.spacing * 1.7) return { x: edge.x + side * Math.min(room / 2, this.spacing * 1.25), y: edge.y - this.spacing * 0.5 };
    // phone-width: no room at the sides, use the far end of the track where notes are still tiny
    return { x: this.cx + side * this.spacing * 0.9, y: this.vpY + (this.baseY - this.vpY) * 0.14 };
  }

  private drawCombo(st: FrameState, now: number, hype: number) {
    if (st.combo < 4) return;
    const pos = this.hudPos(-1, this.vpY + (this.baseY - this.vpY) * 0.4);
    const y = pos.y;
    const bump = Math.max(0, 1 - (now - this.comboBorn) / 120);
    const size = this.spacing * (0.75 + bump * 0.12);
    const color = hype === 2 ? `hsl(${(now / 6) % 360},100%,72%)` : hype === 1 ? LANE_COLORS[1] : CREAM;
    this.stickerText(String(st.combo), pos.x, y, size, color, 0, 0.95);
    this.g.font = `700 ${Math.round(this.spacing * 0.16)}px Rubik, sans-serif`;
    this.g.fillStyle = hexA(CREAM, 0.7);
    this.g.textAlign = 'center';
    this.g.fillText('COMBO', pos.x, y + size * 0.62);

    if (this.milestone) {
      const k = (now - this.milestone.born) / 1100;
      if (k > 1) this.milestone = null;
      else {
        const s = this.spacing * 0.5 * (1 + (1 - Math.min(1, k * 5)) * 0.6);
        this.stickerText(this.milestone.text, pos.x, y - this.spacing * 0.75 - k * 30, s, LANE_COLORS[0], -0.06, 1 - k * k);
      }
    }
  }

  private drawJudgment(now: number, showTiming: boolean) {
    const j = this.judgment;
    if (!j) return;
    const age = now - j.born;
    if (age > 550) return;
    const style = JUDGMENT_STYLE[j.kind];
    const pos = this.hudPos(1, this.vpY + (this.baseY - this.vpY) * 0.62);
    const y = pos.y;
    const pop = age < 90 ? 1.35 - (age / 90) * 0.35 : 1;
    const alpha = age > 380 ? 1 - (age - 380) / 170 : 1;
    const rot = j.kind === 'miss' ? 0.08 : -0.04;
    this.stickerText(style.label, pos.x, y - Math.min(age, 200) * 0.04, this.spacing * 0.42 * pop, style.color, rot, alpha);
    if (showTiming && j.kind !== 'perfect' && j.kind !== 'miss') {
      const g = this.g;
      g.globalAlpha = alpha;
      g.font = `700 ${Math.round(this.spacing * 0.14)}px Rubik, sans-serif`;
      g.fillStyle = j.err < 0 ? '#8fd3ff' : '#ffb27a';
      g.textAlign = 'center';
      g.fillText(j.err < 0 ? 'EARLY' : 'LATE', pos.x, y + this.spacing * 0.33);
      g.globalAlpha = 1;
    }
  }

  private drawErrorMeter(now: number) {
    const g = this.g;
    const w = Math.min(260, this.W * 0.5);
    const y = this.H - 18;
    const range = 0.135;
    const zones: [number, string][] = [
      [0.135, 'rgba(143,160,255,0.35)'],
      [0.09, 'rgba(63,224,181,0.45)'],
      [0.045, 'rgba(255,216,77,0.6)'],
    ];
    for (const [z, c] of zones) {
      const zw = (z / range) * (w / 2);
      g.fillStyle = c;
      g.fillRect(this.cx - zw, y - 2, zw * 2, 4);
    }
    g.fillStyle = CREAM;
    g.fillRect(this.cx - 1, y - 8, 2, 16);
    for (const e of this.errors) {
      const age = (now - e.born) / 2500;
      if (age > 1) continue;
      const x = this.cx + Math.max(-1, Math.min(1, e.err / range)) * (w / 2);
      g.globalAlpha = 1 - age;
      g.fillStyle = JUDGMENT_STYLE[e.kind].color;
      g.fillRect(x - 1.5, y - 7, 3, 14);
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- helpers

function upperBound(arr: number[], v: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexA(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function lighten(hex: string, k: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r + (255 - r) * k},${g + (255 - g) * k},${b + (255 - b) * k})`;
}

function darken(hex: string, k: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r * (1 - k)},${g * (1 - k)},${b * (1 - k)})`;
}
