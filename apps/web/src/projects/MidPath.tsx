/** A path or address on one line; when it does not fit, the middle is cut and the end stays readable. */
export function MidPath({ text, tail = 16 }: { text: string; tail?: number }) {
  return (
    <span className="path-mid" title={text}>
      <span className="path-head">{text.slice(0, -tail)}</span>
      <span className="path-tail">{text.slice(-tail)}</span>
    </span>
  );
}
