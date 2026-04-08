import { motion, AnimatePresence } from 'motion/react';
import { X, FileText, ExternalLink, BookOpen } from 'lucide-react';
import { siteConfig } from '../../data/homeData';

interface LetterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGuide?: () => void;
}

export default function LetterModal({ isOpen, onClose, onOpenGuide }: LetterModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col pointer-events-auto relative">
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">원장 서한</h2>
                </div>
                <button 
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-8 md:p-12 bg-[#FCFAF7]">
                <div className="max-w-3xl mx-auto space-y-8 text-slate-700 leading-relaxed break-keep">
                  {/* Title */}
                  <div className="text-center mb-12">
                    <h1 className="text-2xl md:text-4xl font-bold text-slate-900 mb-4 leading-tight">
                      [원장 서한] <br className="md:hidden" />
                      <mark className="bg-amber-200 text-slate-900 px-2 rounded-lg">팁스가 아이의 손을 잡으며 드리는 약속</mark>
                    </h1>
                  </div>

                  <p className="text-lg font-medium">
                    존경하는 학부모님께,<br /><br />
                    안녕하십니까. 팁스 영어·수학학원입니다.
                  </p>
                  <p className="text-lg font-medium">
                    오늘, 소중한 자녀의 손을 잡고 저희 팁스의 문을 두드려 주신 그 마음에 깊은 감사를 드립니다. 학부모님께서 건네주신 그 손이 얼마나 무거운 책임감인지 잘 알고 있습니다. 그것은 단지 학원 등록이라는 절차를 넘어, 아이가 마주할 미래에 대한 믿음을 저희에게 나누어 주신 것임을 가슴 깊이 새깁니다.
                  </p>
                  <p className="text-lg font-medium">
                    저 역시 한 아이를 키우는 부모의 마음으로 늘 고민합니다. '우리 아이가 단순히 정답을 맞히는 기계가 아니라, 스스로 삶의 답을 찾아가는 단단한 어른으로 성장하려면 무엇이 필요할까?' 그 고민에 대한 팁스의 대답을 담아 학부모님께 약속드립니다.
                  </p>

                  <div className="space-y-8 mt-12">
                    <div>
                      <h3 className="text-lg font-bold text-amber-700 mb-3 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                        1. 정답보다 태도를 먼저 가르치겠습니다
                      </h3>
                      <p className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-lg">
                        영어와 수학은 단지 대학을 가기 위한 도구가 아닙니다. 낯선 언어로 세상과 소통하는 용기, 그리고 복잡한 문제를 논리적으로 풀어내는 인내심을 배우는 과정입니다. 팁스는 아이들이 당장의 한 문제에 일희일비하지 않고, 목표를 세우고 끝까지 완주하는 성공의 경험을 쌓도록 돕겠습니다.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-amber-700 mb-3 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                        2. 단순한 강사가 아닌 인생의 조력자가 되겠습니다
                      </h3>
                      <p className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-lg">
                        아이들은 자신을 진심으로 믿어주는 사람을 만날 때 비로소 변하기 시작합니다. 팁스의 선생님들은 지식을 전달하는 전달자에 머물지 않겠습니다. 아이의 작은 성취에 함께 기뻐하고, 좌절의 순간에는 다시 일어설 수 있도록 곁을 지키는 인생의 페이스메이커가 되어 끝까지 함께 가겠습니다.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-amber-700 mb-3 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                        3. 학원은 아이에게 두 번째 집이자 성장의 무대여야 합니다
                      </h3>
                      <p className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-lg">
                        학교가 배움의 터전이라면, 팁스는 그 배움을 자신의 실력으로 증명해 내는 자신감의 산실이 되겠습니다. 실수해도 괜찮은 곳, 그러나 그 실수를 통해 반드시 깨우침을 얻는 곳. 아이들이 어제보다 조금 더 나은 나를 발견하며 스스로를 사랑하게 되는 공간을 만들겠습니다.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-amber-700 mb-3 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                        4. 부모님과 같은 방향을 바라보는 파트너가 되겠습니다
                      </h3>
                      <p className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-lg">
                        아이 한 명을 키우는 데 온 마을이 필요하다는 말처럼, 학원과 가정의 긴밀한 소통은 아이 성장의 핵심입니다. 저희는 아이의 학습 성과뿐만 아니라 그 과정에서 겪는 고민과 변화까지 세밀하게 살피고 공유하겠습니다. 가장 가까운 곳에서 부모님의 마음으로 아이를 함께 돌보겠습니다.
                      </p>
                    </div>
                  </div>

                  <div className="mt-12 space-y-6 text-lg font-medium">
                    <p>사랑하는 팁스 가족 여러분,</p>
                    <p>
                      우리의 아이들은 모두 각자의 계절에 피어날 준비를 하는 소중한 꽃들입니다. 팁스는 아이들이 자신만의 계절에 가장 아름답고 당당하게 꽃피울 수 있도록, 그 뿌리를 단단하게 다지는 비옥한 토양이 되겠습니다.
                    </p>
                  </div>

                  <div className="mt-16 bg-amber-50 p-8 rounded-2xl text-center border border-amber-100">
                    <p className="text-xl md:text-2xl font-bold text-amber-600 mb-6 italic">
                      "꿈은 높게, 노력은 끝까지."
                    </p>
                    <p className="text-slate-700 mb-8 text-lg">
                      이 약속은 팁스가 존재하는 이유이자, 저희가 교육자로서 지켜갈 신념입니다. <br className="hidden sm:block" />
                      저희를 믿고 귀한 자녀를 맡겨주셔서 다시 한번 머리 숙여 감사드립니다.
                    </p>
                    <p className="text-slate-800 font-bold text-lg mb-6">
                      아이의 찬란한 미래를 위해, 오늘부터 팁스가 가장 든든한 조력자가 되겠습니다.
                    </p>
                    <p className="font-bold text-slate-900 text-xl">
                      팁스 영어·수학학원 원장 드림
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer CTA */}
              <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 z-10">
                <div className="flex flex-col sm:flex-row gap-3 justify-end">
                  <button 
                    onClick={onClose}
                    className="py-4 px-6 rounded-2xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors"
                  >
                    닫기
                  </button>
                  <button 
                    onClick={() => {
                      onClose();
                      onOpenGuide?.();
                    }}
                    className="py-4 px-6 rounded-2xl bg-amber-100 text-amber-700 font-bold hover:bg-amber-200 transition-all flex items-center justify-center gap-2"
                  >
                    <BookOpen className="w-5 h-5" />
                    팁스 학부모 사용설명서 열람하기
                  </button>
                  <a 
                    href={siteConfig.admissionFormUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-4 px-6 rounded-2xl bg-amber-400 text-slate-900 font-bold hover:bg-amber-300 transition-all flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(251,191,36,0.3)]"
                  >
                    <FileText className="w-5 h-5" />
                    입학신청서 작성하기
                    <ExternalLink className="w-4 h-4 opacity-50" />
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
