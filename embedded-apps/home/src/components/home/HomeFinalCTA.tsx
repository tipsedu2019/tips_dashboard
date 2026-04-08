import { siteConfig } from '../../data/homeData';
import { Calendar, FileText, MessageCircle } from 'lucide-react';

interface HomeFinalCTAProps {
  onOpenLetter: () => void;
}

export default function HomeFinalCTA({ onOpenLetter }: HomeFinalCTAProps) {
  return (
    <section className="py-20 px-5 bg-slate-900 text-white text-center">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold mb-6">
          우리 아이에게 맞는 시작, <br className="hidden sm:block" />
          팁스와 함께 설계해보세요
        </h2>
        
        <p className="text-slate-300 text-lg mb-10 leading-relaxed">
          입학은 단순한 등록이 아니라, 앞으로의 성장 방향을 정하는 첫걸음입니다. <br className="hidden md:block" />
          지금 학생의 현재 위치를 함께 살피고, 가장 적절한 출발점을 찾아보세요.
        </p>

        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-16">
          <a 
            href={siteConfig.channelTalkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-amber-400 text-slate-900 font-semibold py-4 px-8 rounded-xl hover:bg-amber-300 transition-colors w-full sm:w-auto text-lg"
          >
            <MessageCircle className="w-5 h-5" />
            문의, 상담 예약하기
          </a>
          <button 
            onClick={onOpenLetter}
            className="flex items-center justify-center gap-2 bg-white/10 text-white font-medium py-4 px-8 rounded-xl hover:bg-white/20 transition-colors border border-white/10 w-full sm:w-auto text-lg"
          >
            <FileText className="w-5 h-5" />
            입학신청서 작성하기
          </button>
        </div>

        <div className="pt-10 border-t border-slate-800">
          <div className="text-2xl font-bold text-white mb-2">{siteConfig.brandName}</div>
          <div className="text-amber-400 font-medium mb-4">{siteConfig.slogan}</div>
          <div className="text-slate-500 text-sm mb-6">학생의 오늘과 내일을 함께 보는 교육</div>
          
          <div className="flex flex-col md:flex-row justify-center items-center gap-2 md:gap-6 text-slate-600 text-xs font-medium">
            <span>본관: {siteConfig.registrations.main}</span>
            <span className="hidden md:inline-block w-px h-3 bg-slate-800" />
            <span>별관: {siteConfig.registrations.annex}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
