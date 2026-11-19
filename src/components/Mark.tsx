"use client";
import { useEffect, useRef } from "react";

/**
 * The Subspace mark: particles in a latent space. A sparse sphere of neutral particles is the
 * space; through it, tilted, runs a sheet of coloured ones, the subspace. It turns slowly, so the
 * sheet is seen from every side, and it is drawn for the mode the screen is in: deep colours on
 * light, glowing pastels on dark. The geometry is the same in the iOS app (Design/SubspaceMark.swift)
 * and in the icons (scripts/mark.swift); change all three together.
 *
 * `variant` keeps two other directions that were drawn alongside it: "cloud" (one loose cloud of
 * coloured particles) and "clusters" (three neighbourhoods of meaning, with stragglers).
 */
export type MarkVariant = "plane" | "cloud" | "clusters";

type Particle = { p: [number, number, number]; kind: 0 | 1; t: number; s: number };

const LIGHT = ["#FF8A65", "#F0609E", "#8B6CF6", "#3BA9F5", "#2CC79A", "#F5B62E"];
const DARK = ["#FFC9B5", "#F7B1D0", "#C9B8FF", "#A8E6FF", "#B5F5D8", "#FFE7A8"];
const GOLDEN = 2.39996323;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
/** A colour partway round the palette, as "r, g, b". */
function hue(palette: string[], t: number): string {
  const x = (((t % 1) + 1) % 1) * palette.length;
  const i = Math.floor(x) % palette.length;
  const f = x - Math.floor(x);
  const a = palette[i];
  const b = palette[(i + 1) % palette.length];
  return [0, 1, 2].map((k) => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * f)).join(", ");
}

export function markParticles(variant: MarkVariant): Particle[] {
  const r = rng(11);
  const out: Particle[] = [];
  const tiltX = 0.52;
  const tiltZ = -0.4;
  const tilt = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
    const z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
    return [x * Math.cos(tiltZ) - y1 * Math.sin(tiltZ), x * Math.sin(tiltZ) + y1 * Math.cos(tiltZ), z1];
  };
  if (variant === "plane") {
    // the latent space: a sparse shell of neutral particles
    const n = 58;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * GOLDEN;
      const k = 0.88 + r() * 0.12;
      out.push({ p: [Math.cos(th) * rad * k, y * k, Math.sin(th) * rad * k], kind: 0, t: 0, s: 0.7 + r() * 0.6 });
    }
    // the subspace: a tilted sheet of coloured particles through its middle
    const m = 72;
    for (let i = 0; i < m; i++) {
      const a = i * GOLDEN;
      const d = Math.sqrt((i + 0.5) / m) * 0.8;
      const lift = (r() - 0.5) * 0.05;
      out.push({ p: tilt([Math.cos(a) * d, lift, Math.sin(a) * d]), kind: 1, t: (a / (2 * Math.PI)) % 1, s: 0.75 + r() * 0.5 });
    }
  } else if (variant === "cloud") {
    const n = 120;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * GOLDEN;
      const k = 0.35 + Math.pow(r(), 0.6) * 0.6;
      out.push({ p: [Math.cos(th) * rad * k, y * k, Math.sin(th) * rad * k], kind: 1, t: (th / (2 * Math.PI)) % 1, s: 0.5 + r() * 0.8 });
    }
  } else {
    const centres: [number, number, number][] = [[-0.5, 0.28, 0.1], [0.45, 0.4, -0.25], [0.05, -0.5, 0.3]];
    centres.forEach((c, k) => {
      for (let i = 0; i < 30; i++) {
        const g = () => (r() + r() + r() - 1.5) * 0.36;
        const x = c[0] + g();
        const y = c[1] + g();
        const z = c[2] + g();
        out.push({ p: [x, y, z], kind: 1, t: k / 3 + (r() - 0.5) * 0.12, s: 0.55 + r() * 0.7 });
      }
    });
    for (let i = 0; i < 26; i++) {
      const th = r() * 6.283;
      const y = r() * 2 - 1;
      const rad = Math.sqrt(1 - y * y);
      const k = 0.5 + r() * 0.5;
      out.push({ p: [Math.cos(th) * rad * k, y * k, Math.sin(th) * rad * k], kind: 0, t: 0, s: 0.5 + r() * 0.4 });
    }
  }
  return out;
}

/** One frame: the particles turned by `angle` about the upright axis and drawn back to front. */
function paint(ctx: CanvasRenderingContext2D, particles: Particle[], px: number, dark: boolean, angle: number) {
  const palette = dark ? DARK : LIGHT;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const span = 0.4;
  const seen = particles
    .map((q) => {
      const X = q.p[0] * c + q.p[2] * s;
      const Z = -q.p[0] * s + q.p[2] * c;
      const k = 1 / (1 - Z * 0.22);
      return { x: (0.5 + X * span * k) * px, y: (0.5 - q.p[1] * span * k) * px, depth: (Z + 1) / 2, k, q };
    })
    .sort((a, b) => a.depth - b.depth);
  ctx.clearRect(0, 0, px, px);
  for (const e of seen) {
    const colour = e.q.kind ? hue(palette, e.q.t) : dark ? "255, 255, 255" : "23, 23, 28";
    const radius = (((e.q.kind ? 2.05 : 1.15) * e.q.s * (0.6 + 0.4 * e.depth) * e.k) / 100) * px;
    const opacity = e.q.kind ? 0.45 + 0.55 * e.depth : dark ? 0.16 + 0.44 * e.depth : 0.12 + 0.36 * e.depth;
    // on dark the coloured particles glow a little
    ctx.shadowBlur = dark && e.q.kind ? radius * 1.6 : 0;
    ctx.shadowColor = `rgba(${colour}, ${(0.55 * opacity).toFixed(3)})`;
    ctx.fillStyle = `rgba(${colour}, ${opacity.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The mark at `size` CSS pixels square. It turns once a minute, and holds still for anyone who has asked for less motion. */
export function Mark({ size = 96, variant = "plane", className = "" }: { size?: number; variant?: MarkVariant; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const particles = markParticles(variant);
    const scale = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(size * scale);
    canvas.width = px;
    canvas.height = px;
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      // thirty frames a second is plenty for something this slow
      if (now - last >= 33 || still) {
        last = now;
        paint(ctx, particles, px, darkQuery.matches, 0.5 + (still ? 0 : ((now - start) / 60_000) * Math.PI * 2));
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const redraw = () => still && requestAnimationFrame(draw);
    darkQuery.addEventListener("change", redraw);
    return () => {
      cancelAnimationFrame(frame);
      darkQuery.removeEventListener("change", redraw);
    };
  }, [size, variant]);
  return <canvas ref={ref} data-mark={variant} aria-hidden className={className} style={{ width: size, height: size }} />;
}
