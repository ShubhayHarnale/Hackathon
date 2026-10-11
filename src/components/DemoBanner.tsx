/** Shown on every patient screen: the demo procedure is a prop, not medical guidance. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="flex w-full items-center justify-center gap-2 border-b border-warning-fg/25 bg-warning-bg px-4 py-2 text-center text-lg font-bold text-warning-fg"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor">
        <path d="M12 2.5 1.8 20.5h20.4zM11 9h2v6h-2zm0 7.5h2v2h-2z" />
      </svg>
      DEMO PROTOCOL – not medical guidance
    </div>
  );
}
