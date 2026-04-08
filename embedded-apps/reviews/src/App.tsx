/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import Masonry from 'react-masonry-css';
import { generateItems, ItemType } from './data/reviews';
import { motion } from 'motion/react';
import { Search, Filter } from 'lucide-react';

const allItems = generateItems();
const ITEMS_PER_PAGE = 20;

const FILTERS = ['전체', '영어', '수학', '성적향상'];

export default function App() {
  const [items, setItems] = useState<ItemType[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('전체');

  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      if (item.type === 'highlight') {
        if (activeFilter === '전체' && !searchTerm) return true;
        const text = item.text.toLowerCase();
        const matchesSearch = !searchTerm || text.includes(searchTerm.toLowerCase());
        const matchesFilter = activeFilter === '전체' || text.includes(activeFilter.toLowerCase());
        return matchesSearch && matchesFilter;
      } else {
        const content = item.content.toLowerCase();
        const matchesSearch = !searchTerm || content.includes(searchTerm.toLowerCase()) || item.name.includes(searchTerm);
        let matchesFilter = true;
        if (activeFilter === '영어') matchesFilter = content.includes('영어');
        if (activeFilter === '수학') matchesFilter = content.includes('수학');
        if (activeFilter === '성적향상') matchesFilter = content.includes('점수') || content.includes('성적') || content.includes('등급') || content.includes('올랐') || content.includes('상승');
        return matchesSearch && matchesFilter;
      }
    });
  }, [searchTerm, activeFilter]);

  useEffect(() => {
    setPage(1);
    setItems(filteredItems.slice(0, ITEMS_PER_PAGE));
    setHasMore(filteredItems.length > ITEMS_PER_PAGE);
  }, [filteredItems]);

  const loadMore = () => {
    const nextItems = filteredItems.slice(0, (page + 1) * ITEMS_PER_PAGE);
    setItems(nextItems);
    if (nextItems.length >= filteredItems.length) {
      setHasMore(false);
    }
    setPage(p => p + 1);
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 200) {
        if (hasMore) {
          loadMore();
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasMore, page, filteredItems]);

  useEffect(() => {
    let scrollInterval: NodeJS.Timeout;
    let resumeTimeout: NodeJS.Timeout;
    let isScrolling = true;

    const startScroll = () => {
      if (!isScrolling) return;
      scrollInterval = setInterval(() => {
        window.scrollBy({ top: 0.5, left: 0, behavior: 'auto' });
      }, 40);
    };

    const pauseScroll = () => {
      clearInterval(scrollInterval);
      clearTimeout(resumeTimeout);
      resumeTimeout = setTimeout(() => {
        if (isScrolling) startScroll();
      }, 2000);
    };

    startScroll();

    window.addEventListener('wheel', pauseScroll);
    window.addEventListener('touchmove', pauseScroll);
    window.addEventListener('mousedown', pauseScroll);

    return () => {
      isScrolling = false;
      clearInterval(scrollInterval);
      clearTimeout(resumeTimeout);
      window.removeEventListener('wheel', pauseScroll);
      window.removeEventListener('touchmove', pauseScroll);
      window.removeEventListener('mousedown', pauseScroll);
    };
  }, []);

  const breakpointColumnsObj = {
    default: 4,
    1280: 3,
    1024: 2,
    640: 1
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-gray-800 font-sans selection:bg-orange-200">
      {/* Header */}
      <header className="pt-24 pb-12 px-6 text-center">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-[#4A3E3D]"
        >
          진심의 벽 <span className="text-orange-500 font-light ml-2">Wall of Trust</span>
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed mt-6"
        >
          팁스영어수학학원과 함께 성장한 111명의 생생한 이야기.<br className="hidden md:block" />
          학생과 학부모님이 직접 남겨주신 진심 어린 후기를 만나보세요.
        </motion.p>
      </header>

      {/* Search and Filter */}
      <section className="max-w-4xl mx-auto px-4 mb-12">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
          <div className="relative w-full md:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="키워드로 리뷰 검색 (예: 만점, 1등급)"
              className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 sm:text-sm transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-center w-full md:w-auto">
            {FILTERS.map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                  activeFilter === filter 
                    ? 'bg-orange-500 text-white shadow-md shadow-orange-200' 
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {filter === '전체' && <Filter className="w-4 h-4" />}
                {filter}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Masonry Grid */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {items.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-xl font-medium">검색 결과가 없습니다.</p>
            <p className="mt-2">다른 키워드로 검색해보세요.</p>
          </div>
        ) : (
          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="my-masonry-grid"
            columnClassName="my-masonry-grid_column"
          >
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (index % ITEMS_PER_PAGE) * 0.05 }}
              >
                {item.type === 'review' ? (
                  <ReviewCard item={item} />
                ) : (
                  <HighlightCard item={item} />
                )}
              </motion.div>
            ))}
          </Masonry>
        )}
        
        {hasMore && items.length > 0 && (
          <div className="text-center py-12">
            <div className="inline-block w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="text-center py-16 text-gray-500 font-medium">
            모든 리뷰를 불러왔습니다.
          </div>
        )}
      </main>
    </div>
  );
}

