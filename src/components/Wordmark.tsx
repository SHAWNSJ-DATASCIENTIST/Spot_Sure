/** The SpotSure wordmark with its amber full stop. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`.trim()}>
      SpotSure<span className="wordmark__dot">.</span>
    </span>
  );
}
