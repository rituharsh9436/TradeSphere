const BADGE_STYLES = {
  LIVE: "border-gain/50 bg-gain/10 text-gain",
  PENDING: "border-warning/60 bg-warning/10 text-warning",
  FILLED: "border-gain/50 bg-gain/10 text-gain",
  CANCELLED: "border-line bg-surface-2 text-muted",
  REJECTED: "border-loss/50 bg-loss/10 text-loss",
  BUY: "border-gain/50 bg-gain/10 text-gain",
  SELL: "border-loss/50 bg-loss/10 text-loss",
  UNPRICED: "border-warning/60 bg-warning/10 text-warning",
};

function StatusBadge({ children, tone }) {
  const key = tone || String(children).toUpperCase();
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 text-xs font-semibold ${BADGE_STYLES[key] || "border-line bg-plane text-muted"}`}>
      {children}
    </span>
  );
}

export default StatusBadge;
