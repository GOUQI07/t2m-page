/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Hero } from "./components/sections/Hero";
import { About } from "./components/sections/About";
import { Features } from "./components/sections/Features";
import { Workstation } from "./pages/Workstation";
import { AssetLab } from "./pages/AssetLab";
import { AssetLibrary } from "./pages/AssetLibrary";

function Home() {
  return (
    <div className="bg-black min-h-screen text-white select-none">
      <Hero />
      <About />
      <Features />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <main className="bg-black min-h-screen text-white select-none">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workstation" element={<Workstation />} />
          <Route path="/asset-lab" element={<AssetLab />} />
          <Route path="/asset-library" element={<AssetLibrary />} />
        </Routes>
      </main>
    </Router>
  );
}
