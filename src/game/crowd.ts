const LANE = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff'];
const SKIN = ['#f5cd30', '#f5cd30', '#eac086', '#c68a5e', '#8d5a3b'];
const SHIRT = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff', '#ff8a3d', '#c77dff', '#f4efe3', '#2b2540'];
const BG = [20, 13, 41];

interface Fan {
  u: number;
  row: number;
  skin: string;
  shirt: string;
  stick: number;
  /** combo level (0..1) this fan needs before they show up */
  th: number;
  a: number;
  phase: number;
  w: number;
}

export interface CrowdView {
  W: number;
  H: number;
  cx: number;
  trackHalf: number;
  t: number;
  beats: number[];
  combo: number;
  effects: boolean;
  dt: number;
}

/** Mix a hex colour toward the stage background; back rows sit in the dark. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (BG[i] - v) * amt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** RoBeats-style stands: fans fill in as the combo builds and drain out when it breaks. */
export class Crowd {
  private fans: Fan[] = [];
  private level = 0.2;
  private cheer = 0;
  private flashes: { x: number; y: number; born: number }[] = [];

  constructor() {
    for (let row = 2; row >= 0; row--) {
      const n = 26 + row * 6;
      const dark = 0.25 + row * 0.22;
      for (let i = 0; i < n; i++) {
        this.fans.push({
          u: (i + 0.5 + (Math.random() - 0.5) * 0.7) / n,
          row,
          skin: shade(pick(SKIN), dark),
          shirt: shade(pick(SHIRT), dark),
          stick: Math.random() < 0.4 ? Math.floor(Math.random() * 4) : -1,
          th: Math.random() * 0.95,
          a: 0,
          phase: Math.random(),
          w: 0.85 + Math.random() * 0.3,
        });
      }
    }
  }

  cheerNow() {
    this.cheer = 1;
    for (let i = 0; i < 12; i++) this.flashes.push({ x: Math.random(), y: Math.random(), born: performance.now() + i * 60 });
  }

  draw(g: CanvasRenderingContext2D, v: CrowdView) {
    const target = v.combo > 0 ? Math.min(1, 0.35 + v.combo / 80) : 0.15;
    this.level += (target - this.level) * Math.min(1, (target > this.level ? 1.2 : 3) * v.dt);
    this.cheer = Math.max(0, this.cheer - v.dt * 0.7);
    const energy = Math.min(1.4, this.level + this.cheer * 0.6);

    // position within the current beat
    let lo = 0;
    let hi = v.beats.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (v.beats[m] <= v.t) lo = m + 1;
      else hi = m;
    }
    const b0 = v.beats[lo - 1];
    const b1 = v.beats[lo] ?? (b0 ?? 0) + 0.5;
    const f = b0 === undefined ? (v.t * 2) % 1 : Math.min(1, (v.t - b0) / Math.max(0.2, b1 - b0));

    if (v.effects && this.level > 0.45) this.drawBeams(g, v, (this.level - 0.45) / 0.55);

    for (const fan of this.fans) {
      const on = this.level > fan.th || this.cheer > 0.4;
      fan.a += ((on ? 1 : 0) - fan.a) * Math.min(1, 4 * v.dt);
      if (fan.a < 0.02) continue;
      const size = v.H * 0.075 * (1 - fan.row * 0.2) * fan.w;
      const x = fan.u * v.W;
      if (Math.abs(x - v.cx) < v.trackHalf * (1 - fan.row * 0.1) + size) continue;
      const hyped = energy > 0.5 && fan.th < energy - 0.2;
      const hop = Math.sin(Math.PI * ((f + fan.phase * 0.25) % 1));
      const jump = Math.max(0, hop) * size * (0.1 + (hyped ? 0.45 : 0.15) * energy);
      const baseY = v.H * (1.02 - fan.row * 0.07) - jump;
      g.globalAlpha = fan.a;
      this.drawFan(g, fan, x, baseY, size, hyped, f, v.effects);
    }
    g.globalAlpha = 1;

