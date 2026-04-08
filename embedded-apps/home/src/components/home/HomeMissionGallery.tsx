import { motion } from 'motion/react';

export default function HomeMissionGallery() {
  const images = [
    {
      src: "https://ais-dev-22wajbazs3i7jm5msqnlri-167596384691.asia-northeast1.run.app/attachments/76508933-9092-4115-9988-164749363071",
      alt: "꿈은 높이 두고 노력은 끝까지 하라",
      caption: "꿈은 높이 두고 노력은 끝까지 하라"
    },
    {
      src: "https://ais-dev-22wajbazs3i7jm5msqnlri-167596384691.asia-northeast1.run.app/attachments/94060851-0941-4775-817c-2b216966144e",
      alt: "TIPS MISSION",
      caption: "TIPS MISSION: We help students set high goals..."
    },
    {
      src: "https://ais-dev-22wajbazs3i7jm5msqnlri-167596384691.asia-northeast1.run.app/attachments/86c671a5-812e-4367-9388-132d78904576",
      alt: "우리는 학생들이...",
      caption: "우리는 학생들이 꿈을 높이 두고 끝까지 노력하는 과정에서 배우고 성장하여..."
    }
  ];

  return (
    <section className="py-24 px-6 bg-[#F5F5F7]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 tracking-tight">
            팁스의 철학이 담긴 공간
          </h2>
          <p className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto font-medium tracking-tight">
            학생들이 매일 마주하는 문구 하나하나에 팁스의 진심을 담았습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {images.map((image, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="group relative bg-white rounded-[2.5rem] overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-all duration-500"
            >
              <div className="aspect-square overflow-hidden">
                <img 
                  src={image.src} 
                  alt={image.alt} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="p-8">
                <p className="text-slate-600 text-base md:text-lg font-medium leading-relaxed break-keep">
                  {image.caption}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
