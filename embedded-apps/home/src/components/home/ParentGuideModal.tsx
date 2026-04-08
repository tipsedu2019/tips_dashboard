import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen } from 'lucide-react';

interface ParentGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ParentGuideModal({ isOpen, onClose }: ParentGuideModalProps) {
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
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">학부모 사용설명서</h2>
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
                      [가정 연계 교육 가이드] <br className="md:hidden" />
                      우리 아이 성장을 위한 <br className="md:hidden" />
                      <mark className="bg-amber-200 text-slate-900 px-2 rounded-lg">팁스 학부모 사용설명서</mark>
                    </h1>
                    <p className="text-lg md:text-xl font-medium text-slate-600 italic">
                      '가정과 학원이 같은 방향을 바라보는 교육'을 실천하기 위해, <br className="hidden md:block" />
                      가정에서 함께해 주셔야 할 구체적인 나침반을 공유합니다.
                    </p>
                  </div>

                  <p className="text-lg font-medium">
                    학원에서의 밀착 지도에 아이가 가장 편안함을 느끼는 가정의 정서적 뒷받침이 더해질 때, 아이의 성장은 비로소 견고해집니다. 아이들이 마주하는 학업의 무게와 심리적 변화는 학년마다 크게 다릅니다. 이에 따라 가정에서 부모님이 해주셔야 하는 역할도 섬세하게 달라져야 합니다.
                  </p>
                  <p className="text-lg font-medium">
                    교육 전문가가 아니시기에 막막하실 수 있는 부모님들을 위해, 초등학교 4학년부터 고등학교 3학년까지 각 학년별 핵심 가이드와 공통 실천 사항을 5개의 챕터로 정리했습니다. 곁에 두고 편히 꺼내 보시는 든든한 지침서로 활용해 주십시오.
                  </p>

                  {/* Section 1 */}
                  <section className="mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 pb-2 border-b-2 border-amber-200">
                      1. 초등학교 학년별 가이드: 공부 정서와 바른 습관 형성의 골든타임
                    </h2>
                    <p className="mb-6 font-medium">
                      초등학교 고학년은 추상적인 개념이 등장하며 본격적인 학습이 시작되는 시기입니다. 지식의 주입보다는 공부에 대한 흥미를 잃지 않고, 스스로 책상에 앉는 '습관의 뼈대'를 세우는 것에 집중해야 합니다.
                    </p>

