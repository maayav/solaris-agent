import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Shield, Github, MessageSquare, GitBranch, Network, LayoutDashboard, Info } from 'lucide-react';
import { cn } from './lib/utils';
import { NavBar } from './components/ui/tubelight-navbar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MagneticButton } from './components/ui/magnetic-button';

const Landing = lazy(() => import('./Landing').then(m => ({ default: m.Landing })));
const Dashboard = lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const TeamChat = lazy(() => import('./pages/TeamChat').then(m => ({ default: m.TeamChat })));
const Pipeline = lazy(() => import('./pages/Pipeline').then(m => ({ default: m.Pipeline })));
const Swarm = lazy(() => import('./pages/Swarm').then(m => ({ default: m.Swarm })));

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

function PageSkeleton() {
  return (
    <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        <p className="text-sm text-gray-500 font-medium tracking-wide">Loading...</p>
      </div>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = pathToTab[location.pathname] || '';
  const isSwarm = location.pathname === '/swarm';

  const handleTabChange = (name: string) => {
    const path = tabToPath[name] ?? '/';
    navigate(path);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty('--mouse-x', `${x}%`);
      document.documentElement.style.setProperty('--mouse-y', `${y}%`);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden relative selection:bg-emerald-500/30">
      {!isSwarm && (
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
          <div className="absolute inset-0 bg-gradient-radial from-emerald-900/30 to-transparent via-transparent blur-xl animate-glow-breathe" />
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#050505] to-transparent" />
        </div>
      )}

      <nav className={cn(
        "relative z-10 flex items-center w-full px-6 h-16",
        location.pathname.includes('/chat')
          ? "bg-[#0d0d12] border-b border-white/[0.06]"
          : "bg-[rgba(12,12,14,0.85)] backdrop-blur-xl border-b border-white/[0.06]"
      )} role="navigation" aria-label="Main navigation">
        <div className="absolute left-6">
          <motion.button
            onClick={() => navigate('/')}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 text-xl font-bold tracking-tighter"
            aria-label="VibeCheck — Go to home page"
          >
            <motion.div whileHover={{ rotate: 15 }} transition={{ type: 'spring', stiffness: 300 }}>
              <Shield className="w-6 h-6 text-white" />
            </motion.div>
            <span className="hidden sm:inline-block text-[#e8e8f0]">VibeCheck</span>
          </motion.button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2">
          <NavBar
            items={navItems}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        <div className="flex items-center gap-6 text-sm font-medium ml-auto">
          <a href="#" className="hidden md:flex items-center gap-2 text-gray-300 hover:text-white transition-colors" aria-label="View on GitHub">
            <Github className="w-4 h-4" aria-hidden="true" />
            GitHub
          </a>
          <MagneticButton
            onClick={() => navigate('/pipeline')}
            aria-label="Start a security scan"
          >
            Start Scanning
          </MagneticButton>
        </div>
      </nav>

      <ErrorBoundary>
        <Suspense fallback={<PageSkeleton />} key={location.pathname}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/chat" element={<TeamChat />} />
            <Route path="/swarm" element={<Swarm />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}