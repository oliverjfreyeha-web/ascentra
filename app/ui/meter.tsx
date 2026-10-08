/**
 * D3 · A meter (the Mentor allowance): the native <meter> stays for assistive technology, with a drawn bar on top:
 * a Frozen gradient fill with a soft glow at its end, easing to its value when it appears (still with reduced motion).
 */
export function Meter({ value, max }: { value: number; max: number }) {
  const v = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="ui-meterbar" style={{ ["--v" as string]: v }}>
      <meter min={0} max={max} value={value} />
      <span className="ui-meterbar__fill" aria-hidden="true" />
      <span className="ui-meterbar__cap" aria-hidden="true" />
    </span>
  );
}
