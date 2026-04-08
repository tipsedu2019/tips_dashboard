import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, X, Loader2, UploadCloud } from 'lucide-react';

const DATA_CSV_URL = `${import.meta.env.BASE_URL}data.csv`;

// CSV 파서
const parseCSV = (text: string) => {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  const getIndex = (possibleNames: string[]) => {
    return headers.findIndex(h => possibleNames.some(name => h.includes(name)));
  };

  const idxYear = getIndex(['년도', 'Year']);
  const idxExam = getIndex(['시험', 'Exam']);
  const idxSchool = getIndex(['학교', 'School']);
  const idxGrade = getIndex(['학년', 'Grade']);
  const idxName = getIndex(['이름', 'Name']);
  const idxSubject = getIndex(['과목', 'Subject']);
  const idxScore = getIndex(['점수', 'Score']);
  const idxRating = getIndex(['등급', 'Rating']);
  const idxRank = getIndex(['등수', '석차', 'Rank']);

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    let row = [];
    let cur = '';
    let inQuote = false;
    for (let char of lines[i]) {
      if (char === '"') inQuote = !inQuote;
      else if (char === ',' && !inQuote) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    row.push(cur.trim());

    const rawName = idxName >= 0 ? row[idxName]?.replace(/^"|"$/g, '') : '';
    const maskedName = rawName.length > 2 
      ? rawName[0] + 'ㅇ'.repeat(rawName.length - 2) + rawName[rawName.length - 1]
      : rawName.length === 2 
        ? rawName[0] + 'ㅇ' 
        : rawName;

    const rawRank = idxRank >= 0 ? row[idxRank]?.replace(/^"|"$/g, '') : '';
    const formattedRank = rawRank.replace(/\s+/g, '');

    const record = {
      id: i,
      year: idxYear >= 0 ? row[idxYear]?.replace(/^"|"$/g, '') : '',
      exam: idxExam >= 0 ? row[idxExam]?.replace(/^"|"$/g, '') : '',
      school: idxSchool >= 0 ? row[idxSchool]?.replace(/^"|"$/g, '') : '',
      grade: idxGrade >= 0 ? row[idxGrade]?.replace(/^"|"$/g, '') : '',
      name: rawName,
      maskedName: maskedName,
      subject: idxSubject >= 0 ? row[idxSubject]?.replace(/^"|"$/g, '') : '',
      score: idxScore >= 0 ? row[idxScore]?.replace(/^"|"$/g, '') : '',
      gradeRating: idxRating >= 0 ? row[idxRating]?.replace(/^"|"$/g, '') : '',
      rank: formattedRank,
    };
    
    if (record.school && record.name) {
      data.push(record);
    }
  }
  return data;
};

