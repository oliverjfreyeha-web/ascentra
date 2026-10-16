import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Lenis from "lenis";
import CountUp from "./CountUp.jsx";
import SpecularButton from "./SpecularButton.jsx";
import Earth from "./Earth.jsx";
import Hall from "./Hall.jsx";
import Fire from "./Fire.jsx";
import Art3D from "./Art3D.jsx";
import Aurora from "./Aurora.jsx";
import { I } from "./Icons.jsx";
import { playReward, sfx, setSound } from "./audio.js";
import { scanLens, clearLens, lensSupported } from "./Lens.js";

const Seg = ({ v, set, opts }) => <div className="mseg" role="group">{opts.map(([k, l]) => <button key={k} aria-pressed={v === k} onClick={() => set(k)}>{l}</button>)}</div>;

function CoinCSS({ icon, on = true, label }) {
  return <div className={"coinw" + (on ? "" : " locked")}><div className="coin"><span className="face"><I n={icon} s={30} /></span><i className="shine" /></div><small>{label}</small></div>;
}
function TrophyCSS({ place, on = true, label }) {
  const id = "tg" + place + (on ? "a" : "b");
  return <div className={"trophy" + (on ? "" : " locked")}><svg viewBox="0 0 80 96" width="84" height="100" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF3C4" /><stop offset=".35" stopColor="#F7C948" /><stop offset=".7" stopColor="#C88A12" /><stop offset="1" stopColor="#8A5A06" /></linearGradient>
      <linearGradient id={id + "s"} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    <path d="M16 14H6c0 14 6 22 15 24M64 14h10c0 14-6 22-15 24" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round" />
    <path d="M16 8h48v22a24 24 0 0 1-48 0z" fill={`url(#${id})`} /><path d="M33 52h14l3 16H30z" fill={`url(#${id})`} /><rect x="22" y="68" width="36" height="8" rx="3" fill={`url(#${id})`} /><rect x="16" y="76" width="48" height="12" rx="4" fill="#3B2A08" /><rect x="16" y="76" width="48" height="4" rx="2" fill={`url(#${id})`} />
    <text x="40" y="38" textAnchor="middle" fontSize="22" fontWeight="800" fill="#7A4B00">{place}</text>
    <rect className="tshine" x="-20" y="6" width="14" height="60" fill={`url(#${id}s)`} transform="skewX(-18)" /></svg><small>{label}</small></div>;
}
function BadgeCSS({ icon, on = true, label }) {
  return <div className={"badge3" + (on ? "" : " locked")}><div className="hex"><span><I n={icon} s={26} /></span></div><small>{label}</small></div>;
}
const LiteCtx = React.createContext(false);
const Coin = (p) => React.useContext(LiteCtx) ? <CoinCSS {...p} /> : <div className={"coinw" + (p.on === false ? " locked" : "")}><Art3D kind="coin" variant={p.icon} locked={p.on === false} w={92} h={92} label={p.label + " coin"} /><small>{p.label}</small></div>;
const Trophy = (p) => React.useContext(LiteCtx) ? <TrophyCSS {...p} /> : <div className={"trophy" + (p.on === false ? " locked" : "")}><Art3D kind="trophy" variant={p.place} locked={p.on === false} w={112} h={140} label={p.label + " trophy"} /><small>{p.label}</small></div>;
const Badge = (p) => React.useContext(LiteCtx) ? <BadgeCSS {...p} /> : <div className={"badge3" + (p.on === false ? " locked" : "")}><Art3D kind="badge" variant={p.icon} locked={p.on === false} w={92} h={100} label={p.label + " badge"} /><small>{p.label}</small></div>;
function Reward({ onDone, reduced, lite, sound }) {
  useEffect(() => { if (sound) playReward(); }, []);
  return <div className={"reward" + (reduced ? " calm" : "")} onClick={onDone} role="dialog" aria-label="Reward unlocked">
    {!reduced && <><div className="flash" /><Fire /></>}
    <div className="rcard g">{lite ? <CoinCSS icon="star" label="" /> : <Art3D kind="coin" variant="star" w={170} h={170} top label="Gold coin" />}<b>Reward unlocked</b><span>Round 1 · Basics badge</span><button className="gbtn" onClick={onDone}>Nice</button></div></div>;
}

function Hud({ page, go, role, setRole, st, setSt, lite }) {
  const [open, setOpen] = useState(false);
  const tabs = [["home", "Home", "home"], ["lib", "Library", "book"], ["rev", "Review", "repeat"], ["profile", "Profile", "user"]]; if (role === "owner") tabs.push(["admin", "Admin", "grid"]);
  return <header className="hud g" data-lens>
    <button className="brand" onClick={() => go("home")}>ASCEN<i>TRA</i></button>
    <nav className="tabs">{tabs.map(([k, l, ic]) => <button key={k} aria-current={page === k || (k === "home" && page === "section")} onClick={() => go(k)}><I n={ic} s={18} /><span>{l}</span></button>)}</nav>
    <div className="mseg role"><button aria-pressed={role === "learner"} onClick={() => { setRole("learner"); go("home"); }}>Learner</button><button aria-pressed={role === "owner"} onClick={() => { setRole("owner"); go("admin"); }}>Owner</button></div>
    <button className="iconb" aria-label="Account settings" onClick={() => go("account")}><I n="user" /></button>
    <button className="iconb" aria-label="Appearance settings" aria-expanded={open} onClick={() => setOpen(!open)}><I n="gear" /></button>
    {open && <div className="pop g" data-lens role="dialog" aria-label="Appearance">
      <b>Appearance</b>
      <label>Theme<Seg v={st.theme} set={(v) => setSt({ ...st, theme: v })} opts={[["iris", "Iris"], ["mono", "Mono"]]} /></label>
      <label>Glass<Seg v={st.glass} set={(v) => setSt({ ...st, glass: v })} opts={[["liquid", "Liquid"], ["frosted", "Frosted"]]} /></label>
            <label>Earth<Seg v={st.earth} set={(v) => setSt({ ...st, earth: v })} opts={[["real", "Realistic"], ["gray", "Gray"]]} /></label>
      <button className="gbtn" onClick={() => { setOpen(false); go("account"); }}>More in Account settings</button>
      <small>{lite ? "3D effects are off on this device (phone, low power, or Motion: Off)." : "On phones and slow devices, 3D effects switch off automatically."}</small>
    </div>}
  </header>;
}

