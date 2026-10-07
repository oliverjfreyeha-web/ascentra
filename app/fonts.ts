import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Serif, Sora } from "next/font/google";

/*
 * Fonts, self-hosted by next/font at build time: served from our own domain (no request to Google from the browser),
 * with size-adjusted fallbacks so the page doesn't shift as they load.
 *   Geist             the interface: clean, technical, very legible at small sizes.
 *   Geist Mono        numbers, IDs and small uppercase labels.
 *   Instrument Serif  display headlines (the current default) and italic accents.
 *   Sora, Bricolage Grotesque  D2c candidates for headlines, compared on the Style guide. Not preloaded: a browser
 *                     only downloads them where they are used (today, only the Style guide's comparison).
 * The headline face is one token, --font-headline in app/styles/tokens.css.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });
const sora = Sora({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sora", display: "swap", preload: false });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-bricolage", display: "swap", preload: false });

export const fontVariables = [geist.variable, geistMono.variable, instrumentSerif.variable, sora.variable, bricolage.variable].join(" ");
