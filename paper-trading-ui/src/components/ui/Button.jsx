import * as React from "react";
import { cn } from "../../lib/utils";

const Button = React.forwardRef(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? "span" : "button"; // Keeping it simple for now without Radix Slot
    return (
      <Comp
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[0.45rem] font-bold ring-offset-plane transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-accent text-[#1f2128] hover:bg-accent-strong": variant === "default",
            "border border-line bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink": variant === "outline",
            "bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink": variant === "ghost",
            "bg-gain text-white hover:bg-[#19b171]": variant === "up",
            "bg-loss text-white hover:bg-[#eb4c5c]": variant === "down",
            "h-9 px-3 text-sm": size === "sm",
            "h-10 px-4 py-2": size === "default",
            "h-11 rounded-md px-8": size === "lg",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
