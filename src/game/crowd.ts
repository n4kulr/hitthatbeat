const LANE = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff'];
/** Silhouette fill per row; back rows are lighter, as if seen through stage haze. */
const ROW_FILL = ['#171230', '#211a40', '#2c2452'];

type Hair = 'short' | 'long' | 'afro' | 'bun' | 'cap' | 'beanie' | 'phones';
const HAIRS: Hair[] = ['short', 'short', 'long', 'long', 'afro', 'bun', 'cap', 'beanie', 'phones'];
type Pose = 'idle' | 'clap' | 'pump' | 'up' | 'wave';
type Prop = 'none' | 'stick' | 'phone';

interface Fan {
  u: number;
  row: number;
  hair: Hair;
  calm: Pose;
  hype: Pose;
  prop: Prop;
  stick: string;
  /** combo level (0..1) this fan needs before they show up */
  th: number;
  a: number;
  phase: number;
  w: number;
  dy: number;
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

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
type Pt = { x: number; y: number };

/**
 * Backlit concert crowd: dark silhouettes with a coloured rim of stage light.
 * It stays in the background — the motion is the point. Fans fill in as the
 * combo builds, drain out when it breaks, and a stadium wave rolls through on milestones.
 */
export class Crowd {
  private fans: Fan[] = [];
  private level = 0.2;
  private cheer = 0;
  private waveAt = -Infinity;
  private flashes: { x: number; y: number; born: number }[] = [];

  constructor() {
    for (let row = 2; row >= 0; row--) {
      const n = 14 + row * 5;
      for (let i = 0; i < n; i++) {
        this.fans.push({
          u: (i + 0.5 + (Math.random() - 0.5) * 0.6) / n,
          row,
          hair: pick(HAIRS),
          calm: pick<Pose>(['idle', 'idle', 'clap']),
          hype: pick<Pose>(['up', 'up', 'pump', 'wave', 'clap']),
          prop: pick<Prop>(['none', 'none', 'stick', 'stick', 'phone']),
          stick: pick(LANE),
          th: Math.random() * 0.95,
          a: 0,
          phase: Math.random(),
          w: 0.88 + Math.random() * 0.24,
          dy: (Math.random() - 0.5) * 0.02,
        });
      }
    }
  }

  cheerNow() {
    this.cheer = 1;
    this.waveAt = performance.now();
    for (let i = 0; i < 10; i++) this.flashes.push({ x: Math.random(), y: Math.random(), born: performance.now() + i * 70 });
  }

  draw(g: CanvasRenderingContext2D, v: CrowdView) {
    g.save();
    this.drawAll(g, v);
    g.restore();
  }

  private drawAll(g: CanvasRenderingContext2D, v: CrowdView) {
    const now = performance.now();
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
    const pulse = Math.exp(-f * 5);

    this.drawBacklight(g, v, pulse, energy);
    if (v.effects && this.level > 0.45) this.drawBeams(g, v, (this.level - 0.45) / 0.55);

    const waveX = (now - this.waveAt) / 1400; // stadium wave sweeps left → right
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const fan of this.fans) {
      const on = this.level > fan.th || this.cheer > 0.4;
      fan.a += ((on ? 1 : 0) - fan.a) * Math.min(1, 4 * v.dt);
      if (fan.a < 0.02) continue;
      const s = v.H * 0.085 * (1 - fan.row * 0.2) * fan.w;
      const x = fan.u * v.W;
      if (Math.abs(x - v.cx) < v.trackHalf * (1 - fan.row * 0.1) + s * 0.6) continue;

      const wave = waveX < 1.3 ? Math.exp(-(((fan.u - waveX) * 7) ** 2)) : 0;
      const hyped = wave > 0.3 || (energy > 0.5 && fan.th < energy - 0.2);
      const hop = Math.max(0, Math.sin(Math.PI * ((f + fan.phase * 0.2) % 1)));
      const jump = hop * s * (hyped ? 0.08 + 0.16 * energy : 0.03) + wave * s * 0.45;
      const hy = v.H * (0.9 + fan.dy - fan.row * 0.06) - jump;
      const pose: Pose = wave > 0.3 ? 'up' : hyped ? fan.hype : fan.calm;
      const angles = this.poseAngles(pose, f, fan.phase, v.t);
      const rim = x < v.cx ? '#cdb4ff' : LANE[3];

      // top rim light: the same shape in stage colour, nudged up, then the silhouette over it
      g.globalAlpha = fan.a * (0.25 + 0.55 * pulse * this.level) * (1 - fan.row * 0.25);
      this.drawFan(g, fan, x, hy - Math.max(1.5, s * 0.035), s, angles, v, rim);
      g.globalAlpha = fan.a;
      const hand = this.drawFan(g, fan, x, hy, s, angles, v, ROW_FILL[fan.row]);
      if (hyped && fan.prop !== 'none' && pose !== 'clap') this.drawProp(g, fan, hand, angles[1], s, v, now);
    }
    g.globalAlpha = 1;

