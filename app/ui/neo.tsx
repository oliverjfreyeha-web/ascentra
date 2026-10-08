"use client";

import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import "./neo.css";

/**
 * D5 · Course UI: solid, softly raised and pressed surfaces for the parts of learning that carry data: progress,
 * charts, video and text entry. Rule: glass is for navigation, overlays and hero cards; these are never placed on a
 * glass layer (the CSS gives them their own opaque Black Iris surface so they read the same on every scene).
 */
export function NeoCard({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <Tag className={`neo-card ${className}`.trim()}>{children}</Tag>;
}

export function NeoWell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`neo-well ${className}`.trim()}>{children}</div>;
}

/** A progress bar: a pressed track with a raised fill. The native <progress> carries the value for assistive tech. */
export function NeoProgress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="neo-progress">
      <progress className="sr-only" value={value} max={max} aria-label={label}>{Math.round(pct)}%</progress>
      <div className="neo-progress__track" aria-hidden="true"><div className="neo-progress__fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** A progress ring, with the number in the middle. */
export function NeoRing({ value, max = 100, label, size = 96 }: { value: number; max?: number; label: string; size?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)), r = 40, c = 2 * Math.PI * r;
  return (
    <div className="neo-ring" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="neo-ring__track" />
        <circle cx="50" cy="50" r={r} className="neo-ring__fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 50 50)" />
      </svg>
      <span aria-hidden="true">{Math.round(pct * 100)}%</span>
    </div>
  );
}

/** A line chart in a pressed well. `points` are values; `labels` name each point (both are read out as a table). */
export function NeoChart({ points, labels, title }: { points: number[]; labels: string[]; title: string }) {
  const max = Math.max(1, ...points), w = 300, h = 120, step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / max) * (h - 12) - 6).toFixed(1)}`).join(" ");
  return (
    <figure className="neo-chart">
      <figcaption>{title}</figcaption>
      <NeoWell>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={`${d} L${w},${h} L0,${h} Z`} className="neo-chart__area" />
          <path d={d} className="neo-chart__line" vectorEffect="non-scaling-stroke" />
        </svg>
      </NeoWell>
      <table className="sr-only"><caption>{title}</caption><tbody>{points.map((v, i) => <tr key={i}><th scope="row">{labels[i]}</th><td>{v}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** A video frame: raised bezel, dark screen, a play button. `children` is the <video> (or a still) when there is one. */
export function NeoVideo({ title, children, onPlay }: { title: string; children?: ReactNode; onPlay?: () => void }) {
  return (
    <div className="neo-video">
      <div className="neo-video__screen">{children}</div>
      <button type="button" className="neo-video__play ui-plain" onClick={onPlay} aria-label={`Play: ${title}`}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
      </button>
    </div>
  );
}

export function NeoInput({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label className="neo-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className="neo-input" {...rest} />
    </label>
  );
}

export function NeoToggle({ label, defaultOn = false, onChange }: { label: string; defaultOn?: boolean; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button type="button" role="switch" aria-checked={on} className="neo-toggle ui-plain" onClick={() => { setOn(!on); onChange?.(!on); }}>
      <span className="neo-toggle__track" aria-hidden="true"><span className="neo-toggle__knob" /></span>
      <span>{label}</span>
    </button>
  );
}

export function NeoButton({ className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`neo-btn ui-plain ${className}`.trim()} {...rest} />;
}
