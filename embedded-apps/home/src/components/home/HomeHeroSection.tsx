import { Calendar, BookOpen, MessageCircle, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { siteConfig } from '../../data/homeData';
import { useEffect, useRef } from 'react';

const HERO_VIDEO_POSTER = `${import.meta.env.BASE_URL}tips-hero-poster.jpg`;
const HERO_VIDEO_SOURCES = [
  { src: `${import.meta.env.BASE_URL}tips-hero.webm`, type: 'video/webm' },
  { src: `${import.meta.env.BASE_URL}tips-hero.mp4`, type: 'video/mp4' },
];

interface HomeHeroSectionProps {
  onOpenLetter: () => void;
}

export default function HomeHeroSection({ onOpenLetter }: HomeHeroSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch(error => {
        console.log("Video autoplay failed:", error);
      });
    }
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex flex-col justify-center pt-20 pb-24 px-6 overflow-hidden bg-black text-white">
      {/* Background Video & Overlay */}
      <div className="absolute inset-0 w-full h-full overflow-hidden z-0 bg-black">
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          poster={HERO_VIDEO_POSTER}
          preload="auto"
          playsInline
          className="absolute top-1/2 left-1/2 min-w-full min-h-full w-auto h-auto -translate-x-1/2 -translate-y-1/2 object-cover opacity-60"
        >
          {HERO_VIDEO_SOURCES.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black/90" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto w-full">
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-start"
        >
          <span className="inline-block py-1.5 px-4 rounded-full bg-white/10 backdrop-blur-md text-white/90 text-xs font-semibold tracking-widest mb-8 border border-white/20 shadow-lg">
            TIPS ENGLISH · MATH ACADEMY
          </span>
          
          <div className="flex flex-wrap gap-2.5 mb-8">
            {['초등부 · 중등부 · 고등부', '영어 · 수학', '수준 진단 · 맞춤 반배정', '월 회차 수업'].map((chip, idx) => (
              <span key={idx} className="text-xs font-medium bg-white/10 backdrop-blur-md text-white/90 px-3 py-1.5 rounded-lg border border-white/10">
                {chip}
              </span>
            ))}
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.2] md:leading-[1.15] mb-8 tracking-tight">
            <span className="block text-amber-400 mb-2 md:mb-4">꿈은 높이,</span>
            <span className="block text-amber-400 mb-4 md:mb-6">노력은 끝까지.</span>
            <span className="block text-white">실력과 공부 습관을</span>
            <span className="block text-white">함께 키우는</span>
            <span className="block text-white">팁스 영어·수학 학원</span>
          </h1>

          <p className="text-white/80 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl font-medium tracking-tight break-keep">
            팁스는 단순히 문제를 많이 푸는 학원이 아닙니다. <br className="hidden md:block" />
            학생이 스스로 목표를 세우고, 이해하고, 끝까지 해내는 힘을 기르도록 돕습니다. <br className="hidden md:block" />
            상담, 진단, 반배정, 수업, 피드백, 학부모 소통까지 <br className="hidden md:block" />
            아이에게 맞는 속도와 방향으로 성장을 설계합니다.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto mb-8">
            <a 
              href={siteConfig.channelTalkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-amber-400 text-black font-semibold py-4 px-8 rounded-2xl hover:bg-amber-300 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 w-full sm:w-auto shadow-[0_0_30px_rgba(251,191,36,0.3)]"
            >
              <MessageCircle className="w-5 h-5" />
              문의, 상담 예약하기
            </a>
            <button 
              onClick={onOpenLetter}
              className="flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md text-white font-medium py-4 px-8 rounded-2xl hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 border border-white/20 w-full sm:w-auto"
            >
              <FileText className="w-5 h-5" />
              입학신청서 작성하기
            </button>
          </div>

          <p className="text-sm text-white/50 flex items-center gap-2 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block shadow-[0_0_10px_rgba(251,191,36,0.8)]" />
            첫 상담에서 현재 수준, 필요한 보완점, 추천 방향을 함께 안내합니다.
          </p>
        </motion.div>

        {/* Hero Cards */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-20"
        >
          {[
            {
              title: "새로운 시작, 확실한 성장",
              desc: "처음 문의하는 순간부터 첫 수업까지, 학생의 현재 위치를 정확히 보고 가장 적절한 출발점을 제안합니다."
            },
            {
              title: "두 번째 학교가 되는 곳",
              desc: "학교에서 배운 것을 자기 것으로 만들고, 실력과 자신감을 함께 쌓아가는 공간을 지향합니다."
            },
            {
              title: "정직한 성장 관리",
              desc: "단기 성적만이 아니라, 장기적인 실력과 공부 습관의 변화를 함께 봅니다."
            }
          ].map((card, idx) => (
            <div key={idx} className="bg-white/5 border border-white/10 rounded-3xl p-7 backdrop-blur-xl hover:bg-white/10 transition-all duration-500 shadow-2xl shadow-black/50 group">
              <h3 className="text-xl font-semibold text-white mb-3 tracking-tight group-hover:text-amber-400 transition-colors">{card.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed font-medium">{card.desc}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
