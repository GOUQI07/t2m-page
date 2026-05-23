import { motion } from "motion/react";
import { ArrowRight, FolderPlus, LogIn, LogOut, Store, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { WordsPullUp } from "../animations/WordsPullUp";
import { useAuth } from "../../auth/AuthContext";

import { ParticleMorph } from "../animations/ParticleMorph";

export function Hero() {
  const { user, logout } = useAuth();
  const topNavLinkClass = "text-[10px] sm:text-xs md:text-sm transition-colors duration-300";
  const topNavLinkStyle = { color: "rgba(225, 224, 204, 0.8)" };
  const brightenTopNavLink = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.style.color = "#E1E0CC";
  };
  const dimTopNavLink = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.style.color = "rgba(225, 224, 204, 0.8)";
  };

  return (
    <section className="h-screen w-full p-4 md:p-6 bg-black">
      <div className="relative w-full h-full rounded-2xl md:rounded-[2rem] overflow-hidden bg-black">
        {/* Particle Morph Effect */}
        <ParticleMorph />

        {/* Overlays */}
        <div className="noise-overlay opacity-[0.7] mix-blend-overlay pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60 pointer-events-none" />

        {/* Navbar Pill */}
        <nav className="absolute top-0 left-1/2 -translate-x-1/2 bg-black rounded-b-2xl md:rounded-b-3xl px-4 py-2 md:px-8 flex items-center justify-center gap-3 sm:gap-6 md:gap-12 lg:gap-14 z-10">
          {["Our story", "Collective", "Workshops"].map((item) => (
            <a
              key={item}
              href="#"
              className={topNavLinkClass}
              style={topNavLinkStyle}
              onMouseEnter={brightenTopNavLink}
              onMouseLeave={dimTopNavLink}
            >
              {item}
            </a>
          ))}
          <Link
            to="/market"
            className={`${topNavLinkClass} inline-flex items-center gap-1.5`}
            style={topNavLinkStyle}
            onMouseEnter={brightenTopNavLink}
            onMouseLeave={dimTopNavLink}
          >
            Plaza
            <Store className="h-3.5 w-3.5" />
          </Link>
          {user ? (
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1 text-[10px] sm:text-xs md:text-sm text-primary/80 transition-colors hover:text-primary"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          ) : (
            <>
              <Link to="/login" className="inline-flex items-center gap-1 text-[10px] sm:text-xs md:text-sm text-primary/80 transition-colors hover:text-primary">
                <LogIn className="h-3.5 w-3.5" />
                Login
              </Link>
              <Link to="/register" className="inline-flex items-center gap-1 text-[10px] sm:text-xs md:text-sm text-primary/80 transition-colors hover:text-primary">
                <UserPlus className="h-3.5 w-3.5" />
                Register
              </Link>
            </>
          )}
        </nav>

        {/* Bottom Content */}
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 z-10 w-full">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-0 items-end">
            {/* Left 8 columns - Heading */}
            <div className="col-span-1 md:col-span-8 flex items-end">
              <WordsPullUp
                text="Ariadne"
                className="text-[26vw] sm:text-[24vw] md:text-[22vw] lg:text-[18vw] xl:text-[17vw] 2xl:text-[18vw] font-medium leading-[0.85] tracking-[-0.07em] text-[#E1E0CC]"
                showAsterisk
              />
            </div>

            {/* Right 4 columns - Text + CTA */}
            <div className="col-span-1 md:col-span-4 flex flex-col gap-6 md:gap-8 justify-end pb-2 md:pb-4">
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  delay: 0.5,
                  duration: 0.8,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="text-primary/70 text-xs sm:text-sm md:text-base leading-[1.2]"
              >
                Ariadne is a worldwide network of visual artists, filmmakers and storytellers bound not by place, status or labels but by passion and hunger to unlock potential through our unique perspectives.
              </motion.p>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  delay: 0.7,
                  duration: 0.8,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <Link to="/projects/new" className="group inline-flex items-center gap-2 hover:gap-3 bg-primary rounded-full pl-5 pr-1 py-1 transition-all duration-300">
                  <span className="text-black font-medium text-sm sm:text-base ml-1">
                    New Project
                  </span>
                  <div className="bg-black rounded-full w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ml-2">
                    <FolderPlus className="text-[#E1E0CC] w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                </Link>
                <Link to="/workstation" className="ml-3 inline-flex items-center gap-2 rounded-full border border-primary/30 px-5 py-3 text-sm sm:text-base text-primary/80 transition-colors hover:border-primary hover:text-primary">
                  Workstation
                  <ArrowRight className="w-4 h-4 -rotate-45" />
                </Link>
                <Link to="/asset-lab" className="ml-3 inline-flex items-center gap-2 rounded-full border border-primary/30 px-5 py-3 text-sm sm:text-base text-primary/80 transition-colors hover:border-primary hover:text-primary">
                  Asset Lab
                  <ArrowRight className="w-4 h-4 -rotate-45" />
                </Link>
                <Link to="/asset-library" className="ml-3 inline-flex items-center gap-2 rounded-full border border-primary/30 px-5 py-3 text-sm sm:text-base text-primary/80 transition-colors hover:border-primary hover:text-primary">
                  Library
                  <ArrowRight className="w-4 h-4 -rotate-45" />
                </Link>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
