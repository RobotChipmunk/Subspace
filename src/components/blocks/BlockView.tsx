"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleAlert, Info, Minus, Scale, Star, ThumbsUp } from "lucide-react";
import MarkdownIt from "markdown-it";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hash, useDark } from "@/lib/client";
import type { AnyBlock, Blocks, BlockType, CardItem } from "@/lib/blocks";
import { PALETTES } from "@/lib/palettes";
import { mesh } from "../bits";

const MapBlock = dynamic(() => import("./MapBlock"), { ssr: false, loading: () => <div className="shimmer h-[320px] rounded-[20px]" /> });
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const host = (url: string) => {
  try {
    return new URL(url, "https://x").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const external = (url: string) => (url.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" });

function Heading({ children }: { children?: ReactNode }) {
  return children ? <div className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink3">{children}</div> : null;
}

/** A picture that degrades to a soft gradient tile when the image is missing or will not load. */
function Picture({ src, label, className = "" }: { src?: string; label: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const seed = hash(label);
  const p = PALETTES[seed % PALETTES.length];
  if (!src || broken)
    return (
      <div className={`grid place-items-center text-[22px] font-semibold ${className}`} style={{ ...mesh(seed, p.colors), color: p.ink }} aria-hidden>
        {label.trim().slice(0, 1).toUpperCase()}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`bg-fill object-cover ${className}`} />;
}

function Stars({ value, reviews }: { value: number; reviews?: number | string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-ink2" title={`${value} out of 5`}>
      <span className="relative inline-flex text-[var(--fill-strong)]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={12} fill="currentColor" strokeWidth={0} />
        ))}
        <span className="absolute inset-y-0 left-0 flex overflow-hidden text-[#f0a020]" style={{ width: `${(value / 5) * 100}%` }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={12} fill="currentColor" strokeWidth={0} className="flex-none" />
          ))}
        </span>
      </span>
      <span className="font-medium tabular-nums text-ink">{value.toFixed(1)}</span>
      {reviews !== undefined && <span className="text-ink3">({typeof reviews === "number" ? reviews.toLocaleString() : reviews})</span>}
    </span>
  );
}