const SECS = [["Basics and rules", "done"], ["Cold email", "open"], ["Messages, calls and video", "open"], ["Warming it up", "next"], ["Tracking and testing", "next"]];

function Home({ go, lite, still, progress, setProgress, tod, setTod }) {
  const pctv = Math.round(progress * 100);
  return <div className="stack">
    <section className="skyline">
      {lite ? <div className="poster"><Hall progress={progress} still phase={tod} /></div> : <Hall progress={progress} still={still} phase={tod} />}
      <div className="skyfade" />
      <div className="herotxt"><div className="eyebrow">Welcome back</div><h1>Cold outreach</h1><p>Learn how a first message works, the rules that apply, and how to practice safely with made-up businesses.</p>
        <div className="nextrow g" data-lens><div><small>Up next</small><b>Section 2 · Cold email</b></div><SpecularButton size="md" radius={16} lineColor="#FFFFFF" baseColor="#2A3550" tint="#FFFFFF" tintOpacity={0.12} textColor="#FFFFFF" onClick={() => go("section")}>Continue</SpecularButton></div>
        <div className="democtl g tod" data-lens><span>Sky</span><Seg v={tod} set={setTod} opts={[["auto", "My clock"], ["dawn", "Dawn"], ["day", "Day"], ["dusk", "Dusk"], ["night", "Night"]]} /></div>
        <label className="democtl g" data-lens><span>Hall lights follow your progress</span><input type="range" min="0" max="100" value={pctv} onChange={(e) => setProgress(+e.target.value / 100)} aria-label="Demo progress" /><b>{pctv}%</b></label></div>
    </section>
    <section className="stats">{[[1, "of 5 sections done"], [11, "points"], [3, "day streak"], [1, "Round of 3"]].map(([n, l]) => <div className="stat" key={l}><b><CountUp to={n} duration={1.2} /></b><span>{l}</span></div>)}</section>
    <section><h2 className="h2">Round 1</h2><div className="secgrid">{SECS.map(([t, s], i) => <button key={t} className="seccard g" onClick={() => go("section")}><i className="sheen" /><span className="n">{i + 1}</span><b>{t}</b><span className={"chip " + s}>{s === "done" ? "Done" : s === "open" ? "Open" : "Next"}</span></button>)}</div><p className="demo">Demo data. Nothing here is a real learner.</p></section>
  </div>;
}

const ALL = [["earth", "Progress globe", 2], ["streak", "Streak", 1], ["points", "Points", 1], ["rank", "All-time rank", 1], ["next", "Next reward", 1], ["medals", "Achievements", 4], ["week", "Activity", 2], ["activity", "Recent activity", 2], ["map", "Course map", 4]];

const BR = [
  { t: "Cold outreach", sub: "Round 1", n: ["Basics", "Cold email", "Messages", "Warming up", "Tracking"], full: SECS.map((x) => x[0]), c: "#9DB4FF" },
  { t: "Copywriting", sub: "Round 1", n: ["Hooks", "Offers", "Proof", "Calls to act", "Testing"], c: "#8FE3D6" },
  { t: "Short-form video", sub: "Round 1", n: ["Hooks", "Scripts", "Filming", "Editing", "Posting"], c: "#F3A6E0" },
];
function CourseMap({ lit, go }) {
  const [hv, setHv] = useState(null);
  const xs = (i) => 214 + i * 118, ys = [66, 170, 274], R = 15, rx = 44, ry = 170;
  const prog = [lit, 0, -1];
  return <div className="treewrap"><svg className="tree" viewBox="0 0 780 345" role="group" aria-label="Course map">
    <defs>{BR.map((b, k) => <linearGradient key={k} id={"tg" + k} x1="0" x2="1"><stop offset="0" stopColor={b.c} stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity=".95" /></linearGradient>)}</defs>
    {BR.map((b, k) => { const y = ys[k], p = `M${rx} ${ry} C ${rx + 62} ${ry}, ${rx + 70} ${y}, 150 ${y}`; const L = prog[k], full = `${p} L ${xs(4)} ${y}`;
      return <g key={k} className={"branch" + (hv === k ? " hv" : "") + (L < 0 ? " locked" : "")} style={{ "--c": b.c, "--bd": k * 140 + "ms" }} onMouseEnter={() => setHv(k)} onMouseLeave={() => setHv(null)}>
        <path className="trk" d={full} pathLength="1" />
        {L > 0 && <path className="lit" d={`${p} L ${xs(Math.min(L, 4))} ${y}`} pathLength="1" stroke={`url(#tg${k})`} />}
        <text className="bt" x="150" y={y - 40}>{b.t}</text><text className="bs" x="150" y={y - 24}>{L < 0 ? "Locked in this demo" : L === 0 ? "Next up" : b.sub + " · " + L + " of 5"}</text>
        {b.n.map((nm, i) => { const st = L < 0 ? "lock" : i < L ? "done" : i === L ? "now" : "up"; const tx = xs(i);
          return <g key={i} className={"tn " + st} style={{ "--d": i + k * 2 }} transform={`translate(${tx} ${y})`} tabIndex={st === "lock" ? -1 : 0} role="button" aria-label={"Open " + (b.full ? b.full[i] : nm)} onClick={() => st !== "lock" && go("section")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && st !== "lock" && go("section")}>
            {st === "now" && <circle className="pulse" r={R} />}<circle className="nd" r={R} />
            {st === "done" ? <path className="ck" d="M-6 0.5 L-1.5 5 L6.5 -4.5" /> : <text className="nn" y="4.5">{i + 1}</text>}
            <text className="nl" y={R + 20}>{nm}</text></g>; })}
      </g>; })}
    <g className="root"><circle cx={rx} cy={ry} r="21" className="rg" /><circle cx={rx} cy={ry} r="9" className="rc" /><text x={rx} y={ry + 44} className="rt">You</text></g>
  </svg><small className="demo">Each branch is a course. Tap a section to open it. Demo data.</small></div>;
}

