/**
 * The moods a journal entry can carry. A short fixed list, so a month can be read at a glance and
 * counted; each has a tone, which is all the colour it gets (see DESIGN.md, "Mood").
 */
export const MOODS = [
  { name: "Joyful", tone: "up" },
  { name: "Grateful", tone: "up" },
  { name: "Hopeful", tone: "up" },
  { name: "Energised", tone: "up" },
  { name: "Calm", tone: "even" },
  { name: "Curious", tone: "even" },
  { name: "Reflective", tone: "even" },
  { name: "Tired", tone: "down" },
  { name: "Anxious", tone: "down" },
  { name: "Frustrated", tone: "down" },
  { name: "Sad", tone: "down" },
] as const;
export type Tone = "up" | "even" | "down";
export const MOOD_NAMES: string[] = MOODS.map((m) => m.name);
export const toneOf = (mood: string | null | undefined): Tone => MOODS.find((m) => m.name === mood)?.tone ?? "even";
/** The mood as stored, whatever capitals it was given in; null when it is not one of the list. */
export const asMood = (s: unknown): string | null => (typeof s === "string" ? (MOOD_NAMES.find((m) => m.toLowerCase() === s.trim().toLowerCase()) ?? null) : null);