// 개별 성적 카드 컴포넌트
const CompactCard: React.FC<{ record: any, index: number }> = ({ record, index }) => {
  const [isPressed, setIsPressed] = useState(false);

  const isSpecial = record.gradeRating === '1등급' || record.score === '100' || (record.rank && record.rank.includes('전교'));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ 
        delay: Math.min(index * 0.05, 1.5),
        duration: 0.4, 
        ease: "easeOut" 
      }}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerLeave={() => setIsPressed(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`backdrop-blur-md border rounded-xl md:rounded-2xl p-2.5 md:p-4 mb-2.5 md:mb-4 flex flex-col gap-1.5 md:gap-2 shadow-[0_4px_12px_rgba(0,0,0,0.2)] relative overflow-visible group will-change-transform cursor-pointer select-none ${
        isSpecial 
          ? 'bg-gradient-to-br from-[#D4AF37]/30 via-[#D4AF37]/10 to-white/[0.05] border-[#D4AF37]/60 shadow-[0_0_20px_rgba(212,175,55,0.4)] scale-[1.02]' 
          : 'bg-white/[0.03] border-white/10'
      }`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-xl md:rounded-2xl pointer-events-none">
        <div className={`absolute -top-10 -right-10 w-20 h-20 md:w-32 md:h-32 rounded-full blur-xl transition-colors ${
          isSpecial ? 'bg-[#D4AF37]/40 group-hover:bg-[#D4AF37]/50' : 'bg-[#D4AF37]/10 group-hover:bg-[#D4AF37]/20'
        }`} />
        {isSpecial && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
        )}
      </div>

      <AnimatePresence>
        {isPressed && (record.year || record.exam) && (
          <motion.div 
            initial={{ opacity: 0, y: 5, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute -top-8 md:-top-10 left-1/2 -translate-x-1/2 bg-[#D4AF37] text-[#0B132B] text-[11px] md:text-xs font-bold px-2.5 py-1 md:px-3 md:py-1.5 rounded-md shadow-lg z-50 whitespace-nowrap pointer-events-none"
          >
            {record.year} {record.exam}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#D4AF37]" />
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="flex justify-between items-start relative z-10 mb-0.5 gap-2">
        <div className="text-[10px] md:text-xs text-[#F3E5AB] font-medium tracking-wide truncate">
          {record.school} {record.grade}
        </div>
        <div className="flex gap-1 shrink-0">
          {record.rank && (
            <span className="text-[9px] md:text-[11px] font-bold text-[#0B132B] bg-[#D4AF37] px-1 md:px-1.5 md:py-0.5 rounded-sm">{record.rank}</span>
          )}
        </div>
      </div>
      
      <div className="flex justify-between items-center relative z-10">
        <span className="text-sm md:text-lg font-bold text-white truncate max-w-[50%]">{record.maskedName || record.name}</span>
        <span className="text-sm md:text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#D4AF37] to-[#F3E5AB] tabular-nums drop-shadow-sm">
          {record.score}
        </span>
      </div>
      
      <div className="flex justify-between items-center relative z-10">
        <span className="text-[10px] md:text-xs text-gray-400">{record.subject}</span>
        {record.gradeRating && (
          <span className={`text-[10px] md:text-xs font-bold px-1 md:px-1.5 md:py-0.5 rounded-sm ${
            record.gradeRating === '1등급'
              ? 'text-[#0B132B] bg-[#D4AF37]'
              : 'text-red-400/90 bg-red-400/10'
          }`}>
            {record.gradeRating}
          </span>
        )}
      </div>
    </motion.div>
  );
};

// 무한 스크롤 컬럼 컴포넌트
const Column: React.FC<{ data: any[], direction: 'up'|'down', speed: 'slow'|'medium'|'fast' }> = ({ data, direction, speed }) => {
  let displayData = [...data];
  if (displayData.length === 0) return null;
  
  while (displayData.length < 30) {
    displayData = [...displayData, ...data];
  }
  const duplicatedData = [...displayData, ...displayData];
  
  const animationClasses = {
    up: {
      slow: 'animate-scroll-up-slow',
      medium: 'animate-scroll-up-medium',
      fast: 'animate-scroll-up-fast'
    },
    down: {
      slow: 'animate-scroll-down-slow',
      medium: 'animate-scroll-down-medium',
      fast: 'animate-scroll-down-fast'
    }
  };
  
  const animationClass = animationClasses[direction][speed];

  return (
    <div className="flex-1 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full flex flex-col ${animationClass} will-change-transform group-active:[animation-play-state:paused] md:hover:[animation-play-state:paused]`}>
        {duplicatedData.map((record, idx) => (
          <CompactCard key={`${record.id}-${idx}`} record={record} index={idx} />
        ))}
      </div>
    </div>
  );
};

// 검색 모달 컴포넌트
const SearchModal = ({ 
  onClose, 
  allRecords,
  selectedSchool,
  onSelectSchool 
}: { 
  onClose: () => void, 
  allRecords: any[],
  selectedSchool: string | null,
  onSelectSchool: (school: string | null) => void
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const { highSchools, middleSchools } = useMemo(() => {
    const uniqueSchools = Array.from(new Set(allRecords.map(r => r.school))).sort();
    return {
      // 고등학교 필터링 로직 수정: '고' 또는 '여상'으로 끝나는 학교
      highSchools: uniqueSchools.filter(s => s.endsWith('고') || s.endsWith('여상')),
      // 중학교 필터링 로직 수정: '중'으로 끝나는 학교
      middleSchools: uniqueSchools.filter(s => s.endsWith('중'))
    };
  }, [allRecords]);
  
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return allRecords.filter(r => 
      r.name.includes(searchTerm) || r.school.includes(searchTerm)
    ).slice(0, 50);
  }, [searchTerm, allRecords]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute inset-0 z-50 bg-[#0B132B]/95 backdrop-blur-xl flex flex-col"
    >
      <div className="p-6 pt-12 flex items-center gap-4 border-b border-white/10">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="학교명 또는 이름 검색..." 
            className="w-full bg-white/5 border border-white/10 rounded-full py-3.5 pl-12 pr-4 text-white placeholder:text-gray-500 focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all"
            autoFocus
          />
        </div>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-white transition-colors">
          <X className="w-7 h-7" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 flex flex-col">
        {searchTerm.trim() ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-gray-400 mb-2">검색 결과 ({searchResults.length}{searchResults.length === 50 ? '+' : ''})</h3>
            {searchResults.length > 0 ? (
              searchResults.map((record, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 flex justify-between items-center"
                >
                  <div>
                    <div className="text-xs text-[#F3E5AB] mb-1 flex items-center gap-1">
                      {record.school} {record.grade}
                      {record.rank && <span className="text-[9px] font-bold text-[#0B132B] bg-[#D4AF37] px-1 rounded-sm">{record.rank}</span>}
                    </div>
                    <div className="text-base font-bold text-white">{record.maskedName || record.name}</div>
                    <div className="text-[10px] text-gray-400 mt-1">{record.year} {record.exam}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-extrabold text-[#D4AF37]">{record.score}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {record.subject}
                      {record.gradeRating && (
                        <span className={`ml-1 px-1 rounded-sm ${
                          record.gradeRating === '1등급'
                            ? 'text-[#0B132B] bg-[#D4AF37] font-bold'
                            : 'text-red-400/90 bg-red-400/10 font-bold'
                        }`}>
                          {record.gradeRating}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-10">검색 결과가 없습니다.</div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-10">
            {/* 고등학교 섹션 */}
            {highSchools.length > 0 && (
              <div className="flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium text-gray-400">고등학교</h3>
                  {selectedSchool && highSchools.includes(selectedSchool) && (
                    <button 
                      onClick={() => onSelectSchool(null)}
                      className="text-xs text-[#D4AF37] hover:underline"
                    >
                      전체 보기
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {highSchools.map(school => (
                    <button
                      key={school}
                      onClick={() => onSelectSchool(school)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        selectedSchool === school 
                          ? 'bg-[#D4AF37] text-[#0B132B]' 
                          : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
                      }`}
                    >
                      {school}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 중학교 섹션 */}
            {middleSchools.length > 0 && (
              <div className="flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium text-gray-400">중학교</h3>
                  {selectedSchool && middleSchools.includes(selectedSchool) && (
                    <button 
                      onClick={() => onSelectSchool(null)}
                      className="text-xs text-[#D4AF37] hover:underline"
                    >
                      전체 보기
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {middleSchools.map(school => (
                    <button
                      key={school}
                      onClick={() => onSelectSchool(school)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        selectedSchool === school 
                          ? 'bg-[#D4AF37] text-[#0B132B]' 
                          : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
                      }`}
                    >
                      {school}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// 메인 앱 컴포넌트
export default function App() {
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [displayRecords, setDisplayRecords] = useState<any[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columnCount, setColumnCount] = useState(3);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1280) {
        setColumnCount(9);
      } else if (window.innerWidth >= 1024) {
        setColumnCount(7);
      } else if (window.innerWidth >= 768) {
        setColumnCount(5);
      } else {
        setColumnCount(3);
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch(DATA_CSV_URL);
        if (!response.ok) throw new Error('데이터 파일을 찾을 수 없습니다.');
        
        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        
        if (parsedData.length === 0) {
          throw new Error('데이터가 비어있습니다.');
        }
        
        setAllRecords(parsedData);
        // 랜덤하게 섞어서 최대 150개 표시
        const shuffled = [...parsedData].sort(() => 0.5 - Math.random());
        setDisplayRecords(shuffled.slice(0, 150));
      } catch (err) {
        console.error(err);
        setError('실제 성적 데이터(data.csv)가 필요합니다.');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);

  const handleSelectSchool = (school: string | null) => {
    setSelectedSchool(school);
    setIsSearchOpen(false);
    
    if (school) {
      setIsLoading(true);
      setTimeout(() => {
        const filtered = allRecords.filter(r => r.school === school);
        setDisplayRecords(filtered.slice(0, 150));
        setIsLoading(false);
      }, 400);
    } else {
      setIsLoading(true);
      setTimeout(() => {
        const shuffled = [...allRecords].sort(() => 0.5 - Math.random());
        setDisplayRecords(shuffled.slice(0, 150));
        setIsLoading(false);
      }, 400);
    }
  };

  const schoolRecordCount = selectedSchool 
    ? allRecords.filter(r => r.school === selectedSchool).length 
    : allRecords.length;

  const columns = Array.from({ length: columnCount }, () => [] as any[]);
  displayRecords.forEach((record, i) => {
    columns[i % columnCount].push(record);
  });

  if (error) {
    return (
      <div className="w-full h-screen bg-[#0B132B] flex flex-col items-center justify-center p-6 text-center">
        <UploadCloud className="w-16 h-16 text-[#D4AF37] mb-4 opacity-80" />
        <h2 className="text-xl font-bold text-white mb-2">데이터 파일이 필요합니다</h2>
        <p className="text-gray-400 text-sm mb-6 max-w-xs">
          좌측 파일 탐색기에서 <strong className="text-[#F3E5AB]">public</strong> 폴더에 <strong className="text-[#F3E5AB]">data.csv</strong> 파일을 업로드해주세요.
        </p>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-left text-xs text-gray-400 w-full max-w-sm">
          <p className="font-bold text-white mb-2">CSV 양식 예시:</p>
          <code className="block bg-black/30 p-2 rounded">
            년도,시험,학교,학년,이름,과목,점수,등급,등수<br/>
            2024,1학기 기말,중앙여고,고2,김O진,수학,100,1등급,전교 1등
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-[#0B132B] overflow-hidden font-sans flex justify-center">
      <div className="relative w-full md:max-w-full max-w-md h-full flex flex-col shadow-2xl bg-[#0B132B]">
        
        <header className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-[#0B132B] via-[#0B132B]/90 to-transparent pt-12 pb-10 px-6 flex flex-col items-center pointer-events-none">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 mb-3"
          >
            <Trophy className="w-4 h-4 text-[#D4AF37]" />
            <h1 className="text-sm font-bold text-white tracking-widest opacity-90">팁스영어수학학원</h1>
            <Trophy className="w-4 h-4 text-[#D4AF37]" />
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center"
          >
            <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#D4AF37] via-[#F3E5AB] to-[#D4AF37] drop-shadow-lg tracking-tight mb-3 flex items-baseline justify-center gap-2">
              명예의 벽 <span className="text-3xl font-light tracking-normal">Wall of Fame</span>
            </h2>
            <div className="px-5 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20 shadow-[0_0_15px_rgba(212,175,55,0.2)] pointer-events-auto flex items-center gap-2">
              <span className="text-sm font-medium text-white tracking-wide">
                {selectedSchool ? `${selectedSchool} 성적 신화` : '누적 성적 신화'}
              </span>
              <strong className="text-[#F3E5AB] text-base">
                {schoolRecordCount.toLocaleString()}+
              </strong>
            </div>
          </motion.div>
        </header>

        <div className="flex-1 relative overflow-hidden flex gap-2 px-2 pt-48 pb-10 group">
           <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-[#0B132B] via-[#0B132B]/80 to-transparent z-10 pointer-events-none" />
           <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0B132B] via-[#0B132B]/80 to-transparent z-10 pointer-events-none" />

           {isLoading ? (
             <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B132B]/50 backdrop-blur-sm">
               <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin mb-4" />
               <p className="text-[#F3E5AB] text-sm font-medium animate-pulse">데이터를 불러오는 중...</p>
             </div>
           ) : (
             <AnimatePresence mode="wait">
               <motion.div 
                 key={selectedSchool || 'all'} 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="absolute inset-0 flex gap-2 md:gap-4 px-2 md:px-4 pt-48 pb-10"
               >
                 {columns.map((colData, idx) => (
                   <Column 
                     key={idx} 
                     data={colData} 
                     direction={idx % 2 === 0 ? 'up' : 'down'} 
                     speed={idx % 3 === 0 ? 'slow' : idx % 3 === 1 ? 'medium' : 'fast'} 
                   />
                 ))}
               </motion.div>
             </AnimatePresence>
           )}
        </div>

        <button 
          onClick={() => setIsSearchOpen(true)}
          className="absolute bottom-8 right-6 z-30 w-14 h-14 bg-gradient-to-tr from-[#D4AF37] to-[#F3E5AB] rounded-full shadow-[0_0_20px_rgba(212,175,55,0.4)] flex items-center justify-center text-[#0B132B] hover:scale-105 transition-transform"
        >
          <Search className="w-6 h-6" />
        </button>

        <AnimatePresence>
          {isSearchOpen && (
            <SearchModal 
              onClose={() => setIsSearchOpen(false)} 
              allRecords={allRecords}
              selectedSchool={selectedSchool}
              onSelectSchool={handleSelectSchool}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
