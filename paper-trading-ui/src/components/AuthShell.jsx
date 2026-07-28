import { Activity, BarChart3, ShieldCheck } from "lucide-react";

function AuthShell({ eyebrow, title, children, footer }) {
  return (
    <div className="grid min-h-screen bg-plane px-4 py-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8">
      <section className="hidden min-h-[calc(100vh-4rem)] flex-col justify-between rounded-lg border border-line bg-surface p-8 lg:flex">
        <div>
          <span className="inline-flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-black text-plane">
              TS
            </span>
            Trade<span className="text-accent">Sphere</span>
          </span>
          <div className="mt-16 max-w-xl">
            <p className="text-sm font-semibold uppercase text-accent">{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Practice the market without risking capital.</h1>
            <p className="mt-4 text-base text-muted">Live candles, virtual cash, limit orders, ranked performance, and an audit-ready ledger in one compact trading terminal.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Activity, label: "Live feed", value: "Streaming" },
            { icon: BarChart3, label: "Charts", value: "Candles" },
            { icon: ShieldCheck, label: "Capital", value: "$100k demo" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-md border border-line bg-plane p-4 transition-colors hover:bg-surface-2">
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                <div className="mt-4 text-xs uppercase text-muted">{item.label}</div>
                <div className="mt-1 font-semibold">{item.value}</div>
              </div>
            );
          })}
        </div>
      </section>

      <main className="grid place-items-center lg:min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center lg:hidden">
            <span className="inline-flex items-center gap-2 text-xl font-bold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-black text-plane">
                TS
              </span>
              Trade<span className="text-accent">Sphere</span>
            </span>
            <p className="mt-2 text-sm text-muted">{eyebrow}</p>
          </div>

          <div className="card-elevated p-6">
            <h1 className="mb-4 text-lg font-semibold">{title}</h1>
            {children}
          </div>

          {footer}
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
