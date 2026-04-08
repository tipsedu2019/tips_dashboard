import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { divisionTabs, subjectTabs, programData } from '../../data/homeData';
import { CheckCircle2 } from 'lucide-react';

type Division = 'elementary' | 'middle' | 'high';
type Subject = 'english' | 'math';

export default function HomeProgramExplorer() {
  const [activeDivision, setActiveDivision] = useState<Division>('elementary');
  const [activeSubject, setActiveSubject] = useState<Subject>('english');

  const currentProgram = programData[activeDivision][activeSubject];

  return (
    <section id="program" className="py-24 px-6 bg-white scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 tracking-tight">
            초등부 · 중등부 · 고등부,<br className="md:hidden" /> 영어 · 수학을 한눈에
          </h2>
          <p className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto font-medium tracking-tight">
            학년과 과목이 같아도 필요한 수업은 학생마다 다릅니다. 팁스는 수준 진단과 상담을 바탕으로 가장 적절한 반과 학습 방향을 제안합니다.
          </p>
        </div>

        <div className="bg-[#F5F5F7] rounded-[2.5rem] p-4 md:p-8">
          {/* Division Tabs */}
          <div className="flex p-1.5 bg-slate-200/50 rounded-2xl mb-8 max-w-md mx-auto">
            {divisionTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveDivision(tab.id as Division)}
                className={`flex-1 py-3 text-center font-bold text-sm md:text-base rounded-xl transition-all relative z-10 ${
                  activeDivision === tab.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {activeDivision === tab.id && (
                  <motion.div 
                    layoutId="activeDivisionBg" 
                    className="absolute inset-0 bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] -z-10" 
                  />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-[2rem] p-6 md:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            {/* Subject Segmented Control */}
            <div className="flex p-1 bg-slate-100 rounded-xl mb-10 max-w-[200px] mx-auto">
              {subjectTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubject(tab.id as Subject)}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    activeSubject === tab.id 
                      ? 'bg-white text-slate-900 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Area */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeDivision}-${activeSubject}`}
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <div className="mb-8 text-center">
                  <h3 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">{currentProgram.title}</h3>
                  <p className="text-slate-500 text-lg md:text-xl font-medium">{currentProgram.summary}</p>
                </div>

                <div className="bg-[#F5F5F7] rounded-3xl p-8 mb-8">
                  <ul className="space-y-4">
                    {currentProgram.bullets.map((bullet, idx) => (
                      <li key={idx} className="flex items-start gap-4">
                        <CheckCircle2 className="w-6 h-6 text-amber-500 flex-shrink-0" />
                        <span className="text-slate-700 font-medium text-lg">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-amber-50 rounded-2xl p-6 text-center">
                  <p className="text-amber-900 font-medium text-base md:text-lg leading-relaxed">
                    <span className="font-bold mr-2">💡 팁스의 방향:</span>
                    {currentProgram.highlight}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-sm text-slate-400 mt-8 font-medium">
          실제 반 편성은 학년만이 아니라 현재 수준, 목표, 학습 습관, 필요한 보완 영역을 함께 고려해 상담 후 안내합니다.
        </p>
      </div>
    </section>
  );
}
