import { motion } from 'motion/react';
import { admissionSteps, siteConfig } from '../../data/homeData';
import { ArrowRight, FileText, Phone, MessageCircle } from 'lucide-react';

interface HomeAdmissionStepsProps {
  onOpenLetter: () => void;
}

export default function HomeAdmissionSteps({ onOpenLetter }: HomeAdmissionStepsProps) {
  return (
    <section id="admission" className="py-16 px-5 bg-slate-900 text-white scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">입학은 이렇게 진행됩니다</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            복잡하지 않게, 하지만 충분히 정확하게.<br />
            학생의 현재 상태를 보고 가장 적절한 시작점을 찾는 과정입니다.
          </p>
        </div>

        <div className="relative max-w-3xl mx-auto mb-16">
          {/* Vertical Line for Desktop */}
          <div className="hidden md:block absolute left-[27px] top-8 bottom-8 w-px bg-gradient-to-b from-amber-500/50 via-slate-700 to-slate-800" />

          <div className="space-y-6 md:space-y-8">
            {admissionSteps.map((step, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className="relative flex flex-col md:flex-row gap-4 md:gap-8 group"
              >
                <div className="flex items-center md:items-start gap-4 md:w-16 flex-shrink-0 z-10">
                  <div className="w-10 h-10 md:w-14 md:h-14 rounded-full bg-slate-900 border-2 border-amber-500 text-amber-400 flex items-center justify-center font-bold text-lg md:text-xl shadow-[0_0_15px_rgba(245,158,11,0.15)] group-hover:bg-amber-500 group-hover:text-slate-900 group-hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all duration-300">
                    {step.step}
                  </div>
                  <h3 className="text-lg font-bold md:hidden text-white">{step.title}</h3>
                </div>
                
                <div className="bg-slate-800/40 backdrop-blur-sm border border-slate-700/50 p-6 rounded-2xl flex-1 group-hover:bg-slate-800/60 group-hover:border-slate-600 transition-all duration-300">
                  <h3 className="hidden md:block text-xl font-bold mb-3 text-white group-hover:text-amber-400 transition-colors">{step.title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="max-w-3xl mx-auto space-y-4 mb-16">
          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
            <h4 className="text-amber-400 font-bold mb-3 flex items-center gap-2">
              <Phone className="w-4 h-4" />
              {siteConfig.consultationGuide.title}
            </h4>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {siteConfig.consultationGuide.content}
            </p>
          </div>

          <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50">
            <p className="text-sm text-slate-400 flex items-start gap-2">
              <span className="text-amber-500/70 font-bold">참고</span>
              고1 1학기 중간고사 이후 시기부터는 내신 및 학평 성적을 바탕으로 레벨테스트 없이 바로 상담이 가능한 경우도 있습니다.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-md mx-auto">
          <a 
            href={siteConfig.channelTalkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-amber-400 text-slate-900 font-semibold py-3.5 px-6 rounded-xl hover:bg-amber-300 transition-colors w-full"
          >
            <MessageCircle className="w-5 h-5" />
            문의, 상담 예약하기
          </a>
          <button 
            onClick={onOpenLetter}
            className="flex items-center justify-center gap-2 bg-slate-800 text-white font-medium py-3.5 px-6 rounded-xl hover:bg-slate-700 transition-colors border border-slate-700 w-full"
          >
            <FileText className="w-5 h-5" />
            입학신청서 작성하기
          </button>
        </div>
      </div>
    </section>
  );
}