    // floor haze
    const haze = g.createLinearGradient(0, v.H * 0.86, 0, v.H);
    haze.addColorStop(0, 'rgba(34,26,66,0)');
    haze.addColorStop(1, 'rgba(34,26,66,0.8)');
    g.fillStyle = haze;
    g.fillRect(0, v.H * 0.86, v.W, v.H * 0.14);

    if (v.effects) this.drawFlashes(g, v, energy, now);
  }

  // ------------------------------------------------------------- one fan (single colour)

  private drawFan(g: CanvasRenderingContext2D, fan: Fan, x: number, hy: number, s: number, ang: number[], v: CrowdView, color: string): Pt {
    const P = Math.PI;
    const r = s * 0.3;
    const sw = s * 1.05;
    const shY = hy + r * 0.85 + s * 0.12;
    x += Math.sin(v.t * 1.3 + fan.phase * 6) * s * 0.03;
    g.fillStyle = color;
    g.strokeStyle = color;

    const blob = (fn: () => void) => {
      g.beginPath();
      fn();
      g.fill();
    };
    // hair that sits behind / around the head
    if (fan.hair === 'long') blob(() => g.roundRect(x - r * 1.05, hy - r * 0.9, r * 2.1, r * 2.3, [r, r, r * 0.3, r * 0.3]));
    if (fan.hair === 'afro') blob(() => g.arc(x, hy - r * 0.15, r * 1.35, 0, P * 2));
    if (fan.hair === 'bun') blob(() => g.arc(x, hy - r * 1.15, r * 0.42, 0, P * 2));
    // body, neck, head
    blob(() => g.roundRect(x - sw / 2, shY, sw, s * 2, [sw * 0.32, sw * 0.32, 0, 0]));
    g.fillRect(x - r * 0.3, hy + r * 0.5, r * 0.6, shY - hy);
    blob(() => g.ellipse(x, hy, r * 0.9, r, 0, 0, P * 2));
    // headwear
    if (fan.hair === 'short') blob(() => g.ellipse(x, hy - r * 0.2, r * 0.98, r * 0.9, 0, P, P * 2));
    if (fan.hair === 'cap') {
      blob(() => g.ellipse(x, hy - r * 0.35, r * 0.98, r * 0.78, 0, P, P * 2));
      blob(() => g.roundRect(x - r * 0.2, hy - r * 0.44, r * 1.35, r * 0.2, r * 0.1));
    }
    if (fan.hair === 'beanie') {
      blob(() => g.ellipse(x, hy - r * 0.3, r * 1.0, r * 0.95, 0, P, P * 2));
      blob(() => g.arc(x, hy - r * 1.25, r * 0.2, 0, P * 2));
    }
    if (fan.hair === 'phones') {
      g.lineWidth = r * 0.18;
      g.beginPath();
      g.arc(x, hy, r * 1.08, P * 1.12, P * 1.88);
      g.stroke();
      for (const side of [-1, 1]) blob(() => g.roundRect(x + side * r * 0.98 - r * 0.2, hy - r * 0.25, r * 0.4, r * 0.58, r * 0.16));
    }

    // arms as thick round-capped strokes
    const armW = s * 0.2;
    const limb = (sh: Pt, up: number, fore: number): Pt => {
      const el = { x: sh.x + Math.cos(up) * s * 0.42, y: sh.y + Math.sin(up) * s * 0.42 };
      const hd = { x: el.x + Math.cos(fore) * s * 0.4, y: el.y + Math.sin(fore) * s * 0.4 };
      g.lineWidth = armW;
      g.beginPath();
      g.moveTo(sh.x, sh.y);
      g.lineTo(el.x, el.y);
      g.lineTo(hd.x, hd.y);
      g.stroke();
      blob(() => g.arc(hd.x, hd.y, armW * 0.62, 0, P * 2));
      return hd;
    };
    const hand = limb({ x: x + sw * 0.4, y: shY + s * 0.14 }, ang[0], ang[1]);
    limb({ x: x - sw * 0.4, y: shY + s * 0.14 }, P - ang[2], P - ang[3]);
    return hand;
  }

