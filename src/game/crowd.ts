const LANE = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff'];
const SKIN = ['#f6d7b8', '#eac086', '#d9a066', '#b87a4b', '#8d5a3b', '#5e3a24', '#f5cd30'];
const HAIR = ['#1b1a1f', '#2e1d14', '#5a3a22', '#a8672f', '#e8c170', '#ff4f8b', '#7b8cff', '#3fe0b5', '#d8d4e6'];
const SHIRT = ['#ff4f8b', '#ffd84d', '#3fe0b5', '#7b8cff', '#ff8a3d', '#c77dff', '#f4efe3', '#2b2540', '#3a6ea5', '#e2574c'];
const INK = '#0b0816';
const BG = [20, 13, 41];

type Hair = 'short' | 'long' | 'afro' | 'bun' | 'cap' | 'beanie' | 'phones' | 'bald';
const HAIRS: Hair[] = ['short', 'short', 'long', 'long', 'afro', 'bun', 'cap', 'beanie', 'phones', 'bald'];
type Pose = 'idle' | 'clap' | 'pump' | 'up' | 'wave';
type Prop = 'none' | 'stick' | 'phone';

interface Fan {
  u: number;
  row: number;
  skin: string;
  hairC: string;
  shirt: string;
  shirt2: string;
  hair: Hair;
  tee: 0 | 1 | 2;
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

/** Mix a hex colour toward the stage background; back rows sit in the dark. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (BG[i] - v) * amt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** RoBeats-style audience: fans fill in as the combo builds and drain out when it breaks. */
export class Crowd {
  private fans: Fan[] = [];
  private level = 0.2;
  private cheer = 0;
  private flashes: { x: number; y: number; born: number }[] = [];

