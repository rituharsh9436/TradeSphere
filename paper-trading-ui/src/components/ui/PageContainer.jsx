import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export function PageContainer({ children, className, ...props }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("mx-auto max-w-5xl p-4 md:p-8", className)}
      {...props}
    >
      {children}
    </motion.main>
  );
}
