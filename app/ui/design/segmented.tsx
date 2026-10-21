"use client";

/**
 * Design rebuild D2 · Segmented control: a few mutually exclusive options; the selected one is pearl (Iris) or
 * champagne (Mono). A group of toggle buttons (aria-pressed), named by `label`. Controlled: the parent keeps the value.
 */
export function Segmented<V extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (v: V) => void;
  className?: string;
}) {
  return (
    <div className={`ds-seg${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className="ds-seg__opt" aria-pressed={value === v} data-sfx="on" onClick={() => value !== v && onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
