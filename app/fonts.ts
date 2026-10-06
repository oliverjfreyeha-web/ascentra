import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

/*
 * D1 · Fonts, self-hosted by next/font at build time: served from our own domain (no request to Google from the
 * browser), preloaded, with size-adjusted fallbacks so the page doesn't shift as they load.
 *   Geist          the interface: clean, technical, very legible at small sizes.
 *   Geist Mono     numbers, IDs and hashes (tabular, same design family).
 *   Instrument Serif  big display headings only: a calm, slightly artsy contrast to the sans.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap", preload: false });

export const fontVariables = [geist.variable, geistMono.variable, instrumentSerif.variable].join(" ");
