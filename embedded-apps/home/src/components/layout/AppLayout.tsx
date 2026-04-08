import { Home, Star, BookOpen, Trophy, MessageCircle, Search, Moon, Lightbulb } from 'lucide-react';
import { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Main Content Area */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <button className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-colors ${active ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
      <div className="mb-1">{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
