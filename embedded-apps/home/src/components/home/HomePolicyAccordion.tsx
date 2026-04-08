import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { paymentMethods, policyAccordions } from '../../data/homeData';
import { ChevronDown, CreditCard, AlertCircle } from 'lucide-react';

export default function HomePolicyAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="py-16 px-5 bg-white">
      <div className="max-w-3xl mx-auto">
        
        {/* 결제/교육비 섹션 */}
        <div className="mb-16">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 text-center">교육비 및 결제 안내</h2>
          
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {['선납 원칙', '첫 수업 전 결제 완료', '모바일 청구서 가능', '탐나는전 결제 가능'].map((badge, idx) => (
              <span key={idx} className="bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-amber-200">
                {badge}
              </span>
            ))}
          </div>

          <p className="text-slate-600 text-center mb-8 leading-relaxed">
            입학 결정 후 입학신청서를 작성해 주시면, 기재된 학부모님의 휴대폰 번호로 모바일 청구서가 발송됩니다. <br className="hidden md:block" />
            교육비와 교재비는 선납 원칙이며, 첫 수업 시작 전까지 결제 완료되어야 입학이 최종 완료됩니다.
          </p>

          <div className="space-y-4 mb-8">
            {paymentMethods.map((method, idx) => (
              <div key={idx} className="flex items-start gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <CreditCard className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 mb-1">{method.title}</h4>
                  <p className="text-slate-700 text-sm mb-1">{method.body}</p>
                  <p className="text-slate-400 text-xs">{method.sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex gap-3">
            <AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <ul className="text-sm text-slate-600 space-y-2 list-disc list-inside">
              <li>당월 중간 등록 시 첫 달 교육비는 4주 기준으로 청구될 수 있으며, 다음 달 교육비가 일할 계산으로 차감되어 청구될 수 있습니다.</li>
              <li>교재비 미납 시 첫 수업은 복사물로 진행될 수 있으나 이후 수업 진행을 위해 납부 안내가 이루어질 수 있습니다.</li>
              <li>미납 상태가 지속되는 경우 등록이 취소될 수 있습니다.</li>
            </ul>
          </div>
        </div>

        {/* 보강/환불 규정 아코디언 */}
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8 text-center">보강 및 환불 규정</h2>
          
          <div className="space-y-3">
            {policyAccordions.map((item, idx) => (
              <div key={idx} className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                <button
                  onClick={() => toggleAccordion(idx)}
                  className="w-full flex items-center justify-between p-5 text-left focus:outline-none focus-visible:bg-slate-50"
                  aria-expanded={openIndex === idx}
                >
                  <span className="font-semibold text-slate-900">{item.title}</span>
                  <ChevronDown 
                    className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${openIndex === idx ? 'rotate-180' : ''}`} 
                  />
                </button>
                <AnimatePresence>
                  {openIndex === idx && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="p-5 pt-0 text-sm text-slate-600 leading-relaxed border-t border-slate-100 bg-slate-50/50">
                        {item.content}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
