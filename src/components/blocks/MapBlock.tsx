"use client";
import "leaflet/dist/leaflet.css";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Blocks } from "@/lib/blocks";

/** A calm map with numbered pins, and the same places listed underneath so nothing depends on the map alone. */
export default function MapBlock({ d }: { d: Blocks["map"] }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(d.markers.map((m) => [m.lat, m.lng, m.title]));

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let gone = false;
    import("leaflet").then(({ default: L }) => {
      if (gone || !el.current) return;
      const touch = window.matchMedia("(pointer: coarse)").matches;
      // On touch screens a one-finger drag scrolls the page, so the map only pans with the buttons.
      map = L.map(el.current, { scrollWheelZoom: false, dragging: !touch, attributionControl: true, zoomControl: true });
      // OpenStreetMap's own tiles: no key or account. The calm, monochrome look (and the dark
      // version) is applied with CSS, see .map-frame in globals.css.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const pts = d.markers.map((m, i) => {
        const icon = L.divIcon({ className: "", html: `<span class="map-pin">${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        const mk = L.marker([m.lat, m.lng], { icon, title: m.title, keyboard: false }).addTo(map!);
        const tip = document.createElement("div");
        tip.textContent = m.title;
        mk.bindTooltip(tip, { direction: "top", offset: [0, -12] });
        return [m.lat, m.lng] as [number, number];
      });
      if (pts.length === 1) map.setView(pts[0], 14);
      else map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    });
    return () => {
      gone = true;
      map?.remove();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div ref={el} className="map-frame h-[320px] w-full overflow-hidden rounded-[20px] max-sm:h-[260px]" />
      <ol className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-1.5">
        {d.markers.map((m, i) => {
          const body = (
            <>
              <span className="map-pin !static !h-[22px] !w-[22px] flex-none !text-[11.5px]">{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{m.title}</span>
                {m.note && <span className="block text-[12.5px] leading-snug text-ink2">{m.note}</span>}
              </span>
              {m.url && <ArrowUpRight size={13} className="ml-auto mt-1 flex-none text-ink3" />}
            </>
          );
          return (
            <li key={i}>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:text-accent">
                  {body}
                </a>
              ) : (
                <div className="flex items-start gap-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
