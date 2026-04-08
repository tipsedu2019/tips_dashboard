import { classPlans, siteConfig } from '../../data/homeData';
import { CalendarDays } from 'lucide-react';

function openClassesTab() {
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        type: 'tips-public-nav',
        tab: 'classes',
      },
      window.location.origin,
    );
    return;
  }

  if (typeof window !== 'undefined') {
    window.location.assign(siteConfig.siteUrl);
  }
}

export default function HomeClassInfo() {
  return (
    <section id="class-info" className="py-16 px-5 bg-slate-50 scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <div className="mb-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">수업 운영 안내</h2>
          <p className="text-slate-600 max-w-2xl mx-auto leading-relaxed">
            팁스는 교육과정을 체계적으로 계획하고 진행하기 위해 <strong className="text-slate-900">월 회차(4주 기준) 수업</strong>으로 운영합니다. <br className="hidden md:block" />
            학원 학사 일정에 따라 당월 회차의 시작일이 이전 월 말이거나 종료일이 다음 월 초가 될 수 있습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10 max-w-4xl mx-auto">
          {classPlans.map((plan, idx) => (
            <div key={idx} className="bg-white rounded-2xl p-6 border border-slate-200 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="text-slate-500 font-medium mb-2">{plan.label}</div>
              <div className="text-3xl font-bold text-slate-900 mb-2">{plan.value}</div>
              <div className="text-xs text-slate-400 bg-slate-50 inline-block px-2 py-1 rounded-md">{plan.note}</div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-slate-500 mb-4">자세한 수업 일정과 수업 계획은 공식 사이트에서 확인하실 수 있습니다.</p>
          <button
            type="button"
            onClick={openClassesTab}
            className="inline-flex items-center justify-center gap-2 bg-white text-slate-700 font-medium py-2.5 px-5 rounded-xl hover:bg-slate-50 transition-colors border border-slate-200 text-sm"
          >
            <CalendarDays className="w-4 h-4" />
            수업 안내 보러가기
          </button>
        </div>

        {/* 교재 안내 */}
        <div className="mt-20">
          <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 text-center">교재 안내</h3>
          <p className="text-slate-600 max-w-2xl mx-auto text-center mb-8">
            수업 참여에 필요한 교재는 학부모님과 학생의 편의를 위해 연계 서점 및 인쇄 전문 업체를 통해 준비를 도와드리고 있습니다.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h4 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                시중 교재
              </h4>
              <p className="text-slate-600 text-sm leading-relaxed">
                개인적으로 구매해 준비하시거나, 학원에 준비를 요청하실 수 있습니다. 학원 준비 시 교재비는 정가로 청구됩니다.
              </p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h4 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                수업 맞춤형 교재
              </h4>
              <p className="text-slate-600 text-sm leading-relaxed">
                자료비, 인쇄 및 제본비, 운임비, 인건비 등 제반 실비가 포함되며, 1권당 5천원~9천원 수준의 교재비가 청구됩니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
