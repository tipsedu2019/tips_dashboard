import { motion } from 'motion/react';
import { HeartHandshake, Lightbulb, Users, BookOpen } from 'lucide-react';

interface HomeWhyTipsProps {
  onOpenGuide?: () => void;
}

export default function HomeWhyTips({ onOpenGuide }: HomeWhyTipsProps) {
  return (
    <section className="py-24 px-6 bg-[#F5F5F7]">
      <div className="max-w-5xl mx-auto">
        <div className="mb-16 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-8 tracking-tight">
            선생님은 단순한 강사가 아닙니다
          </h2>
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-[2.5rem] p-10 md:p-16 relative overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.15)] text-left">
            <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/15 rounded-full blur-[80px] -mr-20 -mt-20" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-500/15 rounded-full blur-[80px] -ml-20 -mb-20" />
            
            <p className="text-xl md:text-3xl leading-relaxed mb-12 relative z-10 font-bold text-white tracking-tight">
              팁스의 선생님은 수업만 진행하는 사람이 아니라,<br className="hidden md:block" />
              학생 한 명 한 명의 가능성을 끝까지 믿고 끌어주는 조력자입니다. <br className="hidden md:block" />
              기억에 남는 선생님, 삶에 영향을 주는 교육자가 되기 위해 <br className="hidden md:block" />
              매 순간 책임감 있게 학생을 대합니다.
            </p>
            
            <blockquote className="border-l-4 border-amber-400 pl-6 py-3 relative z-10 bg-white/5 rounded-r-2xl backdrop-blur-md">
              <p className="text-slate-200 italic text-lg md:text-xl font-medium">
                "학원은 점수를 올리는 공간을 넘어,<br className="hidden sm:block" />
                학생이 자신의 한계를 넘어 자신감을 얻는 두 번째 학교여야 합니다."
              </p>
            </blockquote>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-20">
          <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-shadow">
            <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mb-6">
              <Lightbulb className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">설명할 수 있을 만큼 이해하게</h3>
            <p className="text-slate-500 text-base font-medium">외운 지식이 아니라 자기 것이 된 배움은 오래 갑니다.</p>
          </div>
          <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-shadow flex flex-col items-start">
            <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mb-6">
              <Users className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">가정과 함께 가는 교육</h3>
            <p className="text-slate-500 text-base font-medium mb-6">학원, 학교, 가정이 같은 방향을 볼 때 아이의 성장은 더 분명해집니다.</p>
            
            <button 
              onClick={onOpenGuide}
              className="mt-auto inline-flex items-center gap-2 bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold py-3 px-5 rounded-xl transition-colors text-sm shadow-sm"
            >
              <BookOpen className="w-4 h-4" />
              팁스 학부모 사용설명서 열람하기
            </button>
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] p-10 md:p-14 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 className="text-2xl md:text-3xl font-bold text-slate-900 mb-10 tracking-tight">이런 학생과 학부모님께 추천합니다</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-left max-w-4xl mx-auto">
            {[
              "현재 수준에 맞는 반과 학습 방향이 필요한 경우",
              "내신과 실력을 함께 관리하고 싶은 경우",
              "성적뿐 아니라 공부 습관까지 함께 잡고 싶은 경우",
              "정기적인 피드백과 소통이 중요한 경우"
            ].map((item, idx) => (
              <li key={idx} className="flex items-center gap-4 bg-[#F5F5F7] p-5 rounded-2xl">
                <HeartHandshake className="w-6 h-6 text-amber-500 flex-shrink-0" />
                <span className="text-slate-700 font-bold text-base">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