function CardShell({ item, className, children }: { item: CardItem; className: string; children: ReactNode }) {
  return item.url ? (
    <a href={item.url} {...external(item.url)} className={`${className} transition-[transform,box-shadow] duration-300 ease-out-soft hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]`}>
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

function Card({ item, wide }: { item: CardItem; wide?: boolean }) {
  const meta = [...(item.meta ?? []), ...(item.tags ?? [])].slice(0, 4);
  return (
    <CardShell item={item} className={`block-card group/card flex flex-col overflow-hidden rounded-[20px] ${wide ? "w-[236px] flex-none snap-start" : ""}`}>
      <div className="relative">
        <Picture src={item.image} label={item.title} className="aspect-[4/3] w-full" />
        {item.badge && <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11.5px] font-medium text-white backdrop-blur-md">{item.badge}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{item.title}</div>
          {item.price && <div className="flex-none text-[14.5px] font-semibold tabular-nums">{item.price}</div>}
        </div>
        {item.subtitle && <div className="truncate text-[13px] text-ink2">{item.subtitle}</div>}
        {item.rating !== undefined && <Stars value={item.rating} reviews={item.reviews} />}
        {item.description && <p className="line-clamp-3 text-[13px] leading-snug text-ink2">{item.description}</p>}
        {meta.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {meta.map((m) => (
              <span key={m} className="rounded-full bg-fill px-2 py-0.5 text-[11.5px] text-ink2">
                {m}
              </span>
            ))}
          </div>
        )}
        {item.url && (
          <div className="mt-auto flex items-center gap-1 pt-1.5 text-[12.5px] text-ink3 transition-colors group-hover/card:text-accent">
            <span className="truncate">{item.link_label ?? host(item.url)}</span>
            <ArrowUpRight size={12} className="flex-none" />
          </div>
        )}
      </div>
    </CardShell>
  );
}

function Row({ item }: { item: CardItem }) {
  const meta = [item.subtitle, ...(item.meta ?? [])].filter(Boolean).slice(0, 3);
  return (
    <CardShell item={item} className="group/card flex items-center gap-3.5 rounded-[16px] p-2 pr-3 hover:bg-fill">
      <span className="h-16 w-16 flex-none overflow-hidden rounded-[12px]"><Picture src={item.image} label={item.title} className="h-full w-full" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold">{item.title}</span>
          {item.badge && <span className="flex-none rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">{item.badge}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink2">
          {item.rating !== undefined && <Stars value={item.rating} reviews={item.reviews} />}
          {meta.length > 0 && <span className="truncate">{meta.join(" · ")}</span>}
        </div>
        {item.description && <p className="line-clamp-2 text-[13px] leading-snug text-ink2">{item.description}</p>}
      </div>
      {item.price && <div className="flex-none text-[14.5px] font-semibold tabular-nums">{item.price}</div>}
      {item.url && <ArrowUpRight size={15} className="flex-none text-ink3 transition-colors group-hover/card:text-accent" />}
    </CardShell>
  );
}

function Cards({ d }: { d: Blocks["cards"] }) {
  if (d.layout === "list")
    return (
      <div className="-mx-2 flex flex-col">
        {d.items.map((it, i) => (
          <Row key={i} item={it} />
        ))}
      </div>
    );
  if (d.layout === "carousel")
    return (
      <div data-scroll-x className="carousel -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3 pt-1">
        {d.items.map((it, i) => (
          <Card key={i} item={it} wide />
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-3">
      {d.items.map((it, i) => (
        <Card key={i} item={it} />
      ))}
    </div>
  );
}

function Stats({ d }: { d: Blocks["stats"] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2.5">
      {d.items.map((s, i) => {
        const Trend = s.trend === "up" ? ArrowUpRight : s.trend === "down" ? ArrowDownRight : ArrowRight;
        return (
          <div key={i} className="block-card rounded-[18px] p-3.5">
            <div className="truncate text-[12.5px] text-ink2">{s.label}</div>
            <div className="mt-0.5 text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{s.value}</div>
            {(s.delta || s.note) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink2">
                {s.delta && (
                  <span className={`inline-flex items-center gap-0.5 font-medium ${s.trend === "up" ? "text-[var(--good)]" : s.trend === "down" ? "text-danger" : "text-ink2"}`}>
                    {s.trend && <Trend size={13} />}
                    {s.delta}
                  </span>
                )}
                {s.note && <span className="text-ink3">{s.note}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Table({ d }: { d: Blocks["table"] }) {
  const hi = d.highlight_column;
  return (
    <figure>
      <div data-scroll-x className="block-card overflow-x-auto rounded-[18px]">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr>
              {d.columns.map((c, i) => (
                <th key={i} className={`whitespace-nowrap px-3.5 pb-2 pt-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink3 ${i === hi ? "bg-accent-soft text-accent" : ""}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i} className="border-t hairline">
                {r.map((c, j) => (
                  <td key={j} className={`px-3.5 py-2.5 align-top ${j === 0 ? "font-medium" : "text-ink2"} ${typeof c === "number" ? "tabular-nums" : ""} ${j === hi ? "bg-accent-soft !text-ink" : ""}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.caption && <figcaption className="mt-1.5 px-1 text-[12.5px] text-ink3">{d.caption}</figcaption>}
    </figure>
  );
}

function Timeline({ d }: { d: Blocks["timeline"] }) {
  return (
    <ol className="relative">
      {d.items.length > 1 && <span className="absolute bottom-3 left-[5px] top-3 w-px bg-[var(--fill-strong)]" />}
      {d.items.map((t, i) => (
        <li key={i} className="relative flex gap-4 pb-4 last:pb-0">
          <span className="relative mt-[7px] h-[11px] w-[11px] flex-none rounded-full border-2 border-[var(--surface-solid)] bg-accent" />
          <div className="min-w-0 flex-1">
            {t.when && <div className="text-[12.5px] font-medium text-ink3">{t.when}</div>}
            {t.url ? (
              <a href={t.url} {...external(t.url)} className="text-[15px] font-semibold hover:text-accent">
                {t.title}
              </a>
            ) : (
              <div className="text-[15px] font-semibold">{t.title}</div>
            )}
            {t.text && <p className="text-[14px] leading-snug text-ink2">{t.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const TONES = {
  info: { Icon: Info, cls: "bg-fill", ink: "text-ink2" },
  good: { Icon: ThumbsUp, cls: "bg-[color-mix(in_srgb,var(--good)_13%,transparent)]", ink: "text-[var(--good)]" },
  warn: { Icon: CircleAlert, cls: "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)]", ink: "text-[var(--warn)]" },
  decision: { Icon: Scale, cls: "bg-accent-soft", ink: "text-accent" },
};

function Callout({ d }: { d: Blocks["callout"] }) {
  const t = TONES[d.tone ?? "info"];
  return (
    <div className={`flex gap-3 rounded-[18px] p-4 ${t.cls}`}>
      <t.Icon size={18} className={`mt-0.5 flex-none ${t.ink}`} />
      <div className="min-w-0">
        {d.title && <div className="text-[15px] font-semibold">{d.title}</div>}
        <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{d.text}</p>
      </div>
    </div>
  );
}

function ProsCons({ d }: { d: Blocks["proscons"] }) {
  const col = (items: string[], good: boolean) => (
    <div className="block-card min-w-0 flex-1 rounded-[18px] p-3.5">
      <div className={`mb-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] ${good ? "text-[var(--good)]" : "text-danger"}`}>{good ? "For" : "Against"}</div>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-[14px] leading-snug">
            {good ? <Check size={15} className="mt-0.5 flex-none text-[var(--good)]" /> : <Minus size={15} className="mt-0.5 flex-none text-danger" />}
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex gap-2.5 max-sm:flex-col">
      {d.pros.length > 0 && col(d.pros, true)}
      {d.cons.length > 0 && col(d.cons, false)}
    </div>
  );
}

// Categorical series colours, in fixed order. Validated for colour-blind separation on the app's
// light and dark surfaces; several sit under 3:1 contrast in light mode, so values are always
// available as text (direct labels, the hover readout and the data table).
const SERIES = { light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"], dark: ["#3987e5", "#d95926", "#199e70", "#c98500"] };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** "$" goes in front, "%" or "km" behind, and "$B" splits into both: $2B. */
const fmt = (v: number, unit = "") => {
  const s = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100);
  const m = unit.match(/^([$£€¥]?)(.*)$/)!;
  return m[1] + s + m[2];
};

/** The chart is drawn at the size it is shown, so its text stays readable on a phone. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Chart({ d }: { d: Blocks["chart"] }) {
  const dark = useDark();
  const colors = dark ? SERIES.dark : SERIES.light;
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [frame, W] = useWidth(640);
  const H = W < 420 ? 210 : 260, L = 46, R = 12, T = 16, B = 28;
  const all = d.series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = niceMax(Math.max(...all, 0));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const n = d.labels.length;
  const band = (W - L - R) / n;
  const x = (i: number) => L + band * (i + 0.5);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * t);
  const many = d.series.length > 1;
  const every = Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 56)));

  if (asTable)
    return (
      <div>
        <Table d={{ columns: ["", ...d.series.map((s, i) => s.name ?? d.title ?? `Series ${i + 1}`)], rows: d.labels.map((l, i) => [l, ...d.series.map((s) => fmt(s.values[i], d.unit))]) }} />
        <button onClick={() => setAsTable(false)} className="mt-1.5 px-1 text-[12.5px] text-ink3 hover:text-ink2">
          Show chart
        </button>
      </div>
    );

  return (
    <figure className="block-card rounded-[18px] p-3.5">
      {many && (
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12.5px] text-ink2">
          {d.series.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="relative" ref={frame}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={d.title ?? "Chart"} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-[var(--ink-3)] text-[11px] tabular-nums">
                {fmt(t, d.unit)}
              </text>
            </g>
          ))}
          {d.labels.map((l, i) =>
            i % every === 0 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">
                {String(l).slice(0, 12)}
              </text>
            ) : null,
          )}
          {hover !== null && <rect x={L + band * hover} y={T} width={band} height={H - T - B} fill="var(--fill)" rx={6} />}
          {d.kind === "bar"
            ? d.series.map((s, si) => {
                const groupW = Math.min(band * 0.72, 56 * d.series.length);
                const w = (groupW - 2 * (d.series.length - 1)) / d.series.length;
                return s.values.map((v, i) => {
                  const x0 = x(i) - groupW / 2 + si * (w + 2);
                  const top = Math.min(y(v), y(0));
                  const h = Math.max(Math.abs(y(v) - y(0)), 1);
                  const r = Math.min(4, w / 2, h);
                  // rounded at the data end only, square on the baseline
                  const path = v >= 0 ? `M${x0},${top + h}V${top + r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${top + h}Z` : `M${x0},${top}V${top + h - r}a${r},${r} 0 0 0 ${r},${r}h${w - 2 * r}a${r},${r} 0 0 0 ${r},-${r}V${top}Z`;
                  return (
                    <g key={`${si}-${i}`}>
                      <path d={path} fill={colors[si]} />
                      {!many && n <= 12 && (
                        <text x={x0 + w / 2} y={top - 5} textAnchor="middle" className="fill-[var(--ink-2)] text-[11px] font-medium tabular-nums">
                          {fmt(v, d.unit)}
                        </text>
                      )}
                    </g>
                  );
                });
              })
            : d.series.map((s, si) => (
                <g key={si}>
                  <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={colors[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {s.values.map((v, i) => (i === hover || i === n - 1 ? <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={colors[si]} stroke="var(--surface-solid)" strokeWidth={2} /> : null))}
                  {d.series.length <= 4 && (
                    <text x={x(n - 1) - 8} y={y(s.values[n - 1]) - 9} textAnchor="end" className="fill-[var(--ink-2)] text-[11px] font-medium tabular-nums">
                      {many ? s.name : fmt(s.values[n - 1], d.unit)}
                    </text>
                  )}
                </g>
              ))}
          {d.labels.map((_, i) => (
            <rect key={i} x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <div className="menu pointer-events-none absolute top-1 z-10 rounded-xl px-2.5 py-1.5 text-[12.5px]" style={hover < n / 2 ? { left: `${((L + band * (hover + 1)) / W) * 100}%` } : { right: `${(1 - (L + band * hover) / W) * 100}%` }}>
            <div className="font-medium">{d.labels[hover]}</div>
            {d.series.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-ink2">
                {many && <span className="h-2 w-2 rounded-[2px]" style={{ background: colors[i] }} />}
                {many && <span>{s.name}</span>}
                <span className="ml-auto pl-2 font-medium tabular-nums text-ink">{fmt(s.values[hover], d.unit)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => setAsTable(true)} className="mt-1 px-1 text-[12.5px] text-ink3 hover:text-ink2">
        Show as table
      </button>
    </figure>
  );
}

function Sources({ d }: { d: Blocks["sources"] }) {
  return (
    <ol className="space-y-1.5">
      {d.items.map((s, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
          <span className="mt-px w-5 flex-none text-right tabular-nums text-ink3">{i + 1}</span>
          <div className="min-w-0">
            <a href={s.url} {...external(s.url)} className="font-medium underline decoration-[var(--line)] underline-offset-[3px] hover:text-accent">
              {s.title}
            </a>
            <span className="text-ink3"> · {[s.publisher ?? host(s.url), s.date].filter(Boolean).join(" · ")}</span>
            {s.note && <div className="text-ink2">{s.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Gallery({ d }: { d: Blocks["gallery"] }) {
  const one = d.items.length === 1;
  return (
    <div className={one ? "" : "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5"}>
      {d.items.map((g, i) => {
        const inner = (
          <figure>
            <div className="overflow-hidden rounded-[16px]"><Picture src={g.image} label={g.caption ?? "Image"} className={`w-full ${one ? "max-h-[440px]" : "aspect-[4/3]"}`} /></div>
            {g.caption && <figcaption className="mt-1 px-0.5 text-[12.5px] leading-snug text-ink3">{g.caption}</figcaption>}
          </figure>
        );
        return g.url ? (
          <a key={i} href={g.url} {...external(g.url)}>
            {inner}
          </a>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </div>
  );
}

function Facts({ d }: { d: Blocks["facts"] }) {
  return (
    <dl className="block-card rounded-[18px] px-3.5 py-1">
      {d.items.map((f, i) => (
        <div key={i} className={`flex gap-4 py-2 text-[14px] ${i ? "border-t hairline" : ""}`}>
          <dt className="w-[36%] flex-none text-ink2">{f.label}</dt>
          <dd className="min-w-0 flex-1 break-words font-medium">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Columns({ d }: { d: Blocks["columns"] }) {
  return (
    <div className="flex gap-4 max-md:flex-col">
      {d.columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          {col.map((b, j) => (
            <BlockView key={j} block={b} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Text({ markdown }: { markdown: string }) {
  const html = useMemo(() => md.render(markdown), [markdown]);
  return <div className="block-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

const VIEWS: { [K in BlockType]: (p: { d: Blocks[K] }) => ReactNode } = {
  cards: Cards,
  map: ({ d }) => <MapBlock d={d} />,
  columns: Columns,
  stats: Stats,
  table: Table,
  timeline: Timeline,
  callout: Callout,
  proscons: ProsCons,
  chart: Chart,
  sources: Sources,
  gallery: Gallery,
  facts: Facts,
};

/** Draws one block. The data has already been validated. */
export function BlockView({ block }: { block: AnyBlock }) {
  if (block.type === "text") return <Text markdown={(block as { markdown: string }).markdown} />;
  const View = VIEWS[block.type as BlockType] as (p: { d: unknown }) => ReactNode;
  const title = (block as { title?: string }).title;
  return (
    <section>
      {block.type !== "callout" && <Heading>{title}</Heading>}
      <View d={block} />
    </section>
  );
}
