export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[12px] border border-line bg-surface-2 ${className}`}
    >
      {children}
    </div>
  );
}

// Only ever spelled `Card.Content` at the call sites, so it isn't exported
// separately — one component, one way to reach it.
function CardContent({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

Card.Content = CardContent;
