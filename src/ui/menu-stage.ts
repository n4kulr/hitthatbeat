import { CREAM, LANE_COLORS, hexA } from '../game/render';

interface Tri {
  x: number;
  y: number;
  size: number;
  speed: number;
  color: string;
  alpha: number;
  depth: number;
}

export interface StageFrame {
  dt: number;
  t: number;
  pulse: number;
  levels: Float32Array;
  /** logo centre and radius in css px; r = 0 when the logo is hidden */
  logo: { x: number; y: number; r: number };
  /** pointer offset from screen centre, -1..1 */
  mx: number;
  my: number;
  effects: boolean;
}

/** The menu backdrop: drifting triangles, colour wash, and a radial spectrum around the logo. */
export class MenuStage {
  private g: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private tris: Tri[] = [];
  private smooth = new Float32Array(0);

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round((this.W * this.H) / 22000);
    while (this.tris.length < want) this.tris.push(this.newTri(Math.random()));
    this.tris.length = want;
  }

  private newTri(y = 1.1): Tri {
    const depth = Math.random();
    const c = Math.random();
    return {
      x: Math.random(),
      y,
      size: 14 + depth * depth * 120,
      speed: 0.012 + Math.random() * 0.02,
      color: c < 0.45 ? CREAM : LANE_COLORS[Math.floor(Math.random() * 4)],
      alpha: 0.02 + Math.random() * 0.045,
      depth,
    };
  }

  draw(f: StageFrame) {
    const { g, W, H } = this;
    g.clearRect(0, 0, W, H);

    // colour wash, breathing with the beat
    const wash = (x: number, y: number, r: number, color: string, a: number) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, hexA(color, a));
      grad.addColorStop(1, hexA(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    };
    const R = Math.max(W, H);
    wash(W * 0.15 - f.mx * 30, H * 0.1 - f.my * 30, R * 0.6, LANE_COLORS[0], 0.16 + f.pulse * 0.05);
    wash(W * 0.9 - f.mx * 30, H * 0.95 - f.my * 30, R * 0.6, LANE_COLORS[3], 0.18 + f.pulse * 0.05);
    if (f.logo.r > 0) wash(f.logo.x, f.logo.y, f.logo.r * 3, '#c77dff', 0.1 + f.pulse * 0.12);

    // triangles drift up, faster on the beat
    if (f.effects) {
      const boost = 1 + f.pulse * 4;
      for (const tr of this.tris) {
        tr.y -= tr.speed * boost * f.dt * (0.5 + tr.depth);
        if (tr.y * H < -tr.size) Object.assign(tr, this.newTri());
        const px = tr.x * W - f.mx * 40 * tr.depth;
        const py = tr.y * H - f.my * 40 * tr.depth;
        const s = tr.size;
        g.beginPath();
        g.moveTo(px, py - s * 0.58);
        g.lineTo(px + s * 0.5, py + s * 0.29);
        g.lineTo(px - s * 0.5, py + s * 0.29);
        g.closePath();
        g.fillStyle = hexA(tr.color, tr.alpha * (1 + f.pulse * 0.6));
        g.fill();
      }
    }

    // radial spectrum hugging the logo, mirrored around so it stays balanced
    if (f.logo.r <= 0) return;
    const n = f.levels.length;
    if (this.smooth.length !== n) this.smooth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = f.levels[i];
      this.smooth[i] = v > this.smooth[i] ? v : this.smooth[i] * Math.pow(0.02, f.dt);
    }
    const REPEAT = 4;
    const bars = n * REPEAT;
    const { x, y, r } = f.logo;
    const spin = f.t * 0.06;
    g.save();
    g.translate(x, y);
    g.lineCap = 'round';
    g.lineWidth = Math.max(2, ((Math.PI * 2 * r) / bars) * 0.55);
    g.strokeStyle = hexA(CREAM, 0.22);
    g.beginPath();
    for (let i = 0; i < bars; i++) {
      const k = i % n;
      // alternate direction per repeat so neighbouring copies meet without a seam
      const v = this.smooth[Math.floor(i / n) % 2 ? n - 1 - k : k];
      const len = 3 + r * 0.42 * Math.pow(v, 1.6);
      const a = (i / bars) * Math.PI * 2 + spin;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.moveTo(c * (r + 4), s * (r + 4));
      g.lineTo(c * (r + 4 + len), s * (r + 4 + len));
    }
    g.stroke();
    g.restore();
  }
}
