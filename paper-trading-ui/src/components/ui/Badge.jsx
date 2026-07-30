import * as React from "react";
import { cn } from "../../lib/utils";

function Badge({ className, variant = "default", ...props }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2",
        {
          "border-transparent bg-accent text-[#1f2128]": variant === "default",
          "border-transparent bg-surface-2 text-ink-secondary": variant === "secondary",
          "border-transparent bg-loss text-white": variant === "destructive",
          "border-transparent bg-gain text-white": variant === "success",
          "text-ink": variant === "outline",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
