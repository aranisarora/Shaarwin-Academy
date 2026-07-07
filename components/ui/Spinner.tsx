export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <span className="spinner-ball" />
    </span>
  );
}
