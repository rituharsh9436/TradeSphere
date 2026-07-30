import * as React from "react";
import { cn } from "../../lib/utils";

const Card = React.forwardRef(({ className, elevated = false, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-card border border-line bg-surface text-ink shadow-sm",
        elevated && "bg-gradient-to-b from-surface-2/70 to-surface/95 shadow-2xl",
        className
      )}
      {...props}
    />
  );
});
Card.displayName = "Card";

export { Card };
