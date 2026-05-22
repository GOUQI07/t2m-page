import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { WordsPullUpMultiStyle } from "../animations/WordsPullUpMultiStyle";

const bodyText =
  "Over the last seven years, I have worked with Parallax, a Berlin-based production house that crafts cinema, series, and Noir Studio in Paris. Together, we have created work that has earned international acclaim at several major festivals.";

interface AnimatedLetterProps {
  key?: string | number;
  char: string;
  progress: any;
  range: [number, number];
}

function AnimatedLetter({ char, progress, range }: AnimatedLetterProps) {
  const opacity = useTransform(progress, range, [0.2, 1]);
  return (
    <motion.span style={{ opacity }}>
      {char}
    </motion.span>
  );
}

export function About() {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.8", "end 0.2"],
  });

  const headingSegments = [
    { text: "I am Marcus Chen, " },
    { text: "a self-taught director. ", className: "italic font-serif" },
    { text: "I have skills in color grading, visual effects, and narrative design." },
  ];

  return (
    <section className="bg-black py-24 px-4 sm:px-6 w-full">
      <div className="bg-[#101010] rounded-3xl p-10 sm:p-16 md:p-24 max-w-6xl mx-auto flex flex-col items-center text-center">
        <span className="text-primary text-[10px] sm:text-xs uppercase tracking-widest mb-12 block">
          Visual arts
        </span>

        <WordsPullUpMultiStyle
          segments={headingSegments}
          className="justify-center text-primary text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl max-w-4xl mx-auto leading-[0.95] sm:leading-[0.9] mb-16 sm:mb-24"
        />

        <div ref={containerRef} className="max-w-2xl mx-auto">
          <p className="text-[#DEDBC8] text-xs sm:text-sm md:text-base leading-relaxed flex flex-wrap justify-center">
            {bodyText.split("").map((char, index) => {
              const charProgress = index / bodyText.length;
              const start = Math.max(0, charProgress - 0.1);
              const end = Math.min(1, charProgress + 0.05);

              return (
                <AnimatedLetter
                  key={index}
                  char={char === " " ? "\u00A0" : char}
                  progress={scrollYProgress}
                  range={[start, end]}
                />
              );
            })}
          </p>
        </div>
      </div>
    </section>
  );
}
