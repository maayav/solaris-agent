import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Shield, LayoutDashboard, GitBranch, MessageSquare, Network, Info } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { NavBar } from '@/shared/components/layout/NavBar';
import { Button } from '@/shared/components/ui';

const navItems = [
  { name: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { name: 'Pipeline', url: '/pipeline', icon: GitBranch },
  { name: 'Team Chat', url: '/chat', icon: MessageSquare },
  { name: 'Swarm', url: '/swarm', icon: Network },
  { name: 'About', url: '/', icon: Info },
];

const pathToTab: Record<string, string> = {
  '/': 'About',
  '/dashboard': 'Dashboard',
  '/pipeline': 'Pipeline',
  '/chat': 'Team Chat',
  '/swarm': 'Swarm',
};

const tabToPath: Record<string, string> = {
  'Dashboard': '/dashboard',
  'Pipeline': '/pipeline',
  'Team Chat': '/chat',
  'Swarm': '/swarm',
  'About': '/',
};

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = pathToTab[location.pathname] || '';
  const isSwarm = location.pathname === '/swarm';
  const isChat = location.pathname === '/chat';

  const handleTabChange = (name: string) => {
    const path = tabToPath[name] ?? '/';
    navigate(path);
  };

  // Don't show navbar on Swarm page
  if (isSwarm) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden relative selection:bg-emerald-500/30">
      {/* Background */}
      <div className="fixed inset-0 z-0 overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-[#0a0f1c] to-black" />
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/poster.webp"
          className="absolute inset-0 w-full h-full object-cover scale-[1.05] -translate-y-[2%] will-change-transform"
          style={{ objectPosition: 'center 10%' }}
          onError={(e) => {
            (e.target as HTMLVideoElement).style.display = 'none';
          }}
        >
          <source src="/background.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/50 to-black/80" />
        <div className="absolute inset-0 bg-gradient-radial from-emerald-900/30 to-transparent via-transparent blur-xl" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#050505] to-transparent" />
      </div>

      {/* Navigation */}
      <nav className={cn(
        "relative z-10 flex items-center w-full px-6 h-16",
        isChat
          ? "bg-[#0d0d12] border-b border-white/[0.06]"
          : "bg-[rgba(12,12,14,0.85)] backdrop-blur-xl border-b border-white/[0.06]"
      )} role="navigation" aria-label="Main navigation">
        {/* Logo */}
        <div className="absolute left-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-xl font-bold tracking-tighter hover:scale-[1.04] active:scale-[0.97] transition-transform"
            aria-label="VibeCheck — Go to home page"
          >
            <Shield className="w-6 h-6 text-white" />
            <span className="hidden sm:inline-block text-[#e8e8f0]">VibeCheck</span>
          </button>
        </div>

        {/* Center Navigation */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <NavBar
            items={navItems}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-6 text-sm font-medium ml-auto">
          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 text-gray-300 hover:text-white transition-colors" 
            aria-label="View on GitHub"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <Button
            onClick={() => navigate('/pipeline')}
            aria-label="Start a security scan"
          >
            Start Scanning
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10">
        <Outlet />
      </main>
    </div>
  );
}
