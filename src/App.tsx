/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactElement } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Hero } from "./components/sections/Hero";
import { About } from "./components/sections/About";
import { Features } from "./components/sections/Features";
import { Workstation } from "./pages/Workstation";
import { AssetLab } from "./pages/AssetLab";
import { AssetLibrary } from "./pages/AssetLibrary";
import { AuthPage } from "./pages/AuthPage";
import { NewProject } from "./pages/NewProject";
import { StoryPreprocessPage } from "./pages/StoryPreprocessPage";
import { MarketPlaza } from "./pages/MarketPlaza";
import { AdminMarket } from "./pages/AdminMarket";
import { useAuth } from "./auth/AuthContext";

function Home() {
  return (
    <div className="bg-black min-h-screen text-white select-none">
      <Hero />
      <About />
      <Features />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-primary">
        <div className="border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-primary/70">Checking session...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-primary">
        <div className="border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-primary/70">Checking session...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!user.roles?.some(role => roles.includes(role))) {
    return <Navigate to="/market" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Router>
      <main className="bg-black min-h-screen text-white select-none">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/projects/new" element={<RequireAuth><NewProject /></RequireAuth>} />
          <Route path="/projects/new/story" element={<RequireAuth><StoryPreprocessPage /></RequireAuth>} />
          <Route path="/workstation" element={<RequireAuth><Workstation /></RequireAuth>} />
          <Route path="/asset-lab" element={<RequireAuth><AssetLab /></RequireAuth>} />
          <Route path="/asset-library" element={<RequireAuth><AssetLibrary /></RequireAuth>} />
          <Route path="/market" element={<RequireAuth><MarketPlaza /></RequireAuth>} />
          <Route path="/admin/market" element={<RequireRole roles={["ADMIN", "REVIEWER"]}><AdminMarket /></RequireRole>} />
        </Routes>
      </main>
    </Router>
  );
}