function HighlightedText({ content }: { content: string }) {
  const defaultKeywords = [
    '1등급', '100점', '만점', '30점 상승', '96점', '90점대', '2등급', '상위권', 
    '급상승', '최고', '강추', '적극 추천', '만족', '자신감', '성적이 쑥쑥', 
    '실력이 많이 늘', '실력향상', '성적향상', '성적이 오르', '점수가 오르', 
    '점수 오른', '성적이 계속 오르고', '성적이 많이 올랐', '성적 향상', '눈에 띄게',
    '확실한 시험대비', '꼼꼼한', '철저하게', '이해하기 쉽게', '맞춤형', '열정적',
    '친절하시고', '잘 가르쳐주십니다', '아낌없는 칭찬', '성적도 많이 올랐어요',
    '모의고사 1등급', '영어실력은 점점 늘어가고', '수학실력이 많이 는 거 같아요',
    '열정이 넘치시고', '체계적인 수업', '확실한 성적 관리', '편안한 사제관계',
    '성적 향상', '꼼꼼히 봐주십니다', '맞춤식', '단점을 보강', '수학 내신 대비',
    '성적이 쑥쑥 쑥', '맞춤형 수업', '시설도 좋고', '수학 1등급', '꼼꼼한 문제풀이',
    '철저한 내신관리', '수업의 질도 좋고', '영어 공부에 흥미', '문법이 체계적',
    '세심하게 지도', '만족도도 커서', '기초부터 차근차근', '수능 대비', '성적도 같이 올라간',
    '이해하는 것에 중점', '가족 같은 분위기', '완벽 대비', '단어테스트', '유종의 미',
    '주간테스트', '기초를 탄탄하게', '올바른 마음', '자율적이지만 체계적인', '정성으로 가르치세요',
    '성적 향상은 되는 것 같아요', '실력 있는 선생님들', '성적이 잘 나온다', '선생님과 관계가 좋다',
    '믿고 보내고 있습니다', '성적을 올려주면서', '질의응답', '정착해', '깔끔하며', '교통이 편하고',
    '학생 복지도 좋은', '자습할 수 있는 공간', '후회하지 않을 것', '즐겁고 기대가', '찰떡같이 잘하세요',
    '반복 학습', '눈높이에 맞춰서', '믿고 맡길 수 있는', '실력향상에 크게 도움', '부족한 부분 없이',
    '자습실이 따로 잘 되어있어서', '깨끗하고 편리해서', '집중할 수 있는 분위기', '따듯한 분위기',
    '꼼꼼한 설명', '탄탄한 수업', '최선을 다하는 모습', '점수가 오르는게 보여서', '오답을 바로 할수 있어',
    '케어와 끝까지 노력', '질문도 열정적으로', '세세하게 분석', '쾌거를 이루었습니다', '좋은 선생님들',
    '퀄리티 너무 좋은 수업', '쾌적한 학습환경', '가족 같은 분위기', '성적우수자', '안정적이고 행복하게',
    '흥미를 가지고', '체계적인 관리', '질 높은 수업', '등급 반등', '완벽하게 이해', '다양한 자료',
    '직전보강', '유종의 미', '적극 추천', '친절하신데', '감동받았습니다', '새로운 문제들을 배울 수 있어서',
    '내신대비도 항상 너무 잘해줘서', '우수한 실력', '학생 맞춤지도', '새로운 자료', '큰 도움',
    '단어가 정말 많이 늘었어요', '정말로 학생을 아끼고', '소외되지 않고', '주기적인 테스트와 클리닉',
    '적중률이 매우 높아', '무한한 지지와 응원', '내신준비를 꼼꼼하게', '소통을 잘합니다', '쑥쑥 오르는 게',
    '자신감을 가진 것', '많은 도움이 됐습니다', '1등급 받을 수 있었습니다', '발전했다고 할 만한 것들',
    '성향과 습성을 파악', '최대 향상', '자신 있는 과목', '흔들림 없이', '최선을 다해 지도',
    '경쟁력이 있는 학생', '안정적으로 높은 등급', '공부분위기 시설 전부 다 맘에 든다고', '평균 이상이 된 것',
    '선행학습과 학교진도', '정서적으로 불안하지 않고', '분위기가 참 좋다고', '응용, 심화까지 이해가 잘 갈 수 있게',
    '경험이 쌓이고', '스킬들도 많이 알려주셔서', '자부심이 대단하여', '자유로운 학습분위기', '배경지식을 끌어와서',
    '동기부여가 될 수 있도록', '진심 어린 조언', '방향을 설정하는데 많은 도움', '정확하게 친절히',
    '피드백해주십니다', '성적이 급상승할 정도로', '부담감이나 압박감이 생기곤', '편안한 마음으로',
    '만족도가 높은 것', '가격도 착한 것', '개념도 확실하게 잡히고', '스스로도 많이 성장',
    '면학 분위기가 잘 조성', '개선 사항도 문의할 수 있어서', '균형 있게 가르치시고요', '학원비가 아깝지 않은',
    '적응을 잘하고', '중요한 내용만 딱딱 잡아서', '화목해 보여서', '스스로 해요', '학업 성취도도 너무 좋네요',
    '질문하기에 편안한 분위기', '소수정예방식', '합리적인 가격', '접근성이 좋아', '보충수업 해주는 걸',
    '자신감도 많이 붙었어요', '섬세히 알게 되었습니다', '술술 풀 수 있게', '지속적으로 살피며'
  ];
  
  let activeKeywords = [...defaultKeywords];
  
  const hasDefault = activeKeywords.some(kw => content.includes(kw));
  
  if (!hasDefault) {
    const fallbackMatch = content.match(/([가-힣a-zA-Z]*(좋|감사|최고|도움|올라|늘|재밌|친절|꼼꼼|열정|완벽|추천|만족|성장|이해|잘|쉽게|향상|상승|확실|탄탄|쾌적|행복|유익|훌륭|따뜻|다정|성실)[가-힣a-zA-Z]*)/g);
    if (fallbackMatch && fallbackMatch.length > 0) {
      activeKeywords.push(...fallbackMatch);
    } else {
      const words = content.split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) activeKeywords.push(words[0].replace(/[.,!?]/g, ''));
    }
  }
  
  const sortedKeywords = activeKeywords.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sortedKeywords.join('|')})`, 'g');
  const parts = content.split(pattern);
  
  return (
    <>
      {parts.map((part, i) => {
        if (sortedKeywords.includes(part)) {
          return (
            <span key={i} className="bg-orange-100 text-orange-800 font-bold px-1 rounded">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function ReviewCard({ item }: { item: any }) {
  return (
    <div className="bg-white rounded-3xl p-7 shadow-sm border border-[#F0EBE1] hover:shadow-md transition-shadow duration-300">
      <div className="flex items-center gap-4 mb-5">
        <div className="w-14 h-14 rounded-full bg-orange-50 overflow-hidden border-2 border-orange-100 flex-shrink-0">
          <img 
            src={item.avatarUrl} 
            alt="avatar" 
            className="w-full h-full object-cover" 
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
        <div>
          <div className="font-bold text-gray-900 text-lg flex items-center gap-2">
            {item.name}
            <span className="text-xs font-normal bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
              {item.identifier}
            </span>
          </div>
          <div className="text-sm text-orange-500 font-medium mt-0.5">{item.role}</div>
        </div>
      </div>
      <p className="text-gray-700 leading-relaxed text-[15px] whitespace-pre-line break-keep">
        <HighlightedText content={item.content} />
      </p>
    </div>
  );
}

function HighlightCard({ item }: { item: any }) {
  return (
    <motion.div 
      whileHover={{ scale: 1.05, y: -5 }}
      className="bg-gradient-to-br from-orange-400 to-orange-500 rounded-3xl p-8 shadow-lg text-white flex items-center justify-center min-h-[240px] cursor-pointer"
    >
      <h3 className="text-3xl lg:text-4xl font-bold text-center leading-tight break-keep drop-shadow-sm">
        "{item.text}"
      </h3>
    </motion.div>
  );
}