  /** Right-arm angles [upper, fore] then left-arm angles (mirrored by the caller). 0 = right, π/2 = down. */
  private poseAngles(pose: Pose, f: number, phase: number, t: number): number[] {
    const P = Math.PI;
    const down = [P / 2 - 0.22, P / 2 - 0.08];
    const beat = 1 - f; // 1 on the beat, easing out
    switch (pose) {
      case 'clap': {
        const open = Math.sin(P * f) * 0.55;
        return [P / 2 - 0.4, P + 0.55 + open, P / 2 - 0.4, P + 0.55 + open];
      }
      case 'pump':
        return [-0.35 - beat * 0.5, -P / 2 + 0.15 - beat * 0.15, ...down];
      case 'up': {
        const sw = Math.sin((f + phase) * P * 2) * 0.22;
        return [-P / 2 + 0.55 + sw, -P / 2 + 0.3 + sw, -P / 2 + 0.55 - sw, -P / 2 + 0.3 - sw];
      }
      case 'wave': {
        const w = Math.sin(t * 9 + phase * 6) * 0.45;
        return [-P / 2 + 0.6, -P / 2 + 0.1 + w, ...down];
      }
      default:
        return [...down, ...down];
    }
  }

  private drawProp(g: CanvasRenderingContext2D, fan: Fan, hand: Pt, fore: number, s: number, v: CrowdView, now: number) {
    g.save();
    g.translate(hand.x, hand.y);
    g.rotate(fore + Math.PI / 2);
    g.globalCompositeOperation = 'lighter';
    if (fan.prop === 'stick') {
      const len = s * 0.6;
      if (v.effects) {
        g.fillStyle = fan.stick + '30';
        g.beginPath();
        g.roundRect(-s * 0.14, -len - s * 0.12, s * 0.28, len + s * 0.12, s * 0.14);
        g.fill();
      }
      g.fillStyle = fan.stick;
      g.beginPath();
      g.roundRect(-s * 0.04, -len, s * 0.08, len, s * 0.04);
      g.fill();
    } else {
      // phone torch, twinkling
      const tw = 0.6 + 0.4 * Math.sin(now / 90 + fan.phase * 20);
      const glow = g.createRadialGradient(0, -s * 0.2, 0, 0, -s * 0.2, s * 0.35);
      glow.addColorStop(0, `rgba(235,240,255,${0.9 * tw})`);
      glow.addColorStop(0.25, `rgba(220,233,255,${0.3 * tw})`);
      glow.addColorStop(1, 'rgba(220,233,255,0)');
      g.fillStyle = glow;
      g.fillRect(-s * 0.35, -s * 0.55, s * 0.7, s * 0.7);
    }
    g.restore();
  }

  // ------------------------------------------------------------- lights

  /** Soft stage glow behind the crowd so the silhouettes read. */
  private drawBacklight(g: CanvasRenderingContext2D, v: CrowdView, pulse: number, energy: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const a = 0.08 + pulse * 0.1 * energy + energy * 0.06;
    for (const [u, c] of [
      [0.15, '#cdb4ff'],
      [0.85, LANE[3]],
    ] as const) {
      const x = u * v.W;
      const y = v.H * 0.86;
      const grad = g.createRadialGradient(x, y, 0, x, y, v.W * 0.3);
      grad.addColorStop(0, c + Math.round(a * 255).toString(16).padStart(2, '0'));
      grad.addColorStop(1, c + '00');
      g.fillStyle = grad;
      g.fillRect(x - v.W * 0.3, y - v.W * 0.3, v.W * 0.6, v.W * 0.6);
    }
    g.restore();
  }

  private drawBeams(g: CanvasRenderingContext2D, v: CrowdView, k: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const len = v.H * 1.1;
    [0.06, 0.24, 0.76, 0.94].forEach((u, i) => {
      const x = u * v.W;
      const y = v.H * 0.95;
      const ang = -Math.PI / 2 + (u < 0.5 ? 0.35 : -0.35) + Math.sin(v.t * 0.7 + i * 1.7) * 0.3;
      const spread = 0.06;
      const grad = g.createLinearGradient(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      grad.addColorStop(0, LANE[i] + Math.round(0x40 * k).toString(16).padStart(2, '0'));
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

  private drawFlashes(g: CanvasRenderingContext2D, v: CrowdView, energy: number, now: number) {
    if (energy > 0.6 && Math.random() < 0.04 * energy) this.flashes.push({ x: Math.random(), y: Math.random(), born: now });
    this.flashes = this.flashes.filter((fl) => now - fl.born < 160);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const fl of this.flashes) {
      const age = now - fl.born;
      if (age < 0) continue;
      const x = fl.x * v.W;
      if (Math.abs(x - v.cx) < v.trackHalf) continue;
      const y = v.H * (0.78 + fl.y * 0.12);
      const r = v.H * 0.03 * (1 - age / 160);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
  }
}
