import { motion, useInView } from "motion/react";
import { useRef } from "react";

interface WordsPullUpProps {
  text: string;
  className?: string;
  showAsterisk?: boolean;
}

export function WordsPullUp({ text, className = "", showAsterisk = false }: WordsPullUpProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const words = text.split(" ");

  return (
    <div ref={ref} className={`flex flex-wrap ${className}`}>
      {words.map((word, i) => (
        <span key={i} className="overflow-hidden inline-flex mr-[0.2em] last:mr-0 relative">
          <motion.span
            initial={{ y: "100%" }}
            animate={isInView ? { y: 0 } : { y: "100%" }}
            transition={{
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
              duration: 0.8,
            }}
            className="inline-block"
          >
            {word}
            {showAsterisk && i === words.length - 1 && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
            )}
          </motion.span>
        </span>
      ))}
    </div>
  );
}
