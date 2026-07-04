import { CheckCircle2, CircleAlert, X } from "lucide-react";

function Toast({ message, type = "success", onClose }) {
  if (!message) return null;
  const isSuccess = type === "success";
  const Icon = isSuccess ? CheckCircle2 : CircleAlert;

  return (
    <div className={`fixed right-4 top-20 z-50 flex max-w-sm items-start gap-3 rounded-md border bg-surface p-3 text-sm shadow-xl ${isSuccess ? "border-gain/50 text-gain" : "border-loss/50 text-loss"}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-ink-secondary">{message}</p>
      <button type="button" className="text-muted hover:text-ink" onClick={onClose} aria-label="Dismiss message">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default Toast;
