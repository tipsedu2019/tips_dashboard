import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import honorsData from '../data/honors.json';

interface Honor {
  year: string;
  term: string;
  school: string;
  grade: string;
  name: string;
  subject: string;
  teacher: string;
  score: number;
  rank: string;
  grade_level: string;
}

const HallOfFame: React.FC = () => {
  const [honors, setHonors] = useState<Honor[]>([]);

  useEffect(() => {
    // 3,804건의 데이터를 시뮬레이션하기 위해 데이터를 복제합니다.
    const expandedData = Array(400).fill(honorsData).flat();
    setHonors(expandedData);
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5DC] p-8 font-sans">
      <header className="text-center mb-12">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">명예의 전당</h1>
        <p className="text-xl text-gray-600">팁스영어수학학원 6년간의 압도적인 성적 데이터</p>
      </header>

      <div className="overflow-hidden h-[600px] relative">
        <motion.div
          animate={{ y: [-500, -2000] }}
          transition={{ repeat: Infinity, duration: 50, ease: "linear" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {honors.map((honor, index) => (
            <div key={index} className="bg-white p-6 rounded-2xl shadow-lg border-b-4 border-[#D4AF37]">
              <div className="flex justify-between items-start mb-4">
                <span className="text-lg font-bold text-[#D4AF37]">{honor.school}</span>
                <span className="text-2xl font-black text-gray-900">{honor.score}점</span>
              </div>
              <h2 className="text-xl font-bold mb-2">{honor.name} ({honor.grade})</h2>
              <p className="text-gray-600">{honor.subject} | {honor.teacher} 선생님</p>
              {honor.rank && (
                <div className="mt-4 inline-block bg-[#D4AF37] text-white px-3 py-1 rounded-full font-bold">
                  {honor.rank}
                </div>
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default HallOfFame;