/* ---------- activity grid (week / month / year) ---------- */
const LV = { rest: ["Rest day", 0], miss: ["Missed a day", 0], short: ["Short session", 15], steady: ["Steady", 40], focus: ["Focused", 80], grind: ["Grind", 150] };
function demoDays() {
  const out = [], today = new Date(); today.setHours(12, 0, 0, 0);
  for (let k = 370; k >= 0; k--) {
    const d = new Date(today); d.setDate(d.getDate() - k);
    const r = Math.abs(Math.sin(k * 12.9898 + 4.1414) * 43758.5453) % 1; let lv;
    if (k === 0) lv = "focus"; else if (k === 1) lv = "steady"; else if (k === 2) lv = "grind"; else if (k === 3) lv = "miss";
    else if (r < .13) lv = "miss"; else if (r < .27) lv = "rest"; else if (r < .39) lv = "short"; else if (r < .62) lv = "steady"; else if (r < .84) lv = "focus"; else lv = "grind";
    if (k > 330 && r < .5) lv = "rest";
    const base = LV[lv][1], m = base ? Math.round((base * (.8 + (r * 7 % 1) * .6)) / 5) * 5 : 0;
    out.push({ d, lv, m });
  }
  return out;
}
const fmt = (m) => (m ? (m >= 60 ? Math.floor(m / 60) + " h " + (m % 60 ? (m % 60) + " min" : "") : m + " min") : "no study");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ActivityGrid() {
  const [v, setV] = useState("year"); const [tip, setTip] = useState(null);
  const all = useMemo(demoDays, []); const today = all[all.length - 1];
  const say = (c) => c.d.toDateString().slice(0, 10) + " · " + (c.lv === "miss" ? "missed, streak lost" : c.lv === "rest" ? "rest day" : fmt(c.m) + " · " + LV[c.lv][0].toLowerCase());
  const Cell = ({ c, big, n }) => <div tabIndex={big ? 0 : -1} className={"ac l-" + c.lv + (c === today ? " today" : "")} aria-label={say(c)} onMouseEnter={() => setTip(c)} onFocus={() => setTip(c)} onMouseLeave={() => setTip(null)}>{big ? <><b>{n}</b>{big === 2 && <small>{c.m ? fmt(c.m) : ""}</small>}</> : null}</div>;
  let body;
  if (v === "week") { const w = all.slice(-7); body = <div className="ag week">{w.map((c, i) => <div key={i} className="wcol"><small>{DAYS[c.d.getDay()]}</small><Cell c={c} big={2} n={c.d.getDate()} /></div>)}</div>; }
  else if (v === "month") { const t = today.d, first = new Date(t.getFullYear(), t.getMonth(), 1), pad = first.getDay(), mine = all.filter((c) => c.d.getMonth() === t.getMonth() && c.d.getFullYear() === t.getFullYear());
    body = <div className="ag month"><div className="dow">{DAYS.map((d) => <small key={d}>{d.slice(0, 2)}</small>)}</div><div className="mgrid">{Array.from({ length: pad }, (_, i) => <i key={"p" + i} />)}{mine.map((c, i) => <Cell key={i} c={c} big={1} n={c.d.getDate()} />)}</div></div>; }
  else { const start = all[0].d.getDay(), cells = [...Array(start).fill(null), ...all], labels = []; cells.forEach((c, i) => { if (c && c.d.getDate() <= 7 && c.d.getMonth() !== labels.at(-1)?.[2] && Math.floor(i / 7) > (labels.at(-1)?.[0] ?? -9) + 2) labels.push([Math.floor(i / 7), MON[c.d.getMonth()], c.d.getMonth()]); });
    body = <div className="ag year"><div className="ml">{labels.map(([w, m]) => <small key={w} style={{ gridColumn: w + 1 }}>{m}</small>)}</div><div className="ygrid">{cells.map((c, i) => c ? <Cell key={i} c={c} /> : <i key={i} />)}</div></div>; }
  const tot = all.slice(-(v === "week" ? 7 : v === "month" ? today.d.getDate() : 365)); const mins = tot.reduce((a, c) => a + c.m, 0), act = tot.filter((c) => c.m).length;
  return <div className="actg"><div className="agh"><Seg v={v} set={setV} opts={[["week", "Week"], ["month", "Month"], ["year", "Year"]]} /><span className="agt">{Math.round(mins / 60)} h over {act} days</span></div>
    {body}
    <div className="agtip" aria-live="polite">{tip ? say(tip) : "Hover a day to see what you did. Demo data."}</div>
    <div className="aglg"><span><i className="ac l-rest" />Rest</span><span><i className="ac l-miss" />Missed</span><span><i className="ac l-short" />Short</span><span><i className="ac l-steady" />Steady</span><span><i className="ac l-focus" />Focused</span><span><i className="ac l-grind" />Grind</span></div></div>;
}

