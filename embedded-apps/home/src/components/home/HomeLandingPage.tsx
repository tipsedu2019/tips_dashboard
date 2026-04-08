import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import HomeHeroSection from './HomeHeroSection';
import HomeValueProps from './HomeValueProps';
import HomeProgramExplorer from './HomeProgramExplorer';
import HomeWhyTips from './HomeWhyTips';
import HomeAdmissionSteps from './HomeAdmissionSteps';
import HomeClassInfo from './HomeClassInfo';
import HomePolicyAccordion from './HomePolicyAccordion';
import HomeLocationSection from './HomeLocationSection';
import HomeFaqSection from './HomeFaqSection';
import HomeFinalCTA from './HomeFinalCTA';
import LetterModal from './LetterModal';
import ParentGuideModal from './ParentGuideModal';

export default function HomeLandingPage() {
  const [isLetterModalOpen, setIsLetterModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const openLetterModal = () => setIsLetterModalOpen(true);
  const closeLetterModal = () => setIsLetterModalOpen(false);

  const openGuideModal = () => setIsGuideModalOpen(true);
  const closeGuideModal = () => setIsGuideModalOpen(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 500) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col w-full relative">
      {/* Scroll to Top Floating Button (Top Right as requested) */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed top-6 right-6 z-[100] w-12 h-12 bg-white/10 backdrop-blur-xl border border-white/20 text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-white/20 transition-all duration-300 group"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-6 h-6 group-hover:-translate-y-1 transition-transform" />
        </button>
      )}

      <HomeHeroSection onOpenLetter={openLetterModal} />
      <HomeValueProps />
      <HomeProgramExplorer />
      <HomeWhyTips onOpenGuide={openGuideModal} />
      <HomeAdmissionSteps onOpenLetter={openLetterModal} />
      <HomeClassInfo />
      <HomePolicyAccordion />
      <HomeLocationSection />
      <HomeFaqSection />
      <HomeFinalCTA onOpenLetter={openLetterModal} />

      <LetterModal isOpen={isLetterModalOpen} onClose={closeLetterModal} onOpenGuide={openGuideModal} />
      <ParentGuideModal isOpen={isGuideModalOpen} onClose={closeGuideModal} />
    </div>
  );
}
