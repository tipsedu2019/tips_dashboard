"use client";

import { CTASection } from "./components/cta-section";
import { LandingFooter } from "./components/footer";
import { FeaturesSection } from "./components/features-section";
import { FaqSection } from "./components/faq-section";
import { HeroSection } from "./components/hero-section";
import { LandingNavbar } from "./components/navbar";
import { StatsSection } from "./components/stats-section";

export function LandingPageContent() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNavbar />
      <main>
        <HeroSection />
        <StatsSection />
        <FeaturesSection />
        <FaqSection />
        <CTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