function Profile({ st, lite, still, claim, progress, go }) {
  const [on, setOn] = useState({ earth: true, streak: true, points: true, medals: true, rank: true, next: true, week: true, activity: true, map: true });
  const [menu, setMenu] = useState(false);
  const pctv = Math.round(progress * 100), lit = Math.round(progress * 5);
  const W = {
    earth: () => <div className="wearth">
      {lite ? <div className="earthposter" /> : <Earth mode={st.earth} still={still} size={460} />}
      <div className="minihud g" data-lens><small>Your progress</small><b><CountUp to={pctv} duration={1.2} />%</b><div className="bar"><i style={{ width: pctv + "%" }} /></div><span>Round 1 · {lit} of 5 sections</span><span className="chip">Demo</span></div></div>,
    streak: () => <><div className="wtop"><div className="ico3"><I n="flame" s={26} /></div><span className="wchip">Best 12</span></div><b className="big"><CountUp to={3} duration={1} /></b><span>day streak</span>
      <div className="sdots" aria-label="Last 7 days, 3 day streak">{[["M", 0], ["T", 0], ["W", 0], ["T", 0], ["F", 1], ["S", 1], ["S", 2]].map(([d, k], i) => <i key={i} className={k === 1 ? "on" : k === 2 ? "on today" : ""} style={{ "--i": i }}><em>{d}</em></i>)}</div></>,
    points: () => <><div className="wtop"><div className="ico3"><I n="bolt" s={26} /></div><span className="wchip">+4 today</span></div><b className="big"><CountUp to={11} duration={1} /></b><span>points</span>
      <svg className="spark" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".45" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><path className="sa" d="M0 34 L17 30 L34 31 L51 22 L68 18 L85 19 L102 9 L120 4 L120 40 L0 40Z" fill="url(#spg)" /><path className="sl" pathLength="1" d="M0 34 L17 30 L34 31 L51 22 L68 18 L85 19 L102 9 L120 4" /><circle className="sd" cx="120" cy="4" r="2.6" /></svg></>,
    medals: () => <><div className="medsec"><small>Coins</small><div className="medals"><Coin icon="star" label="Basics" /><Coin icon="mail" label="First email" on={false} /><Coin icon="flame" label="3-day streak" /></div></div>
      <div className="medsec"><small>Trophies · all-time rank (each #1 trophy is its own design)</small><div className="medals"><Trophy place="1a" label="Cold outreach #1" /><Trophy place="1b" label="Copywriting #1" on={false} /><Trophy place="1c" label="Short-form #1" on={false} /><Trophy place="1d" label="Marketing #1" on={false} /><Trophy place="1e" label="Branding #1" on={false} /><Trophy place="3" label="Top 3" /><Trophy place="10" label="Top 10" /></div></div>
      <div className="medsec"><small>Badges · skills completed</small><div className="medals"><Badge icon="mail" label="Cold outreach" /><Badge icon="note" label="Copywriting" /><Badge icon="film" label="Short-form video" on={false} /><Badge icon="chat" label="Social content" on={false} /><Badge icon="bolt" label="Marketing" on={false} /><Badge icon="star" label="Personal branding" on={false} /><Badge icon="chart" label="Tracking" on={false} /><Badge icon="target" label="Lead gen" on={false} /></div></div>
      <button className="gold" data-sfx="none" onClick={claim}>Claim reward</button></>,
    rank: () => <><div className="wtop"><div className="ico3"><I n="trophy" s={26} /></div><span className="wchip">Up 3 this week</span></div><b className="big">#12</b><span>all-time rank, of 1,240 (demo)</span>
      <div className="rail" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} className={i < 2 ? "gap" : i === 2 ? "you" : ""} />)}</div><small className="railt">2 places to Top 10</small></>,
    next: () => <><div className="wtop"><div className="ico3"><I n="star" s={26} /></div><span className="wchip">66%</span></div><b className="big sm">Basics coin</b><span>Finish Section 2 to earn it</span>
      <ol className="ms">{[["Quiz passed", 1], ["Practice done", 1], ["Finish Section 2", 0]].map(([t, d]) => <li key={t} className={d ? "d" : ""}><i>{d ? <I n="check" s={13} /> : null}</i>{t}</li>)}</ol><div className="bar"><i style={{ width: "66%" }} /></div></>,
    week: () => <ActivityGrid />,
    activity: () => <ul className="act">{["Finished Basics and rules", "Quiz: 5 of 5 correct", "Started Cold email", "Earned the Basics coin"].map((t, i) => <li key={t}><i />{t}<small>{i + 1}d</small></li>)}</ul>,
    map: () => <CourseMap lit={lit} go={go} />,
  };
  return <div className="stack">
    <div className="prow"><div><div className="eyebrow">Profile</div><h1>Your dashboard</h1></div>
      <div className="menuwrap"><button className="iconb" aria-label="Choose widgets" aria-expanded={menu} onClick={() => setMenu(!menu)}><I n="dots" /></button>
        {menu && <div className="pop g wmenu" data-lens role="dialog" aria-label="Widgets"><b>Widgets</b>{ALL.map(([k, t]) => <label key={k} className="wopt"><input type="checkbox" checked={on[k]} onChange={() => setOn({ ...on, [k]: !on[k] })} /><span>{t}</span></label>)}<small>Tick to show a widget. Untick to remove it.</small></div>}</div></div>
    <div className="wgrid">{ALL.filter(([k]) => on[k]).map(([k, t, span]) => <div key={k} className={"widget g wk-" + k + (span === 2 ? " w2" : span === 4 ? " w4" : "") + (k === "earth" ? " wglobe" : "")}>
      <div className="wh"><b>{t}</b><button className="iconb sm wx" aria-label={"Remove " + t} onClick={() => setOn({ ...on, [k]: false })}><I n="x" s={16} /></button></div>{W[k]()}</div>)}</div>
    <p className="demo">Prototype. Widgets, points, ranks and medals are demo data.</p>
  </div>;
}

