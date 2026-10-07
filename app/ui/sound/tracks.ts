/**
 * D2e · The ambient soundtracks. Each file is a 96 kbps MP3 under 900 KB, built from the original in /art-source by
 * scripts/build-art.mjs. Titles come from the original file names. Every track was made with AI (DaVinci AI) and is
 * labeled as such wherever tracks are listed (the sound panel and /credits). Keep docs/design/ASSETS.md in step.
 */
export type Track = { id: string; title: string; mood: string; file: string; tool: string; aiLabel: string };

const AI = "AI-generated music";

export const TRACKS: readonly Track[] = [
  { id: "calm", title: "Calm", mood: "Calm ambient instrumental loop", file: "/audio/ambient-loop.mp3", tool: "DaVinci AI", aiLabel: AI },
  { id: "focus", title: "Focus", mood: "Calm ambient instrumental loop", file: "/audio/focus.mp3", tool: "DaVinci AI", aiLabel: AI },
  { id: "deep-study", title: "Deep study", mood: "Quiet ambient instrumental loop", file: "/audio/deep-study.mp3", tool: "DaVinci AI", aiLabel: AI },
  { id: "night", title: "Night", mood: "Dark, calm ambient instrumental loop", file: "/audio/night.mp3", tool: "DaVinci AI", aiLabel: AI },
];

export const DEFAULT_TRACK = TRACKS[0].id;
export const trackById = (id: string): Track => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
