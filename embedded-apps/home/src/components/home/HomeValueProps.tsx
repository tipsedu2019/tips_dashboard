import { motion } from 'motion/react';
import { Target, Brain, LineChart, Users } from 'lucide-react';

export default function HomeValueProps() {
  const values = [
    {
      icon: <Target className="w-6 h-6 text-amber-500" />,
      title: "목표 중심 학습",
      desc: "무작정 많이 하는 공부보다, 지금 무엇이 필요한지 분명히 알고 집중하는 공부를 지향합니다."
    },
    {
      icon: <Brain className="w-6 h-6 text-amber-500" />,
      title: "주도적 사고 훈련",
      desc: "정답만 맞히는 것을 넘어, 왜 그렇게 되는지 스스로 이해하고 설명할 수 있는 힘을 기릅니다."
    },
    {
      icon: <LineChart className="w-6 h-6 text-amber-500" />,
      title: "맞춤형 피드백",
      desc: "학생의 현재 수준과 성향, 학습 속도를 함께 보고 가장 효과적인 방법으로 지도합니다."
    },
    {
      icon: <Users className="w-6 h-6 text-amber-500" />,
      title: "학부모와의 투명한 소통",
      desc: "가정과 학원이 한 방향으로 갈 수 있도록 학습 상태와 필요한 보완점을 꾸준히 공유합니다."
    }
  ];

  return (
    <section className="py-24 px-6 bg-[#F5F5F7]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 tracking-tight">팁스가 지향하는 교육</h2>
          <p className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto font-medium tracking-tight">
            성적은 결과입니다. 팁스는 결과를 만들 수 있는 과정과 태도까지 함께 지도합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {values.map((item, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="group flex flex-col sm:flex-row gap-6 p-8 rounded-[2rem] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-500"
            >
              <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                {item.icon}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">{item.title}</h3>
                <p className="text-slate-500 text-base leading-relaxed font-medium">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
