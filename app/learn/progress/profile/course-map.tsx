"use client";

import Link from "next/link";
import { Icon } from "../../../ui/design/ds-icon";
import type { MapBranch, NodeState } from "./profile-data";

const STATE_WORD: Record<NodeState, string> = { done: "done", now: "you are here", next: "up next", locked: "locked" };
const COL = 118, X0 = 214, ROW = 112, TOP = 70, R = 15, ROOT_X = 44;
const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Design rebuild D5 · The course map: a branching tree, one branch per course off a "You" node; the nodes are the real
 * sections in order (done, now, up next, locked). Open sections link to the course's existing page; locked ones say why
 * in their label. Lines draw in and nodes pop in while motion is on. On phones the tree scrolls sideways in its own box.
 */
export function CourseMap({ branches }: { branches: MapBranch[] }) {
  const cols = Math.max(...branches.map((b) => b.nodes.length));
  const w = X0 + (cols - 1) * COL + 70, h = TOP + (branches.length - 1) * ROW + 60;
  const rootY = TOP + ((branches.length - 1) * ROW) / 2;
  const current = branches.find((b) => b.nodes.some((n) => n.state === "now"));
  return (
    <div className="pf-map">
      <div className="pf-map__scroll" tabIndex={0} role="region" aria-label="Course map (scrolls sideways)">
        <svg className="pf-tree" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="group" aria-label="Course map: one branch per course">
          {branches.map((b, k) => {
            const y = TOP + k * ROW;
            const lead = `M${ROOT_X} ${rootY} C ${ROOT_X + 62} ${rootY}, ${ROOT_X + 70} ${y}, 150 ${y}`;
            const lastDone = b.nodes.reduce((n, x, i) => (x.state === "done" ? i : n), -1);
            return (
              <g key={b.course.slug} className="pf-branch" style={{ ["--c" as string]: `var(--accent-${(k % 5) + 1})`, ["--bd" as string]: `${k * 140}ms` }}>
                <path className="pf-branch__trk" d={`${lead} L ${X0 + (b.nodes.length - 1) * COL} ${y}`} />
                {lastDone >= 0 && <path className="pf-branch__lit ds-draw" pathLength={1} d={`${lead} L ${X0 + lastDone * COL} ${y}`} />}
                <text className="pf-branch__t" x="150" y={y - 40}>{b.course.name}</text>
                <text className="pf-branch__s" x="150" y={y - 24}>{b.summary}</text>
                {b.nodes.map((n, i) => {
                  const label = `${b.course.name}: section ${i + 1}, ${n.m.title}, ${STATE_WORD[n.state]}${n.state === "locked" && n.m.reason ? `. ${n.m.reason}` : ""}`;
                  const inner = (
                    <g className={`pf-node pf-node--${n.state}`} style={{ ["--d" as string]: i + k * 2 }} transform={`translate(${X0 + i * COL} ${y})`}>
                      {n.state === "now" && <circle className="pf-node__pulse" r={R} />}
                      <circle className="pf-node__dot" r={R} />
                      {n.state === "done" ? <path className="pf-node__ck" d="M-6 0.5 L-1.5 5 L6.5 -4.5" /> : n.state === "locked" ? <path className="pf-node__lock" d="M-4.5 -1h9v7h-9zM-3 -1v-2.5a3 3 0 0 1 6 0V-1" /> : <text className="pf-node__n" y="4.5">{i + 1}</text>}
                      <text className="pf-node__l" y={R + 20}>{short(n.label)}</text>
                    </g>
                  );
                  return n.state === "locked"
                    ? <g key={i} role="img" aria-label={label}>{inner}</g>
                    : <a key={i} href={b.href} aria-label={`Open ${label}`} className="pf-node__a">{inner}</a>;
                })}
              </g>
            );
          })}
          <g className="pf-root" aria-hidden="true">
            <circle cx={ROOT_X} cy={rootY} r="21" className="pf-root__ring" />
            <circle cx={ROOT_X} cy={rootY} r="9" className="pf-root__core" />
            <text x={ROOT_X} y={rootY + 44} className="pf-root__t">You</text>
          </g>
        </svg>
      </div>
      <p className="small pf-map__foot">
        <span className="muted">Each branch is one of your courses; each node is a section.</span>
        {current && <Link href={current.href} className="ds-btn ds-btn--primary ds-btn--sm" data-sfx="nav"><Icon name="book" size={16} /><span>Continue<span className="sr-only">: {current.course.name}</span></span></Link>}
      </p>
    </div>
  );
}
