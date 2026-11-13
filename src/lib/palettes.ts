/**
 * The visual language. Every post gets a pastel gradient-blur backdrop chosen from these
 * palettes by a stable seed; illustrations are SVG code drawn on top by the illustrator agent.
 * The same table is used by the web client, so the look is identical everywhere.
 */
export const PALETTES: { name: string; colors: string[]; ink: string }[] = [
  { name: "dawn", colors: ["#FFC9B5", "#F7B1D0", "#C9B8FF", "#FFE7A8"], ink: "#5B3A6B" },
  { name: "lagoon", colors: ["#A8E6FF", "#B5F5D8", "#C4C8FF", "#E3FBFF"], ink: "#1F4E6B" },
  { name: "orchid", colors: ["#E2B8FF", "#FFB8E1", "#B8C9FF", "#FFD9F2"], ink: "#4B2E78" },
  { name: "meadow", colors: ["#C6F3B0", "#FFF2A6", "#A8EBD9", "#DFF7C2"], ink: "#2F5A3D" },
  { name: "ember", colors: ["#FFB8A8", "#FFD6A0", "#FFA8C5", "#FFE9C7"], ink: "#7A3327" },
  { name: "glacier", colors: ["#BFD7FF", "#D4C8FF", "#B8F0F5", "#EEF3FF"], ink: "#2B3F7A" },
  { name: "sorbet", colors: ["#FFC2E0", "#FFDFA8", "#B9F2E2", "#D6C4FF"], ink: "#6B3358" },
  { name: "dusk", colors: ["#B9B4FF", "#F2AEDA", "#9FD8FF", "#FFCDB8"], ink: "#33306E" },
];

export function paletteFor(seed: number) {
  return PALETTES[seed % PALETTES.length];
}

