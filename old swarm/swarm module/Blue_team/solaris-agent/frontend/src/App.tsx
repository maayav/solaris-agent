import { motion } from 'motion/react';
import { Shield, Github } from 'lucide-react';
import bgImage from './background.jpeg';

export default function App() {
  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden relative selection:bg-emerald-500/30">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        {/* Note: Replace this placeholder src with '/background.jpg' after placing your uploaded image in the public/ folder */}
        <img 
          src={bgImage} 
          alt="Atmospheric background" 
          className="w-full h-full object-cover opacity-100"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/20 mix-blend-multiply"></div>
        {/* Subtle radial gradient to mimic the glow in the reference image */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-emerald-900/10 blur-[120px] rounded-full pointer-events-none"></div>
        {/* Bottom gradient for depth */}
        <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-[#050505] via-[#050505]/80 to-transparent"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-2 text-xl font-bold tracking-tighter">
            <Shield className="w-6 h-6 text-white" />
            <span className="hidden sm:inline-block">VibeCheck</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-300">
            <a href="#" className="hover:text-white transition-colors">Dashboard</a>
            <a href="#" className="hover:text-white transition-colors">Reports</a>
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
            <a href="#" className="hover:text-white transition-colors">About</a>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium">
          <a href="#" className="hidden md:flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
            <Github className="w-4 h-4" />
            GitHub
          </a>
          <a href="#" className="hidden md:flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
            Sign in
          </a>
          <button className="px-4 py-2 bg-white text-black rounded-md hover:bg-gray-200 transition-colors font-medium">
            Start Scanning
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center min-h-[85vh] px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-5xl mx-auto flex flex-col items-center"
        >
          <Shield className="w-12 h-12 text-white mb-8" />
          
          <h1 className="text-6xl md:text-8xl lg:text-[110px] font-serif tracking-tight leading-[0.95] mb-8">
            Security for <br className="hidden md:block" /> AI-generated code
          </h1>
          
          <div className="flex flex-wrap justify-center gap-4 md:gap-8 text-[10px] md:text-xs font-mono text-gray-400 tracking-[0.2em] uppercase mb-8">
            <span>#1 IN VULNERABILITY DETECTION</span>
            <span>KNOWLEDGE GRAPH ANALYSIS</span>
            <span>ZERO COST LOCAL-FIRST</span>
          </div>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mb-12 font-light leading-relaxed">
            VibeCheck uses Knowledge Graph analysis and AI agents to find vulnerabilities that linters miss.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 mb-24">
            <button className="px-6 py-3 bg-white text-black text-sm font-medium rounded-full hover:bg-gray-200 transition-colors flex items-center gap-2">
              Start Scanning
            </button>
            <button className="px-6 py-3 bg-transparent border border-gray-500 text-white text-sm font-medium rounded-full hover:bg-white/10 transition-colors flex items-center gap-2">
              View demo
            </button>
          </div>

          {/* Social Proof / Example Repos */}
          <div className="w-full max-w-4xl mt-12">
            <div className="flex flex-wrap justify-center items-center gap-10 md:gap-20 opacity-40 hover:opacity-100 transition-opacity duration-500">
              <span className="text-xl md:text-2xl font-bold font-sans tracking-tighter text-gray-300">Juice Shop</span>
              <span className="text-xl md:text-2xl font-bold font-serif italic text-gray-300">DVWA</span>
              <span className="text-xl md:text-2xl font-bold font-mono text-gray-300">NodeGoat</span>
              <span className="text-xl md:text-2xl font-bold font-sans tracking-widest text-gray-300">WebGoat</span>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
