/**
 * D3 · Loading: a skeleton shaped like what is coming (a list, a lesson, a set of panels), with the words for
 * assistive technology. One look across the app. The shimmer stops with reduced motion.
 */
export function Loading({ label = "Loading…", shape = "block" }: { label?: string; shape?: "list" | "lesson" | "block" | "table" }) {
  return (
    <div className={`ui-loading ui-loading--${shape}`} role="status">
      <span className="sr-only">{label}</span>
      <span className="ui-loading__label" aria-hidden="true">{label}</span>
      {shape === "lesson" ? (
        <span className="ui-loading__body" aria-hidden="true">
          <span className="ui-skeleton ui-skeleton--title" /><span className="ui-skeleton" style={{ width: "40%" }} />
          <span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" style={{ width: "86%" }} />
          <span className="ui-skeleton" /><span className="ui-skeleton" style={{ width: "72%" }} />
        </span>
      ) : shape === "list" || shape === "table" ? (
        <span className="ui-loading__body" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <span key={i} className="ui-loading__row"><span className="ui-skeleton" style={{ width: `${62 - i * 8}%` }} /><span className="ui-skeleton" style={{ width: "18%" }} /></span>)}
        </span>
      ) : (
        <span className="ui-loading__body" aria-hidden="true">
          <span className="ui-skeleton ui-skeleton--title" /><span className="ui-skeleton" /><span className="ui-skeleton" style={{ width: "80%" }} />
          <span className="ui-skeleton ui-skeleton--block" />
        </span>
      )}
    </div>
  );
}
