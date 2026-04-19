import React from 'react';
import { LayoutDashboard, Radio, MessageSquare, Users, Settings } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Layout({ children, activeTab, setActiveTab }: LayoutProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'scans', label: 'Scans', icon: Radio },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'agents', label: 'Agents', icon: Users },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-[#0A0A0B] text-gray-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-16 md:w-56 h-full flex flex-col border-r border-gray-800/60 bg-[#0F1012] z-20 flex-shrink-0 transition-all duration-300">
        <div className="p-4 flex flex-col items-center md:items-start gap-1 py-6 border-b border-gray-800/60 h-20">
          <div className="flex items-center gap-3 w-full">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center flex-shrink-0 border border-emerald-500/20">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="hidden md:flex flex-col">
              <span className="font-semibold text-white tracking-wide text-sm">VibeCheck</span>
              <span className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">SECURITY</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-6 px-2 md:px-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group text-sm",
                activeTab === item.id
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 flex-shrink-0",
                activeTab === item.id ? "text-emerald-400" : "text-gray-500 group-hover:text-gray-300"
              )} />
              <span className="hidden md:block font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        
        <div className="p-4 border-t border-gray-800/60 mt-auto">
           <button className="w-full h-10 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-md flex items-center justify-center gap-2 transition-colors">
              <span className="hidden md:block font-mono text-xs tracking-wider">+ New Scan</span>
              <span className="block md:hidden">+</span>
           </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
        {/* Subtle Background Glow */}
        <div className="absolute top-0 right-0 w-[600px] h-[400px] bg-emerald-900/5 blur-[100px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        {children}
      </main>
    </div>
  );
}

// Simple fallback for Shield icon if not passed in context
function Shield(props: any) {
  return (
     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
    </svg>
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
