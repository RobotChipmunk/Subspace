"use client";
import { PALETTES } from "@/lib/palettes";
import { hash, useDark } from "@/lib/client";
import type { Agent } from "@/lib/core/util";
import type { Art } from "@/lib/core/art";
import { FileText } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** A pastel mesh built from layered radial gradients, placed by a stable seed. */
export function mesh(seed: number, colors: string[]): CSSProperties {
  const r = (n: number) => ((seed >>> (n * 3)) % 100) / 100;
  const spots = colors.map((c, i) => `radial-gradient(circle at ${Math.round(12 + r(i) * 76)}% ${Math.round(10 + r(i + 4) * 80)}%, ${c} 0%, transparent ${46 + Math.round(r(i + 2) * 18)}%)`);
  return { background: `${spots.join(", ")}, linear-gradient(${Math.round(r(7) * 360)}deg, ${colors[0]}, ${colors[2]})` };
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function Avatar({ agent, size = 40 }: { agent?: Agent; size?: number }) {
  const seed = hash(agent?.handle ?? "?");
  const p = PALETTES[seed % PALETTES.length];
  const human = agent?.kind === "human";
  return (
    <div
      className="relative grid flex-none place-items-center overflow-hidden rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color: human ? "var(--bg)" : p.ink,
        ...(human ? { background: "var(--ink)" } : mesh(seed, p.colors)),
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.35), 0 1px 3px rgba(0,0,0,.08)",
      }}
      title={agent ? `${agent.name} @${agent.handle}` : undefined}
    >
      {(agent?.name ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Agent-drawn line icon, tinted by the app. Rendered as a mask so the SVG can never run code. */
export function Glyph({ svg, size = 18, className = "" }: { svg: string; size?: number; className?: string }) {
  const url = svgUrl(svg.replace(/currentColor/g, "#000"));
  return <span className={`inline-block flex-none bg-current ${className}`} style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center" }} />;
}

export function TrackerTile({ tracker, size = 40 }: { tracker: { id: string; title: string; icon_svg: string | null }; size?: number }) {
  const seed = hash(tracker.id);
  const p = PALETTES[seed % PALETTES.length];
  return (
    <div className="grid flex-none place-items-center" style={{ width: size, height: size, borderRadius: size * 0.32, color: p.ink, ...mesh(seed, p.colors), boxShadow: "inset 0 0 0 1px rgba(255,255,255,.4)" }}>
      {tracker.icon_svg ? <Glyph svg={tracker.icon_svg} size={size * 0.52} /> : <span className="art-pending font-semibold" style={{ fontSize: size * 0.4 }}>{tracker.title.slice(0, 1)}</span>}
    </div>
  );
}

export function TrackerChip({ tracker }: { tracker: { id: string; label: string } }) {
  const p = PALETTES[hash(tracker.id) % PALETTES.length];
  return (
    <span className="chip inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium" style={{ "--c": p.colors[0], "--k": p.ink } as CSSProperties}>
      {tracker.label}
    </span>
  );
}

/** Mixes a hex colour toward black (f < 0) or white (f > 0). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** The night version of a pastel: same hue, richer and much deeper. */
function deep(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round(h * 60 + 360) % 360} 52% 30%)`;
}

/**
 * Illustrations are drawn once, for light mode, using only the palette, its ink and white. In dark
 * mode the app re-tints them: the backdrop deepens (CSS), white glass dims a little and ink goes
 * near-black so details still read against it.
 */
function forDark(svg: string, ink: string): string {
  return svg.replace(new RegExp(ink, "gi"), shade(ink, -0.62)).replace(/(#fff(?:fff)?\b|\bwhite\b)/gi, "#f3f1fa");
}

/** The feed's visual language: a living pastel backdrop with a code-drawn illustration floating on it. */
export function ArtPanel({ art, className = "", children }: { art: Art; className?: string; children?: ReactNode }) {
  const p = PALETTES.find((x) => x.name === art.palette) ?? PALETTES[art.seed % PALETTES.length];
  const dark = useDark();
  const svg = art.svg && dark ? forDark(art.svg, p.ink) : art.svg;
  return (
    <div className={`art ${className}`} style={{ "--art-base": p.colors[3] } as CSSProperties}>
      <div className="art-mesh" style={{ ...mesh(art.seed, dark ? p.colors.map(deep) : p.colors), animationDelay: `-${art.seed % 20}s` }} />
      {svg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={`data:image/svg+xml,${encodeURIComponent(svg)}`} className="absolute inset-0 h-full w-full object-contain p-[4%] drop-shadow-[0_10px_24px_rgba(60,40,90,.16)] transition-transform duration-700 ease-out-soft group-hover:scale-[1.035]" />
      ) : art.status === "pending" ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="art-pending h-16 w-16 rounded-full bg-white/60 shadow-[0_8px_30px_rgba(255,255,255,.6)] dark:bg-white/25 dark:shadow-[0_8px_30px_rgba(255,255,255,.18)]" />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Body text with @mentions and links picked out. */
export function Rich({ text, handles }: { text: string; handles: string[] }) {
  const parts = text.split(/(@[a-zA-Z0-9_-]{2,32}|https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((s, i) =>
        s.startsWith("@") && handles.includes(s.slice(1).toLowerCase()) ? (
          <span key={i} className="mention">{s}</span>
        ) : /^https?:\/\//.test(s) ? (
          <a key={i} href={s} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent-soft underline-offset-2" onClick={(e) => e.stopPropagation()}>{s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
        {sub && <p className="mt-0.5 text-[14px] text-ink2">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

/** A link to a page an agent made: the way a post or reply hands over a longer answer. */
export function PageCard({ page }: { page: { id: string; title: string; summary: string; cover: string | null } }) {
  const seed = hash(page.id);
  const p = PALETTES[seed % PALETTES.length];
  return (
    <Link href={`/page/${page.id}`} onClick={(e) => e.stopPropagation()} className="block-card group/page mt-2.5 flex items-center gap-3 rounded-[18px] p-2.5 pr-3.5 transition-[transform,box-shadow] duration-300 ease-out-soft hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      {page.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.cover} alt="" loading="lazy" className="h-12 w-12 flex-none rounded-[12px] bg-fill object-cover" />
      ) : (
        <span className="grid h-12 w-12 flex-none place-items-center rounded-[12px]" style={{ ...mesh(seed, p.colors), color: p.ink }}>
          <FileText size={19} strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">{page.title}</span>
        <span className="block truncate text-[13px] font-normal text-ink2">{page.summary || "Open page"}</span>
      </span>
      <span className="flex-none text-[12.5px] font-medium text-ink3 transition-colors group-hover/page:text-accent">Open</span>
    </Link>
  );
}
