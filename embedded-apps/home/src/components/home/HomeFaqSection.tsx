import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { faqItems } from '../../data/homeData';
import { Plus, Minus } from 'lucide-react';

export default function HomeFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-16 px-5 bg-white scroll-mt-16">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">자주 묻는 질문</h2>
          <p className="text-slate-600 max-w-2xl mx-auto">
            처음 문의하시는 학부모님들이 가장 자주 궁금해하시는 내용을 모았습니다.
          </p>
        </div>

        <div className="space-y-4">
          {faqItems.map((item, idx) => (
            <div key={idx} className="border-b border-slate-200 last:border-0">
              <button
                onClick={() => toggleFaq(idx)}
                className="w-full flex items-start justify-between py-5 text-left focus:outline-none group"
                aria-expanded={openIndex === idx}
              >
                <span className="font-semibold text-slate-900 pr-8 group-hover:text-amber-600 transition-colors">
                  <span className="text-amber-500 mr-2">Q.</span>
                  {item.q}
                </span>
                <span className="flex-shrink-0 mt-0.5 text-slate-400 group-hover:text-amber-500 transition-colors">
                  {openIndex === idx ? <Minus className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                </span>
              </button>
              <AnimatePresence>
                {openIndex === idx && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="pb-5 pt-1 text-slate-600 leading-relaxed pr-8">
                      <span className="text-slate-400 font-bold mr-2">A.</span>
                      {item.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