    // haze so the front row melts into the floor
    const haze = g.createLinearGradient(0, v.H * 0.82, 0, v.H);
    haze.addColorStop(0, 'rgba(11,8,22,0)');
    haze.addColorStop(1, 'rgba(11,8,22,0.7)');
    g.fillStyle = haze;
    g.fillRect(0, v.H * 0.82, v.W, v.H * 0.18);

    if (v.effects) this.drawFlashes(g, v, energy);
  }

  private drawFan(g: CanvasRenderingContext2D, fan: Fan, x: number, base: number, s: number, hyped: boolean, f: number, effects: boolean) {
    const torsoW = s * 0.95;
    const torsoH = s * 1.05;
    const top = base - torsoH;
    const head = s * 0.62;
    const armW = s * 0.28;
    const armL = s * 0.85;

    // arms: down at the sides, or up and swaying on the beat
    const sway = Math.sin((f + fan.phase) * Math.PI * 2) * 0.35;
    for (const side of [-1, 1]) {
      g.save();
      g.translate(x + side * (torsoW / 2 + armW / 2 - 1), top + armW / 2);
      g.rotate(hyped ? side * (Math.PI - 0.35) + sway : side * 0.12);
      g.fillStyle = fan.shirt;
      g.fillRect(-armW / 2, 0, armW, armL * 0.55);
      g.fillStyle = fan.skin;
      g.fillRect(-armW / 2, armL * 0.55, armW, armL * 0.45);
      if (hyped && fan.stick >= 0 && side === 1) {
        const c = LANE[fan.stick];
        if (effects) {
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = c + '40';
          g.fillRect(-armW, armL * 0.85, armW * 2, s * 0.9);
          g.globalCompositeOperation = 'source-over';
        }
        g.fillStyle = c;
        g.fillRect(-armW * 0.25, armL * 0.9, armW * 0.5, s * 0.75);
      }
      g.restore();
    }

    g.fillStyle = fan.shirt;
    g.beginPath();
    g.roundRect(x - torsoW / 2, top, torsoW, torsoH + 4, s * 0.08);
    g.fill();
    g.fillStyle = fan.skin;
    g.beginPath();
    g.roundRect(x - head / 2, top - head - s * 0.06, head, head, s * 0.14);
    g.fill();
  }

  private drawBeams(g: CanvasRenderingContext2D, v: CrowdView, k: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const len = v.H * 1.1;
    [0.06, 0.24, 0.76, 0.94].forEach((u, i) => {
      const x = u * v.W;
      const y = v.H * 0.95;
      const ang = -Math.PI / 2 + (u < 0.5 ? 0.35 : -0.35) + Math.sin(v.t * 0.7 + i * 1.7) * 0.3;
      const spread = 0.07;
      const grad = g.createLinearGradient(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      grad.addColorStop(0, LANE[i] + Math.round(0x55 * k).toString(16).padStart(2, '0'));
      grad.addColorStop(1, LANE[i] + '00');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang - spread) * len, y + Math.sin(ang - spread) * len);
      g.lineTo(x + Math.cos(ang + spread) * len, y + Math.sin(ang + spread) * len);
      g.closePath();
      g.fill();
    });
    g.restore();
  }

  private drawFlashes(g: CanvasRenderingContext2D, v: CrowdView, energy: number) {
    const now = performance.now();
    if (energy > 0.6 && Math.random() < 0.06 * energy) this.flashes.push({ x: Math.random(), y: Math.random(), born: now });
    this.flashes = this.flashes.filter((fl) => now - fl.born < 160);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const fl of this.flashes) {
      const age = now - fl.born;
      if (age < 0) continue;
      const x = fl.x * v.W;
      if (Math.abs(x - v.cx) < v.trackHalf) continue;
      const y = v.H * (0.8 + fl.y * 0.12);
      const r = v.H * 0.035 * (1 - age / 160);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
  }
}
