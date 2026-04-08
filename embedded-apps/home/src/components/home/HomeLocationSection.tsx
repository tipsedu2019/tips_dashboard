import { siteConfig } from '../../data/homeData';
import { MapPin, Navigation } from 'lucide-react';

export default function HomeLocationSection() {
  return (
    <section id="location" className="py-16 px-5 bg-slate-50 border-t border-slate-200 scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">강의실 위치</h2>
          <p className="text-slate-600 max-w-2xl mx-auto">
            수업시간표상 요일과 시간에 해당하는 강의실에서 수업이 진행됩니다. <br className="hidden md:block" />
            첫 수업일에는 안내데스크에서 안내해 드립니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* 본관 */}
          <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-col h-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-slate-700" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">{siteConfig.mainCampus.name}</h3>
            </div>
            
            <p className="text-slate-600 mb-8 flex-1">
              {siteConfig.mainCampus.address}
            </p>
            
            <a 
              href={siteConfig.mainCampus.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-slate-900 text-white font-medium py-3 px-4 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              본관 위치 보기
            </a>
          </div>

          {/* 별관 */}
          <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-col h-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-slate-700" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">{siteConfig.annexCampus.name}</h3>
            </div>
            
            <p className="text-slate-600 mb-8 flex-1">
              {siteConfig.annexCampus.address}
            </p>
            
            <a 
              href={siteConfig.annexCampus.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-slate-900 text-white font-medium py-3 px-4 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              별관 위치 보기
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