function Account({ st, setSt }) {
  return <div className="stack"><div><div className="eyebrow">Account</div><h1>Settings</h1></div>
    <div className="g read"><h2 className="h2">Motion</h2><Seg v={st.motion} set={(v) => setSt({ ...st, motion: v })} opts={[["full", "Full"], ["reduced", "Reduced"], ["off", "Off"]]} />
      <p>Reduced stops spinning, sweeping and flashing, and swaps the gold fire for a calm glow. Off also turns the 3D scenes into still pictures. Your device's own reduced-motion setting is always respected.</p></div>
    <div className="g read"><h2 className="h2">Sound</h2><Seg v={st.sound ? "on" : "off"} set={(v) => setSt({ ...st, sound: v === "on" })} opts={[["on", "On"], ["off", "Off"]]} /><p>A short sound plays when you claim a reward. It never plays on its own, and it is separate from the motion setting.</p></div>
    <div className="g read"><h2 className="h2">Theme</h2><Seg v={st.theme} set={(v) => setSt({ ...st, theme: v })} opts={[["iris", "Iris"], ["mono", "Mono"]]} /><p>Iris is the deep blue-violet look. Mono is black and gray with one very bright white light.</p></div>
    <div className="g read"><h2 className="h2">Glass</h2><Seg v={st.glass} set={(v) => setSt({ ...st, glass: v })} opts={[["frosted", "Frosted"], ["liquid", "Liquid"]]} /></div>
    <div className="g read"><h2 className="h2">Earth</h2><Seg v={st.earth} set={(v) => setSt({ ...st, earth: v })} opts={[["real", "Realistic"], ["gray", "Gray"]]} /></div>
    <div className="g read gprev"><h2 className="h2">Glass preview</h2><p>Liquid glass bends what is behind it at the edges, like a thick lens. It needs Chrome, Edge or another Chromium browser; other browsers show the lighter version.</p>
      <div className="stripes"><div className="lens1 g" data-lens>Liquid glass</div><div className="lens2 g" data-lens>Aa 123</div></div></div>
    <p className="demo">Prototype. Nothing is saved.</p></div>;
}

function Section({ go }) {
  const [tab, setTab] = useState("learn"); const [pick, setPick] = useState(null);
  const T = [["learn", "Learn", "book"], ["watch", "Watch", "film"], ["practice", "Practice", "check"], ["do", "Do it", "tag"], ["notes", "Notes", "note"]];
  const opts = ["The ask is big for a stranger and not tied to a clear offer", "The email is too short", "It uses the person's first name", "It has a subject line"];
  return <div className="stack"><button className="backl" onClick={() => go("home")}><I n="back" s={16} /> Cold outreach · Round 1</button>
    <div><div className="eyebrow">Section 2 of 5</div><h1>Cold email</h1><p className="lede">How do I write a short email that is easy to answer?</p></div>
    <div className="mseg tabsx">{T.map(([k, l, ic]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}><I n={ic} s={16} />{l}</button>)}</div>
    {tab === "learn" && <div className="g read"><h2 className="h2">Writing a short cold email</h2><p>The offer is what you can give or do for them. The ask is the one easy next step, such as "Want me to send it?". Keep both short and clear.</p><p>Keep every email honest: true sender, honest subject, a postal address and a way to opt out.</p></div>}
    {tab === "watch" && <div className="drop g"><I n="upload" s={30} /><b>Your explainer video goes here</b><span>Drop an MP4 file. Waiting for video.</span><small>Prototype only: nothing uploads.</small></div>}
    {tab === "practice" && <div className="g read"><div className="eyebrow">Quiz · 1 of 1</div><h2 className="h2">A made-up designer asks for "a 45-minute call to talk about everything". What is the main problem?</h2><div className="opts">{opts.map((o, i) => <button key={o} className={"opt" + (pick === null ? "" : i === 0 ? " right" : i === pick ? " wrong" : "")} disabled={pick !== null} data-sfx="none" onClick={() => { setPick(i); sfx(i === 0 ? "correct" : "wrong"); }}>{o}</button>)}</div>{pick !== null && <p className="expl">A first ask should be small and easy. A long call with no clear reason is a heavy ask.</p>}</div>}
    {tab === "do" && <div className="g read"><div className="eyebrow">Hands-on task · Practice (simulated)</div><h2 className="h2">Write two versions to test</h2><ul className="chk">{["Both under 90 words", "One offer and one small ask", "Honest sender and subject"].map(t => <li key={t}><label><input type="checkbox" /> {t}</label></li>)}</ul></div>}
    {tab === "notes" && <div className="g read"><div className="eyebrow">Notebook</div><h2 className="h2">Remember</h2><p>One clear offer and one small ask. Heavy asks lower replies.</p></div>}
  </div>;
}