  constructor() {
    for (let row = 2; row >= 0; row--) {
      const n = 13 + row * 4;
      const dark = 0.12 + row * 0.24;
      for (let i = 0; i < n; i++) {
        const shirt = pick(SHIRT);
        this.fans.push({
          u: (i + 0.5 + (Math.random() - 0.5) * 0.6) / n,
          row,
          skin: shade(pick(SKIN), dark),
          hairC: shade(pick(HAIR), dark),
          shirt: shade(shirt, dark),
          shirt2: shade(pick(SHIRT.filter((c) => c !== shirt)), dark),
          hair: pick(HAIRS),
          tee: pick([0, 0, 1, 2] as const),
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
    for (let i = 0; i < 12; i++) this.flashes.push({ x: Math.random(), y: Math.random(), born: performance.now() + i * 60 });
  }

  draw(g: CanvasRenderingContext2D, v: CrowdView) {
    g.save();
    this.drawAll(g, v);
    g.restore();
  }

  private drawAll(g: CanvasRenderingContext2D, v: CrowdView) {
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

    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const fan of this.fans) {
      const on = this.level > fan.th || this.cheer > 0.4;
      fan.a += ((on ? 1 : 0) - fan.a) * Math.min(1, 4 * v.dt);
      if (fan.a < 0.02) continue;
      const s = v.H * 0.1 * (1 - fan.row * 0.2) * fan.w;
      const x = fan.u * v.W;
      if (Math.abs(x - v.cx) < v.trackHalf * (1 - fan.row * 0.1) + s * 0.6) continue;
      const hyped = energy > 0.5 && fan.th < energy - 0.2;
      const hop = Math.max(0, Math.sin(Math.PI * ((f + fan.phase * 0.2) % 1)));
      const jump = hop * s * (hyped ? 0.1 + 0.18 * energy : 0.04);
      const headY = v.H * (0.86 + fan.dy - fan.row * 0.065) - jump;
      g.globalAlpha = fan.a;
      this.drawFan(g, fan, x, headY, s, hyped ? fan.hype : fan.calm, hyped, f, v);
    }
    g.globalAlpha = 1;

    // haze so the front row melts into the floor
    const haze = g.createLinearGradient(0, v.H * 0.84, 0, v.H);
    haze.addColorStop(0, 'rgba(11,8,22,0)');
    haze.addColorStop(1, 'rgba(11,8,22,0.75)');
    g.fillStyle = haze;
    g.fillRect(0, v.H * 0.84, v.W, v.H * 0.16);

    if (v.effects) this.drawFlashes(g, v, energy);
  }

  // ------------------------------------------------------------- one fan

  private drawFan(g: CanvasRenderingContext2D, fan: Fan, x: number, hy: number, s: number, pose: Pose, hyped: boolean, f: number, v: CrowdView) {
    const ol = Math.max(1.5, s * 0.055);
    const r = s * 0.3;
    const sw = s * 1.05;
    const neckY = hy + r * 0.85;
    const shY = neckY + s * 0.12;
    const look = Math.sign(v.cx - x) * r * 0.14;
    const sway = Math.sin((v.t * 1.3 + fan.phase * 6) % (Math.PI * 2)) * s * 0.03;
    x += sway;

    // long hair / afro / bun sit behind the head
    g.fillStyle = fan.hairC;
    g.strokeStyle = INK;
    g.lineWidth = ol;
    if (fan.hair === 'long') {
      g.beginPath();
      g.roundRect(x - r * 1.05, hy - r * 0.9, r * 2.1, r * 2.3, [r, r, r * 0.3, r * 0.3]);
      g.fill();
      g.stroke();
    } else if (fan.hair === 'afro') {
      g.beginPath();
      g.arc(x, hy - r * 0.15, r * 1.35, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else if (fan.hair === 'bun') {
      g.beginPath();
      g.arc(x, hy - r * 1.15, r * 0.42, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // torso (runs off the bottom of the screen)
    g.fillStyle = fan.shirt;
    g.beginPath();
    g.roundRect(x - sw / 2, shY, sw, s * 2, [sw * 0.32, sw * 0.32, 0, 0]);
    g.fill();
    g.stroke();
    if (fan.tee === 1) {
      g.fillStyle = fan.shirt2;
      g.beginPath();
      g.arc(x, shY + s * 0.5, s * 0.17, 0, Math.PI * 2);
      g.fill();
    } else if (fan.tee === 2) {
      g.fillStyle = fan.shirt2;
      g.fillRect(x - sw / 2 + ol / 2, shY + s * 0.38, sw - ol, s * 0.12);
    }

    // neck + head
    g.fillStyle = fan.skin;
    g.fillRect(x - r * 0.3, neckY - r * 0.3, r * 0.6, shY - neckY + r * 0.35);
    g.beginPath();
    g.ellipse(x, hy, r * 0.9, r, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    this.drawFace(g, fan, x + look, hy, r, hyped, v.t);
    this.drawHairFront(g, fan, x, hy, r, ol);

    // arms, in front of the body
    const shL = { x: x - sw * 0.42, y: shY + s * 0.14 };
    const shR = { x: x + sw * 0.42, y: shY + s * 0.14 };
    const [rU, rF, lU, lF] = this.poseAngles(pose, f, fan.phase, v.t);
    const hand = this.arm(g, fan, shR, rU, rF, s, ol);
    this.arm(g, fan, shL, Math.PI - lU, Math.PI - lF, s, ol);
    if (hyped && fan.prop !== 'none' && pose !== 'clap') this.drawProp(g, fan, hand, rF, s, ol, v.effects);
  }

  /** Right-arm angles [upper, fore] then left-arm angles (mirrored by the caller). 0 = right, π/2 = down. */
  private poseAngles(pose: Pose, f: number, phase: number, t: number): [number, number, number, number] {
    const P = Math.PI;
    const down: [number, number] = [P / 2 - 0.22, P / 2 - 0.08];
    const beat = 1 - f; // 1 on the beat, easing out
    switch (pose) {
      case 'clap': {
        const open = Math.sin(P * f) * 0.55;
        const a: [number, number] = [P / 2 - 0.4, P + 0.55 + open];
        return [...a, ...a];
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

  private arm(g: CanvasRenderingContext2D, fan: Fan, sh: { x: number; y: number }, up: number, fore: number, s: number, ol: number) {
    const u = s * 0.42;
    const fl = s * 0.4;
    const w = s * 0.2;
    const el = { x: sh.x + Math.cos(up) * u, y: sh.y + Math.sin(up) * u };
    const hd = { x: el.x + Math.cos(fore) * fl, y: el.y + Math.sin(fore) * fl };
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }, width: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    };
    seg(sh, el, w + ol * 2, INK);
    seg(el, hd, w * 0.85 + ol * 2, INK);
    seg(el, hd, w * 0.85, fan.skin);
    seg(sh, el, w, fan.shirt);
    g.fillStyle = fan.skin;
    g.strokeStyle = INK;
    g.lineWidth = ol;
    g.beginPath();
    g.arc(hd.x, hd.y, w * 0.62, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    return hd;
  }

  private drawFace(g: CanvasRenderingContext2D, fan: Fan, x: number, y: number, r: number, hyped: boolean, t: number) {
    g.fillStyle = INK;
    const blink = (t * 0.7 + fan.phase * 3) % 3 < 0.08;
    const ey = y - r * 0.05;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(x + side * r * 0.32, ey, r * 0.09, blink ? r * 0.02 : r * 0.13, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (hyped) {
      // cheering: open mouth
      g.beginPath();
      g.ellipse(x, y + r * 0.42, r * 0.2, r * 0.17, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff6f91';
      g.beginPath();
      g.ellipse(x, y + r * 0.5, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.2, r * 0.09);
      g.beginPath();
      g.arc(x, y + r * 0.22, r * 0.22, 0.25 * Math.PI, 0.75 * Math.PI);
      g.stroke();
    }
  }

  private drawHairFront(g: CanvasRenderingContext2D, fan: Fan, x: number, y: number, r: number, ol: number) {
    const P = Math.PI;
    g.fillStyle = fan.hairC;
    g.strokeStyle = INK;
    g.lineWidth = ol;
    switch (fan.hair) {
      case 'short':
      case 'long':
      case 'bun':
      case 'afro':
        g.beginPath();
        g.ellipse(x, y - r * 0.25, r * 0.95, r * 0.8, 0, P, 2 * P);
        g.quadraticCurveTo(x + r * 0.3, y - r * 0.1, x - r * 0.95, y - r * 0.2);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      case 'cap':
        g.fillStyle = fan.shirt2;
        g.beginPath();
        g.ellipse(x, y - r * 0.35, r * 0.95, r * 0.75, 0, P, 2 * P);
        g.closePath();
        g.fill();
        g.stroke();
        g.beginPath();
        g.roundRect(x - r * 1.05, y - r * 0.42, r * 2.1, r * 0.22, r * 0.1);
        g.fill();
        g.stroke();
        break;
      case 'beanie':
        g.fillStyle = fan.shirt2;
        g.beginPath();
        g.ellipse(x, y - r * 0.3, r * 0.98, r * 0.9, 0, P, 2 * P);
        g.closePath();
        g.fill();
        g.stroke();
        g.beginPath();
        g.roundRect(x - r * 1.0, y - r * 0.45, r * 2, r * 0.3, r * 0.12);
        g.fill();
        g.stroke();
        break;
      case 'phones':
        g.beginPath();
        g.ellipse(x, y - r * 0.3, r * 0.92, r * 0.72, 0, P, 2 * P);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = INK;
        g.lineWidth = r * 0.16;
        g.beginPath();
        g.arc(x, y, r * 1.05, P * 1.1, P * 1.9);
        g.stroke();
        g.fillStyle = fan.shirt2;
        g.lineWidth = ol;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.roundRect(x + side * r * 0.95 - r * 0.18, y - r * 0.25, r * 0.36, r * 0.55, r * 0.14);
          g.fill();
          g.stroke();
        }
        break;
      case 'bald':
        break;
    }
  }

  private drawProp(g: CanvasRenderingContext2D, fan: Fan, hand: { x: number; y: number }, fore: number, s: number, ol: number, effects: boolean) {
    g.save();
    g.translate(hand.x, hand.y);
    g.rotate(fore + Math.PI / 2);
    if (fan.prop === 'stick') {
      const len = s * 0.6;
      if (effects) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = fan.stick + '38';
        g.beginPath();
        g.roundRect(-s * 0.12, -len - s * 0.1, s * 0.24, len + s * 0.1, s * 0.12);
        g.fill();
        g.globalCompositeOperation = 'source-over';
      }
      g.fillStyle = fan.stick;
      g.strokeStyle = INK;
      g.lineWidth = ol * 0.8;
      g.beginPath();
      g.roundRect(-s * 0.045, -len, s * 0.09, len, s * 0.045);
      g.fill();
      g.stroke();
    } else {
      // phone held up, screen lit
      g.fillStyle = INK;
      g.beginPath();
      g.roundRect(-s * 0.1, -s * 0.36, s * 0.2, s * 0.32, s * 0.04);
      g.fill();
      g.fillStyle = '#dfe9ff';
      g.fillRect(-s * 0.07, -s * 0.33, s * 0.14, s * 0.25);
      if (effects) {
        g.globalCompositeOperation = 'lighter';
        const glow = g.createRadialGradient(0, -s * 0.2, 0, 0, -s * 0.2, s * 0.45);
        glow.addColorStop(0, 'rgba(220,233,255,0.35)');
        glow.addColorStop(1, 'rgba(220,233,255,0)');
        g.fillStyle = glow;
        g.fillRect(-s * 0.45, -s * 0.65, s * 0.9, s * 0.9);
      }
    }
    g.restore();
  }

  // ------------------------------------------------------------- lights

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
      const y = v.H * (0.74 + fl.y * 0.14);
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
