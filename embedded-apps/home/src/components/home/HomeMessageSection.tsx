import { siteConfig } from '../../data/homeData';
import { MessageCircle } from 'lucide-react';

export default function HomeMessageSection() {
  return (
    <section className="py-24 px-6 bg-white">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row items-center gap-12 mb-20">
          <div className="w-48 h-48 md:w-64 md:h-64 flex-shrink-0">
            <img 
              src="https://ais-dev-22wajbazs3i7jm5msqnlri-167596384691.asia-northeast1.run.app/attachments/246473f3-9467-466d-b873-14b53773e3a4" 
              alt="Tips Academy Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 tracking-tight">
              &lt; 영어수학 걱정은 팁스로 끝! &gt;
            </h2>
            <div className="space-y-4 text-slate-600 text-lg leading-relaxed font-medium break-keep">
              <p>
                팁스에는 제주시내 초중고등학교 영어수학 과목 내신수능 대비에 전문적이고 매우 효과적인 솔루션이 있습니다.
              </p>
              <p>
                학생들의 '더 나은 미래'를 위해서는 지금보다 '더 나은 교육'이 필요합니다.
              </p>
              <p>
                지금 바로 팁스의 '더 나은 교육'을 경험하고, 목표에 더 다가가세요.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-[#F5F5F7] rounded-[2.5rem] p-8 md:p-12 border border-slate-100 shadow-sm">
          <div className="flex flex-col md:flex-row gap-8 items-center">
            <div className="flex-1">
              <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 tracking-tight">
                &lt; 전문 교육상담 예약 &gt;
              </h3>
              <div className="space-y-4 text-slate-600 text-base md:text-lg leading-relaxed break-keep">
                <p>
                  팁스에서는 더 전문적인 교육상담을 제공해드리기 위해 처음부터 담당 과목의 원장 선생님이 직접 친절하게 상담해드립니다.
                </p>
                <p>
                  교육상담 예약 없이 방문하시는 경우에는 원장선생님 부재중으로 인해 바로 상담이 어려울 수도 있는 점 양해 부탁드리며, 방문 전에는 먼저 전화, 채팅상담 등을 통해 예약을 해주시길 바랍니다.
                </p>
              </div>
            </div>
            <div className="w-full md:w-auto">
              <a 
                href={siteConfig.channelTalkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-amber-400 text-slate-900 font-bold py-4 px-8 rounded-2xl hover:bg-amber-300 transition-all shadow-lg shadow-amber-200/50"
              >
                <MessageCircle className="w-5 h-5" />
                상담 예약하기
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