function Admin() {
  const t = [["Courses", "Drafts, versions, publishing", "book", "2 drafts"], ["Import course", "Check a file, create a Draft", "upload", "Ready"], ["Topics", "Businesses, side hustles, skills", "tag", "40 topics"], ["Owner review", "Approve what learners will see", "check", "2 waiting"], ["People", "Accounts, roles, Guardians", "users", "Demo"], ["Billing", "Plans, trials, sandbox payments", "card", "Sandbox"], ["Safety and audit", "Notices, reports, audit chain", "shield", "No open items"], ["Settings", "Platform switches and limits", "gear", "Owner only"]];
  return <div className="stack"><div><div className="eyebrow">Owner</div><h1>Admin</h1><p className="lede">Everything you manage, in one place.</p></div>
    <div className="tiles">{t.map(([a, b, ic, c]) => <button key={a} className="tile g"><i className="sheen" /><span className="ico"><I n={ic} s={22} /></span><b>{a}</b><span className="sub">{b}</span><span className="chip">{c}</span></button>)}</div><p className="demo">Demo data for the prototype.</p></div>;
}

function Scene({ page, still, lite }) {
  const ref = useRef(null);
  useEffect(() => { if (still || lite) return; let raf; const mv = (e) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const n = ref.current; if (!n) return; n.style.setProperty("--sx", ((e.clientX / innerWidth) - .5).toFixed(3)); n.style.setProperty("--sy", ((e.clientY / innerHeight) - .5).toFixed(3)); }); }; addEventListener("pointermove", mv, { passive: true }); return () => { removeEventListener("pointermove", mv); cancelAnimationFrame(raf); }; }, [still, lite]);
  return <div className="scn" ref={ref} data-p={page} aria-hidden="true">
    <i className="orb o1" /><i className="orb o2" /><i className="orb o3" />
    <div className="lightsrc"><i className="fl-cone" /><i className="fl-rays" /><i className="fl-bloom" /><i className="fl-core" /><i className="fl-streak" /><i className="fl-ghost g1" /><i className="fl-ghost g2" /><i className="fl-ghost g3" /></div>
    <div className="horizon" /><div className="floor"><i /></div>
    {!lite && <div className="shards"><i className="sh s1" /><i className="sh s2" /><i className="sh s3" /><i className="sh s4" /><i className="sh s5" /></div>}
    {!lite && <div className="dusts">{Array.from({ length: 16 }, (_, i) => <i key={i} className="dust" style={{ left: (i * 37 % 100) + "%", "--d": (14 + (i * 7) % 16) + "s", "--w": -(i * 3.1) + "s", "--s": (2 + (i % 3)) + "px", "--x": ((i % 5) - 2) * 14 + "px" }} />)}</div>}
    <div className="vig" />
  </div>;
}