                    <div className="space-y-8">
                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [초등학교 4학년] "학습 난이도 점프업 시기, 작은 성취로 자존감 끌어올리기"
                        </h3>
                        <p className="mb-2">수학의 분수와 소수 등 추상적 개념이 등장하며 처음으로 공부를 버거워할 수 있는 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          아이가 좌절하지 않도록 '틀린 문제'보다 '맞힌 문제'에 집중해 주십시오. "오늘 푼 문제 중에 제일 어려웠던 게 뭐야? 와, 이걸 혼자 고민해서 풀었어?"라며 아이의 노력을 인정해 주는 작은 칭찬이 공부 자존감을 높이는 최고의 비타민이 됩니다.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [초등학교 5학년] "본격적인 학습 격차 발생, 시간 관리의 기초 잡기"
                        </h3>
                        <p className="mb-2">역사 등 새로운 과목이 등장하고 학습량이 눈에 띄게 늘어나면서 아이들 간의 학습 격차가 벌어지기 시작합니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          스스로 계획을 세우고 지키는 연습을 시작해야 합니다. 거창한 계획표보다는 '방과 후 1시간 복습하기' 같은 작은 목표를 세우고, 이를 달성했을 때 소소한 보상을 제공하며 성취감을 맛보게 해 주십시오. 부모님이 지시하기보다 "오늘 학원 다녀와서 어떤 순서로 숙제할까?"라고 스스로 스케줄을 짜도록 유도해 주십시오.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [초등학교 6학년] "예비 중등 단계, '엉덩이 힘' 기르기와 메타인지 훈련"
                        </h3>
                        <p className="mb-2">중학교 진학을 앞두고 초등 과정을 갈무리하며 체력과 집중력을 서서히 끌어올려야 하는 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          무리하게 긴 시간을 강요하기보다 타이머를 활용해 30분 집중, 5분 휴식 등 아이만의 집중 사이클을 만들어 '엉덩이 힘'을 길러주십시오. 또한 "오늘 학원에서 배운 내용 엄마한테 선생님처럼 설명해 줄래?"라며 스스로 아는 것과 모르는 것을 구분하는 메타인지 능력을 키워주시면 중등 학습에 큰 무기가 됩니다.
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Section 2 */}
                  <section className="mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 pb-2 border-b-2 border-amber-200">
                      2. 중학교 학년별 가이드: 사춘기의 파도 속에서 '자기주도'의 싹 틔우기
                    </h2>
                    <p className="mb-6 font-medium">
                      중학교 시기는 신체적, 정서적 변화가 가장 크며, 평생의 공부 그릇을 결정짓는 시기입니다. 부모님은 '지시자'가 아닌, 한 발짝 뒤에서 지켜보는 '조력자'가 되어 주셔야 합니다.
                    </p>

                    <div className="space-y-8">
                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [중학교 1학년] "시험 없는 1년, 진짜 실력을 쌓고 흥미를 발견하는 시기"
                        </h3>
                        <p className="mb-2">자유학기제(혹은 학년제)로 지필고사 부담이 없는 시기입니다. 하지만 자칫 학습 긴장감이 가장 떨어지기 쉬운 때이기도 합니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          당장의 성적이 안 나오더라도 매일 일정한 시간 책상에 앉아 복습하는 습관 자체를 크게 칭찬해 주십시오. 다양한 진로 탐색의 골든타임이므로, 관심 분야의 다큐멘터리나 책을 함께 보며 "너라면 이 분야에서 어떤 일을 해보고 싶어?"와 같이 대화를 넓혀 주십시오.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [중학교 2학년] "첫 지필고사의 압박과 사춘기 절정, 멘탈 관리가 핵심"
                        </h3>
                        <p className="mb-2">본격적으로 성적이 숫자로 나오며 자신의 객관적 위치를 마주하게 됩니다. 동시에 감정의 기복이 가장 심한 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          첫 시험 성적표를 받았을 때, 점수에 실망하기보다 "처음이라 긴장했을 텐데 고생 많았다. 어떤 문제가 제일 헷갈렸어?"라며 '평가'가 아닌 '분석'을 함께 해 주십시오. 예민한 시기이므로 "공부해라"는 잔소리보다는 묵묵히 간식을 챙겨주는 무언의 응원이 더 효과적입니다.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [중학교 3학년] "고등 학습의 베이스캠프, 집중력 극대화와 진로 구체화"
                        </h3>
                        <p className="mb-2">고등학교 진학을 앞두고 중등 과정의 구멍을 메우고 고등 학습에 대비해야 하는 심리적 압박이 큰 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          아이가 지쳐할 때 "이 고비만 넘기면 고등학교 가서 훨씬 수월할 거야"라며 동기를 부여해 주십시오. 특목고, 일반고 등 고교 선택과 문/이과 성향에 대해 아이의 의견을 경청하며 진지하게 대화해 주십시오.
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Section 3 */}
                  <section className="mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 pb-2 border-b-2 border-amber-200">
                      3. 고등학교 학년별 가이드: 입시라는 마라톤, '전략'과 '절대적 지지'의 시기
                    </h2>
                    <p className="mb-6 font-medium">
                      고등학교 시기는 대학 입시라는 현실적인 목표를 향해 달리는 예민하고 고단한 시기입니다. 가정은 철저하게 에너지를 충전하는 '안전 기지'가 되어야 합니다.
                    </p>

                    <div className="space-y-8">
                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [고등학교 1학년] "첫 내신의 충격 극복과 고등 생태계 적응"
                        </h3>
                        <p className="mb-2">상대평가인 고교 내신에서 처음으로 자신의 등급을 확인하고 큰 충격과 좌절에 빠지기 쉬운 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          첫 중간고사 후 무너진 아이의 자존감을 붙잡아 주시는 것이 1순위입니다. "원래 첫 시험이 제일 적응하기 어렵대. 이제 올라갈 일만 남았네!"라며 대범하게 안심시켜 주십시오. 아울러 생기부 관리를 위해 밥상머리에서 최근 사회 이슈나 전공에 대한 가벼운 토론을 유도해 주시면 큰 도움이 됩니다.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [고등학교 2학년] "폭발하는 학습량, 번아웃 방지와 쉼표 제공"
                        </h3>
                        <p className="mb-2">수능 주요 과목의 핵심이 집중되어 있고, 수시/정시 방향성을 결정해야 하는 가장 벅찬 시기입니다. 슬럼프가 자주 옵니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          성적 압박은 밖에서도 차고 넘칩니다. 집에서는 "수고했어, 조금 쉬었다 해"라며 쉴 틈을 주십시오. 늦은 밤 야식을 챙겨주시고, 주말에는 한두 시간이라도 뇌를 쉴 수 있도록 좋아하는 음악을 듣거나 가벼운 산책을 권해 주며 체력을 관리해 주십시오.
                        </p>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-amber-700 mb-2 bg-amber-50 inline-block px-3 py-1 rounded-lg">
                          [고등학교 3학년] "실전 입시 돌입, 부모 불안 전이 금지와 완벽한 페이스메이커"
                        </h3>
                        <p className="mb-2">모의고사 성적 하나하나에 일희일비하며, 극도의 불안감과 싸우는 시기입니다.</p>
                        <p className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          <strong className="text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2 inline-block mb-1">가정에서의 역할:</strong>
                          가장 중요한 임무는 '부모의 불안을 아이에게 들키지 않는 것'입니다. 부모님이 불안해하면 아이는 두 배로 흔들립니다. "결과가 어떻든 넌 나의 가장 큰 자랑이야"라는 확신을 심어 주십시오. 수능 시간표에 맞춰 기상 시간과 식단을 조절하는 '건강 관리 매니저'가 되어 주십시오.
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Section 4 */}
                  <section className="mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 pb-2 border-b-2 border-amber-200">
                      4. 공부의 근본을 바꾸는 '문해력'과 '사고력' 기르기 (전 학년 공통)
                    </h2>
                    <p className="mb-6 font-medium">
                      단순한 문제 풀이 기술로는 고학년으로 갈수록 한계에 부딪힙니다. 글을 읽고 이해하는 근본적인 힘이 필요합니다.
                    </p>

                    <ul className="space-y-4 list-disc pl-5">
                      <li>
                        <strong className="text-amber-700">독서를 '숙제'가 아닌 '문화'로 만들기:</strong> 거실에서 부모님이 먼저 책이나 신문을 읽는 환경을 조성해 주십시오. 아이에게만 책을 읽으라고 하면 그것은 숙제가 되지만, 가족이 함께 읽으면 자연스러운 문화가 됩니다.
                      </li>
                      <li>
                        <strong className="text-amber-700">열린 질문으로 비판적 사고력 깨우기:</strong> 가족이 함께 뉴스를 보거나 영화를 본 뒤 "만약 너라면 어떻게 했을 것 같아?", "저 사람은 왜 그런 선택을 했을까?"라는 질문을 던져 주십시오. 이러한 일상적인 대화가 고난도 지문을 이해하고 논리적인 문제를 해결하는 든든한 사고력의 밑거름이 됩니다.
                      </li>
                      <li>
                        <strong className="text-amber-700">스스로 어휘의 뜻을 유추하고 찾는 습관 들이기:</strong> 문해력의 가장 튼튼한 뼈대는 어휘력입니다. 아이가 모르는 단어를 물어볼 때 곧바로 뜻을 알려주기보다, 문맥을 통해 먼저 유추해 보게 하고 스마트폰이나 사전으로 직접 찾아보게끔 유도해 주십시오. 이 작은 습관이 학년이 올라갈수록 마주하는 낯선 개념어들에 대한 두려움을 없애줍니다.
                      </li>
                    </ul>
                  </section>

                  {/* Section 5 */}
                  <section className="mt-12">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 pb-2 border-b-2 border-amber-200">
                      5. 효율적인 몰입을 위한 '환경' 세팅과 건강한 대화법 (전 학년 공통)
                    </h2>
                    <p className="mb-6 font-medium">
                      가정 환경과 부모님의 말 한마디가 아이의 집중력과 공부 정서를 결정합니다.
                    </p>

                    <ul className="space-y-4 list-disc pl-5">
                      <li>
                        <strong className="text-amber-700">디지털 디톡스 실천:</strong> 공부하는 시간만큼은 온 가족이 스마트폰을 보이지 않는 곳에 두는 규칙을 정해 보십시오. 시각적 자극을 차단하는 것만으로도 아이는 훨씬 쉽게 몰입 단계에 진입합니다.
                      </li>
                      <li>
                        <strong className="text-amber-700">수면과 영양 관리:</strong> 학년이 올라갈수록 무조건 밤을 새우기보다, 배운 것을 장기기억으로 저장할 수 있도록 질 좋은 수면을 취하는 것이 중요합니다. 아이의 생체 리듬을 세심하게 살펴 주십시오.
                      </li>
                      <li>
                        <strong className="text-amber-700">비교 대신 어제의 아이와 비교하기:</strong> "옆집 아이는 몇 점이라더라"는 말은 절대 금물입니다. "지난번보다 문제 푸는 속도가 훨씬 빨라졌네"처럼 어제의 아이와 오늘의 아이를 비교하며 구체적인 성장을 칭찬해 주십시오.
                      </li>
                    </ul>
                  </section>

                  {/* Outro */}
                  <div className="mt-16 bg-amber-50 p-8 rounded-2xl text-center border border-amber-100">
                    <p className="text-lg font-bold text-slate-800 mb-4">
                      하나의 씨앗이 거목으로 자라기 위해서는 <br className="hidden sm:block" />
                      좋은 흙(가정)과 적절한 양분(학원)이 완벽한 조화를 이루어야 합니다.
                    </p>
                    <p className="text-slate-700 mb-8">
                      이 가이드가 가정 내 훌륭한 멘토가 되기를 바라며, 저희 팁스는 단순한 지식 전달을 넘어 아이들의 미래를 함께 고민하는 든든한 동반자로 끝까지 함께 걷겠습니다.
                    </p>
                    <p className="font-bold text-slate-900 text-xl">
                      팁스 영어·수학학원 원장 드림
                    </p>
                  </div>

                </div>
              </div>

              {/* Footer CTA */}
              <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 z-10 flex justify-end">
                <button 
                  onClick={onClose}
                  className="py-4 px-8 rounded-2xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
