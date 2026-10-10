/** Shown on every patient screen: the demo procedure is a prop, not medical guidance. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="w-full bg-warning-bg px-4 py-2 text-center text-lg font-bold text-warning-fg"
    >
      DEMO PROTOCOL – not medical guidance
    </div>
  );
}
