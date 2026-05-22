import { motion, useInView } from "motion/react";
import { useRef } from "react";

export interface TextSegment {
  text: string;
  className?: string;
}

interface WordsPullUpMultiStyleProps {
  segments: TextSegment[];
  className?: string;
}

export function WordsPullUpMultiStyle({ segments, className = "" }: WordsPullUpMultiStyleProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const wordsWithStyles = segments.flatMap((segment) =>
    segment.text.split(" ").filter(Boolean).map((word) => ({
      word,
      className: segment.className,
    }))
  );

  return (
    <div ref={ref} className={`inline-flex flex-wrap ${className}`}>
      {wordsWithStyles.map(({ word, className: wordClass }, i) => (
        <span key={i} className="overflow-hidden inline-flex mr-[0.25em] last:mr-0">
          <motion.span
            initial={{ y: "100%" }}
            animate={isInView ? { y: 0 } : { y: "100%" }}
            transition={{
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
              duration: 0.8,
            }}
            className={`inline-block ${wordClass || ""}`}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </div>
  );
}
