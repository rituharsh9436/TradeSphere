import { AlertTriangle, X } from "lucide-react";

function ConfirmDeleteAccountModal({ open, busy, confirmText, password, onConfirmText, onPassword, onCancel, onConfirm }) {
  if (!open) return null;
  const canConfirm = confirmText === "DELETE" && password && !busy;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-plane/80 px-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-lg border border-loss/50 bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-loss/50 bg-loss/10 text-loss">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Delete account permanently</h2>
              <p className="mt-1 text-sm text-muted">This permanently deletes your profile, wallet, orders, positions, and paper-trading history.</p>
            </div>
          </div>
          <button type="button" className="text-muted hover:text-ink" onClick={onCancel} aria-label="Close delete account dialog">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Enter your password</span>
            <input className="field" type="password" value={password} onChange={(e) => onPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Type DELETE to confirm</span>
            <input className="field" value={confirmText} onChange={(e) => onConfirmText(e.target.value)} />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn border-loss/70 bg-loss text-white hover:bg-loss/90" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? "Deleting..." : "Delete account"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmDeleteAccountModal;
