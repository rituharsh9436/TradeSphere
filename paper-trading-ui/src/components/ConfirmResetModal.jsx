import { AlertTriangle, X } from "lucide-react";
import { money } from "../lib/format";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

function ConfirmResetModal({ open, portfolio, pendingCount, busy, confirmText, onConfirmText, onCancel, onConfirm }) {
  if (!open) return null;

  const positions = portfolio?.positions || [];
  const canConfirm = confirmText === "RESET" && !busy;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-plane/80 px-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-loss/50 bg-loss/10 text-loss">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Reset paper account</h2>
              <p className="mt-1 text-sm text-muted">This liquidates positions, cancels pending orders, and restores starting capital.</p>
            </div>
          </div>
          <button type="button" className="text-muted hover:text-ink" onClick={onCancel} aria-label="Close reset dialog">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-plane p-3">
              <div className="text-xs uppercase text-muted">Positions</div>
              <div className="tnum mt-1 text-lg font-semibold">{positions.length}</div>
            </div>
            <div className="rounded-md border border-line bg-plane p-3">
              <div className="text-xs uppercase text-muted">Pending</div>
              <div className="tnum mt-1 text-lg font-semibold">{pendingCount}</div>
            </div>
            <div className="rounded-md border border-line bg-plane p-3">
              <div className="text-xs uppercase text-muted">Restored</div>
              <div className="tnum mt-1 text-lg font-semibold">{money(portfolio?.startingCapital || 100000)}</div>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Type RESET to confirm</span>
            <Input value={confirmText} onChange={(e) => onConfirmText(e.target.value)} autoFocus />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" className="border-loss/70 bg-loss text-white hover:bg-loss/90 shadow-loss/20 hover:shadow-loss/40" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? "Resetting..." : "Reset Account"}
          </Button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmResetModal;
