import { motion, useInView } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { useRef } from "react";
import { WordsPullUpMultiStyle } from "../animations/WordsPullUpMultiStyle";

const cards = [
  {
    type: "video",
    video: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_133058_0504132a-0cf3-4450-a370-8ea3b05c95d4.mp4",
    text: "Your creative canvas.",
  },
  {
    type: "feature",
    number: "01",
    title: "Project Storyboard.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85",
    items: [
      "Scene-by-scene tracking",
      "Moodboard integration",
      "Draft versioning",
      "Collaborative notes",
    ],
  },
  {
    type: "feature",
    number: "02",
    title: "Smart Critiques.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85",
    items: [
      "AI pacing analysis",
      "Automated creative notes",
      "Plugin tool integrations",
    ],
  },
  {
    type: "feature",
    number: "03",
    title: "Immersion Capsule.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85",
    items: [
      "Notification silencing",
      "Ambient soundscapes",
      "Studio schedule syncing",
    ],
  },
];

export function Features() {
  const containerRef = useRef(null);
  const isInView = useInView(containerRef, { once: true, margin: "-100px" });

  const headingSegments = [
    { text: "Studio-grade workflows for visionary creators. ", className: "text-[#E1E0CC]" },
    { text: "Built for pure vision. Powered by art.", className: "text-gray-500" },
  ];

  return (
    <section className="min-h-screen w-full relative bg-black py-24 px-4 sm:px-6 md:px-8">
      {/* Absolute Noise Overlay */}
      <div className="bg-noise opacity-[0.15] pointer-events-none" />

      <div className="relative z-10 max-w-[1400px] mx-auto flex flex-col gap-12 sm:gap-16">
        <div className="max-w-4xl">
          <WordsPullUpMultiStyle
            segments={headingSegments}
            className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-normal leading-snug justify-start text-left"
          />
        </div>

        <div
          ref={containerRef}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-2 md:gap-1 lg:h-[480px]"
        >
          {cards.map((card, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
              transition={{
                delay: idx * 0.15,
                duration: 0.8,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="h-full rounded-2xl overflow-hidden relative group"
            >
              {card.type === "video" ? (
                <div className="w-full h-[400px] lg:h-full relative overflow-hidden bg-[#212121]">
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    src={card.video}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60" />
                  <div className="absolute bottom-6 left-6 right-6">
                    <span className="text-[#E1E0CC] text-lg font-medium tracking-tight">
                      {card.text}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full bg-[#212121] p-6 lg:p-8 flex flex-col min-h-[400px]">
                  <img
                    src={card.icon}
                    alt={card.title}
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded bg-black/30 object-cover mb-8"
                  />
                  
                  <div className="flex-1">
                    <div className="flex flex-col gap-1 mb-6">
                      <span className="text-gray-500 text-xs font-mono">{card.number}</span>
                      <h3 className="text-[#E1E0CC] text-lg lg:text-xl tracking-tight">
                        {card.title}
                      </h3>
                    </div>

                    <ul className="flex flex-col gap-4">
                      {card.items?.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-gray-400 text-sm leading-tight">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-8 mt-auto">
                    <a
                      href="#"
                      className="inline-flex items-center gap-2 text-primary hover:text-white transition-colors text-sm font-medium"
                    >
                      Learn more
                      <ArrowRight className="w-4 h-4 -rotate-45" />
                    </a>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
