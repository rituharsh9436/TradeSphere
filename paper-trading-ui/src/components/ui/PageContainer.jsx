import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export function PageContainer({ children, className, maxWidth = "max-w-5xl", ...props }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(`mx-auto p-4 md:p-8 ${maxWidth}`, className)}
      {...props}
    >
      {children}
    </motion.main>
  );
}