const COURSES = [["Cold outreach", "mail", "#7B7FFF", 5, 1, "Taking"], ["Copywriting", "note", "#34D399", 5, 0, "New"], ["Short-form video", "film", "#F472B6", 5, 0, "New"], ["Social content", "chat", "#59C5E8", 5, 0, "New"], ["Marketing basics", "chart", "#2DD4BF", 5, 0, "New"], ["Personal branding", "star", "#B07CFF", 5, 0, "New"], ["Tracking and testing", "target", "#FB923C", 5, 0, "New"]];
function Library({ go }) {
  const [f, setF] = useState("all"), [q, setQ] = useState("");
  const list = COURSES.filter(([t, , , , d, s]) => (f === "all" || (f === "taking" ? d > 0 : d === 0)) && t.toLowerCase().includes(q.toLowerCase()));
  return <div className="stack"><div><div className="eyebrow">Library</div><h1>Courses</h1><p className="lede">Pick a skill to learn. Every course is practice with made-up businesses.</p></div>
    <div className="libbar"><Seg v={f} set={setF} opts={[["all", "All"], ["taking", "Taking"], ["new", "Not started"]]} />
      <label className="search"><I n="search" s={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" /></label></div>
    <div className="courses">{list.map(([t, ic, c, n, d, st], i) => <button key={t} className={"course g" + (i === 0 && f === "all" && !q ? " feat" : "")} style={{ "--acc": c }} onClick={() => go("section")}>
      <span className="cover"><i className="r1" /><i className="r2" /><i className="r3" /><span className="cico"><I n={ic} s={i === 0 && f === "all" && !q ? 76 : 56} /></span>{d > 0 && <span className="ring" style={{ "--p": Math.round(d / n * 100) }}><b>{Math.round(d / n * 100)}%</b></span>}</span>
      <span className="cbody"><b>{t}</b><span className="csub">{n} sections · Round 1 of 3</span><span className={"chip " + (d ? "open" : "next")}>{st}</span></span></button>)}
      {!list.length && <p className="lede">No course matches that search.</p>}</div>
    <p className="demo">Demo data. Course names are examples.</p></div>;
}

const CARDS = [["What must every cold email include?", "A true sender name, an honest subject line, a postal address and a way to opt out."], ["What is the ask in a cold email?", "One easy next step, such as \"Want me to send it?\"."], ["Why is a 45-minute call a weak first ask?", "It is big for a stranger and not tied to a clear offer."], ["What is the offer?", "What you can give or do for them."]];
function Review() {
  const [i, setI] = useState(0), [flip, setFlip] = useState(false), [done, setDone] = useState(0);
  const rate = () => { setFlip(false); setDone(done + 1); setTimeout(() => setI((i + 1) % CARDS.length), 150); };
  return <div className="stack"><div><div className="eyebrow">Review</div><h1>Practice review</h1><p className="lede">Short cards that bring back what you learned, right when you are about to forget it.</p></div>
    <div className="revgrid">
      <div className="deckwrap"><div className="deck"><i className="dk d3" /><i className="dk d2" />
        <div className={"fc g" + (flip ? " flip" : "")}><div className="face front"><span className="eyebrow">Question {i + 1} of {CARDS.length}</span><h2>{CARDS[i][0]}</h2><button className="gbtn" onClick={() => setFlip(true)}>Show answer</button></div>
          <div className="face back"><span className="eyebrow">Answer</span><p>{CARDS[i][1]}</p><div className="rate"><button className="r again" onClick={rate}>Again<small>1 day</small></button><button className="r good" onClick={rate}>Good<small>3 days</small></button><button className="r easy" onClick={rate}>Easy<small>7 days</small></button></div></div></div></div>
        <p className="demo">Reviewed this visit: {done}. Demo cards only.</p></div>
      <div className="revside">
        <div className="g mini"><I n="clock" s={22} /><b className="big">{Math.max(0, 6 - done)}</b><span>cards due today</span></div>
        <div className="g mini"><I n="flame" s={22} /><b className="big">3</b><span>day streak</span></div>
        <div className="g mini wide"><h2 className="h2">Next 7 days</h2><div className="wk">{[6, 3, 0, 4, 2, 5, 1].map((h, k) => <span key={k}><i style={{ height: 8 + h * 9 }} /><small>{"MTWTFSS"[k]}</small></span>)}</div></div>
        <div className="g mini wide"><h2 className="h2">Weak spots</h2>{[["Honest subject lines", 38], ["Choosing one small ask", 56], ["Opt-out wording", 74]].map(([t, v]) => <div className="weak" key={t}><span>{t}</span><div className="bar"><i style={{ width: v + "%" }} /></div></div>)}</div>
      </div></div><p className="demo">Prototype. Nothing is saved.</p></div>;
}

function App() {
  const [role, setRole] = useState("learner"), [page, setPage] = useState("home");
  const [st, setSt] = useState({ theme: "iris", glass: "frosted", motion: "full", earth: "real", sound: true });
  const [reward, setReward] = useState(false), [progress, setProgress] = useState(.2), [tod, setTod] = useState("auto");
  const small = typeof matchMedia !== "undefined" && (matchMedia("(max-width:760px)").matches || (navigator.hardwareConcurrency || 8) <= 3 || navigator.connection?.saveData);
  const osReduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lite = small || st.motion === "off";
  const reduced = lite || st.motion === "reduced" || osReduce;
  const chromium = typeof navigator !== "undefined" && !!navigator.userAgentData?.brands?.some(b => /Chromium/.test(b.brand));
  useEffect(() => { // pointer spotlight on glass + soft tilt on tiles (react-bits SpotlightCard idea, one listener)
    if (reduced) return; let raf;
    const mv = (e) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const el = e.target.closest?.(".g,.stat"); if (!el) return; const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; el.style.setProperty("--mx", x + "px"); el.style.setProperty("--my", y + "px"); el.style.setProperty("--ang", (Math.atan2(y - r.height / 2, x - r.width / 2) * 180 / Math.PI + 90).toFixed(0) + "deg"); if (el.matches(".tile,.seccard,.stat,.widget")) { el.style.setProperty("--rx", ((.5 - y / r.height) * 7).toFixed(2) + "deg"); el.style.setProperty("--ry", ((x / r.width - .5) * 9).toFixed(2) + "deg"); } }); };
    const lv = (e) => { const el = e.target.closest?.(".tile,.seccard,.stat,.widget"); if (el) { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); } };
    addEventListener("pointermove", mv, { passive: true }); addEventListener("pointerout", lv, { passive: true }); return () => { removeEventListener("pointermove", mv); removeEventListener("pointerout", lv); cancelAnimationFrame(raf); };
  }, [reduced]);
  useEffect(() => { setSound(st.sound); }, [st.sound]);
  const glow = useRef(null);
  useEffect(() => { // soft light that trails the pointer (fine pointers only)
    if (reduced || lite || !matchMedia("(pointer:fine)").matches) return; let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, raf;
    const mv = (e) => { tx = e.clientX; ty = e.clientY; }; const tick = () => { x += (tx - x) * .12; y += (ty - y) * .12; if (glow.current) glow.current.style.transform = `translate3d(${x - 260}px,${y - 260}px,0)`; raf = requestAnimationFrame(tick); };
    addEventListener("pointermove", mv, { passive: true }); raf = requestAnimationFrame(tick); return () => { removeEventListener("pointermove", mv); cancelAnimationFrame(raf); };
  }, [reduced, lite]);
  useEffect(() => { // tiny spark burst where you click a control
    if (reduced) return; const cl = (e) => { const t = e.target.closest?.("button,.course,.seccard,.tile"); if (!t || t.disabled) return; const b = document.createElement("span"); b.className = "burst"; b.style.left = e.clientX + "px"; b.style.top = e.clientY + "px";
      for (let i = 0; i < 8; i++) { const p = document.createElement("i"), a = (i / 8) * Math.PI * 2 + Math.random() * .6, r = 18 + Math.random() * 22; p.style.setProperty("--dx", Math.cos(a) * r + "px"); p.style.setProperty("--dy", Math.sin(a) * r + "px"); p.style.animationDelay = Math.random() * 40 + "ms"; b.appendChild(p); }
      document.body.appendChild(b); setTimeout(() => b.remove(), 750); };
    addEventListener("click", cl, true); return () => removeEventListener("click", cl, true);
  }, [reduced]);
  useEffect(() => {
    const click = (e) => { const b = e.target.closest?.("button,input[type=checkbox],input[type=range]"); if (!b || b.dataset.sfx === "none" || b.disabled) return; if (b.type === "range") return; let n = "tap";
      if (b.closest(".tabs") || b.closest(".brand") || b.matches(".seccard,.tile,.node,.backl")) n = "nav"; else if (b.closest(".mseg")) n = "on"; else if (b.matches(".wx")) n = "remove"; else if (b.type === "checkbox") n = b.checked ? "add" : "remove"; else if (b.matches(".iconb")) n = "open"; sfx(n); };
    addEventListener("click", click, true); return () => removeEventListener("click", click, true);
  }, []);
  useEffect(() => { if (!lensSupported() || lite || st.glass !== "liquid") { clearLens(); return; } let t; const run = () => { clearTimeout(t); t = setTimeout(() => scanLens(document, true), 60); }; run(); const mo = new MutationObserver(run); mo.observe(document.body, { childList: true, subtree: true }); return () => { mo.disconnect(); clearTimeout(t); }; }, [lite, st.glass]);
  const go = (p) => { setPage(p); scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); };
  useEffect(() => { if (reduced) return; const l = new Lenis({ lerp: .12 }); let id; const raf = (t) => { l.raf(t); id = requestAnimationFrame(raf); }; id = requestAnimationFrame(raf); return () => { cancelAnimationFrame(id); l.destroy(); }; }, [reduced]);
  return <LiteCtx.Provider value={lite}><div className="app" data-theme={st.theme} data-glass={st.glass} data-refract={chromium && st.glass === "liquid" ? "1" : "0"} data-reduced={reduced ? "1" : "0"}>
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><defs><linearGradient id="icg" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22"><stop offset="0" stopColor="#fff" /><stop offset=".55" stopColor="#BFD3EE" /><stop offset="1" stopColor="#8C90FF" /></linearGradient><linearGradient id="ica" gradientUnits="userSpaceOnUse" x1="2" y1="22" x2="22" y2="2"><stop offset="0" stopColor="#7FD1E8" /><stop offset=".6" stopColor="#8C90FF" /><stop offset="1" stopColor="#C78BFF" /></linearGradient><linearGradient id="icf" gradientUnits="userSpaceOnUse" x1="12" y1="2" x2="12" y2="22"><stop offset="0" stopColor="#A0BDDB" stopOpacity=".42" /><stop offset="1" stopColor="#5E5CE6" stopOpacity=".18" /></linearGradient></defs><filter id="liquid" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".008 .012" numOctaves="2" seed="3" result="n" /><feGaussianBlur in="n" stdDeviation="3" result="b" /><feDisplacementMap in="SourceGraphic" in2="b" scale="34" xChannelSelector="R" yChannelSelector="G" /></filter></svg>
    {!lite && !reduced && location.hash !== "#noaur" && <div className="aur" aria-hidden="true"><Aurora colorStops={["#2a2f86", "#A0BDDB", "#5b57d6"]} amplitude={.9} blend={.7} speed={.5} /></div>}
    <div className="bgfade" aria-hidden="true" />{!lite && !reduced && <div className="cglow" ref={glow} aria-hidden="true" />}{<Scene page={page} still={reduced} lite={lite} />}<div className="grain" aria-hidden="true" />
    <Hud page={page} go={go} role={role} setRole={setRole} st={st} setSt={setSt} lite={lite} />
    <main key={page} className="shell">
      {page === "home" && <Home go={go} lite={lite} still={reduced} progress={progress} setProgress={setProgress} tod={tod} setTod={setTod} />}
      {page === "profile" && <Profile st={st} lite={lite} still={reduced} claim={() => setReward(true)} progress={progress} go={go} />}
      {page === "account" && <Account st={st} setSt={setSt} />}
      {page === "section" && <Section go={go} />}
      {page === "admin" && <Admin />}
      {page === "lib" && <Library go={go} />}
      {page === "rev" && <Review />}
      </main>
    {reward && <Reward reduced={reduced} lite={lite} sound={st.sound} onDone={() => setReward(false)} />}
  </div></LiteCtx.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
