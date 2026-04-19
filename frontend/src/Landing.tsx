import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Shield, Database, Brain, Search, Lock, CloudOff, Server, Cpu, Check, Terminal, Activity, Network } from 'lucide-react';
import { ElegantShape } from './components/ui/shape-landing-hero';
import { BGPattern } from './components/ui/bg-pattern';
import HighlightCard from './components/ui/highlight-card';
import { FadeIn } from './components/ui/fade-in';
import { SmoothScrollProvider } from './components/providers/smooth-scroll-provider';
import { VulnerabilityFlow } from './components/ui/vulnerability-flow';
import { PremiumBackground } from './components/ui/premium-background';
import { TargetMarquee } from './components/ui/target-marquee';
import { Typewriter } from './components/ui/typewriter';
import { CustomScrollbar } from './components/ui/custom-scrollbar';
import { TestimonialMarquee } from './components/ui/testimonial-marquee';

export function Landing() {
  const testimonials = useMemo(() => [
    { quote: "VibeCheck caught an IDOR in our billing portal that our standard SAST missed for 6 months. The semantic clone approach is brilliant.", author: "Sarah J.", role: "Head of Security" },
    { quote: "Finally, a tool that understands context. The Red Team swarm actually generated a working exploit for a chained vulnerability.", author: "Marcus T.", role: "DevSecOps Engineer" },
    { quote: "Running heavy compute locally with Ollama while offloading only the architectural review to Gemini saves us thousands in API costs.", author: "Elena R.", role: "CTO" },
    { quote: "The Docker sandboxing gives us the confidence to scan untrusted repositories without risking our internal network.", author: "David K.", role: "Security Architect" },
    { quote: "VibeCheck's ability to generate working exploits for chained vulnerabilities is a game-changer for our remediation speed.", author: "Lisa M.", role: "Lead Pen Tester" }
  ], []);

  return (
    <SmoothScrollProvider>
      <CustomScrollbar />
      <div className="bg-black text-white font-sans">
        {/* Hero Section - Content Only, Nav is in App.tsx */}
        <div className="relative min-h-[90vh] flex flex-col overflow-hidden">
          {/* Hero Content */}
          <div className="relative z-10 flex flex-col flex-1 pt-20">
            {/* Main Hero */}
            <main className="flex-1 flex flex-col items-center justify-center px-4 text-center mt-[5vh]">
              <FadeIn>
                <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-[5rem] tracking-tight mb-8 leading-[1.05] max-w-[95vw] md:max-w-none lg:whitespace-nowrap will-change-transform">
                  Security for AI-generated code
                </h1>
              </FadeIn>
              
              <FadeIn delay={0.1}>
                <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 text-[9px] md:text-xs tracking-[0.15em] uppercase text-gray-400 mb-8">
                  <span>#1 IN VULNERABILITY DETECTION</span>
                  <span>KNOWLEDGE GRAPH ANALYSIS</span>
                  <span>ZERO COST LOCAL-FIRST</span>
                </div>
              </FadeIn>
              
              <FadeIn delay={0.2}>
                <p className="max-w-xl text-gray-300 text-base md:text-xl mb-10 leading-relaxed mx-auto px-4">
                  VibeCheck uses Knowledge Graph analysis and AI agents to find vulnerabilities that linters miss.
                </p>
              </FadeIn>
              
              <FadeIn delay={0.3}>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <button className="w-full sm:w-auto bg-white text-black px-8 py-4 rounded-full text-base font-medium hover:bg-gray-100 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
                    Start Scanning
                  </button>
                  <button className="w-full sm:w-auto bg-transparent border border-white/30 text-white px-8 py-4 rounded-full text-base font-medium hover:bg-white/10 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
                    View demo
                  </button>
                </div>
              </FadeIn>
            </main>
          </div>
        </div>

        <TargetMarquee />

        {/* Main Page Content (Solid Background) */}
        <div className="relative z-10 bg-black">
          {/* Visual Graph Section */}
          <section className="py-32 px-4 w-full text-center relative overflow-hidden">
            {/* Elegant Shape Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.05] via-transparent to-rose-500/[0.05] blur-3xl -z-10" />
            <div className="absolute inset-0 overflow-hidden -z-10">
                <ElegantShape
                    delay={0.3}
                    width={600}
                    height={140}
                    rotate={12}
                    gradient="from-indigo-500/[0.15]"
                    className="left-[-10%] md:left-[-5%] top-[15%] md:top-[20%]"
                />
                <ElegantShape
                    delay={0.5}
                    width={500}
                    height={120}
                    rotate={-15}
                    gradient="from-rose-500/[0.15]"
                    className="right-[-5%] md:right-[0%] top-[70%] md:top-[75%]"
                />
            </div>
            
            <div className="max-w-7xl mx-auto">
              <FadeIn>
                <p className="text-gray-400 text-sm tracking-widest uppercase mb-4">Powered by FalkorDB & LightRAG</p>
                <h2 className="font-serif text-5xl md:text-6xl tracking-tight mb-6">
                  AI agents that run SecOps<br />on autopilot
                </h2>
                <p className="text-xl text-gray-400 mb-16 max-w-2xl mx-auto">
                  Find hidden dependencies, taint flows, and architectural timebombs invisible to linters.
                </p>
              </FadeIn>

              {/* Animated Vulnerability Flow */}
              <VulnerabilityFlow />
            </div>
          </section>

          {/* Separator */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Three-Layer RAG Architecture */}
          <section className="py-24 px-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/[0.05] via-transparent to-purple-500/[0.05] blur-3xl z-0" />
            <BGPattern variant="dots" mask="fade-y" fill="rgba(255,255,255,0.3)" />

            <div className="max-w-7xl mx-auto relative z-10">
              <FadeIn className="text-center mb-16">
                <h2 className="font-serif text-4xl md:text-5xl mb-4">The Three-Layer RAG Architecture</h2>
                <p className="text-gray-400 max-w-2xl mx-auto">Different questions require different retrieval strategies. VibeCheck routes queries to the optimal engine.</p>
              </FadeIn>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FadeIn delay={0.1}>
                  <HighlightCard 
                    title="Structural Graph RAG"
                    description={[
                      "FalkorDB + Cypher",
                      "Answers 'What connects to what?'",
                      "Holds mathematically precise code structure extracted by Tree-sitter.",
                      "Finds N+1 queries and unguarded routes instantly."
                    ]}
                    icon={<Database className="w-8 h-8 text-blue-400" />}
                  />
                </FadeIn>
                <FadeIn delay={0.2}>
                  <HighlightCard 
                    title="Semantic & Arch RAG"
                    description={[
                      "LightRAG + Gemini 1M",
                      "Answers 'What does this code mean?'",
                      "Compresses 50k LoC into a semantic clone.",
                      "Catches IDOR, business logic flaws, and privilege escalation paths."
                    ]}
                    icon={<Brain className="w-8 h-8 text-purple-400" />}
                  />
                </FadeIn>
                <FadeIn delay={0.3}>
                  <HighlightCard 
                    title="Vector Similarity RAG"
                    description={[
                      "Qdrant + Nomic Embed",
                      "Answers 'What looks like this pattern?'",
                      "Propagates confirmed vulnerabilities across the codebase.",
                      "Finds sibling flaws automatically."
                    ]}
                    icon={<Search className="w-8 h-8 text-emerald-400" />}
                  />
                </FadeIn>
              </div>
            </div>
          </section>

          {/* Separator */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Bento Features */}
          <section className="py-32 px-4 relative w-full overflow-hidden bg-black">
            {/* Objective 1: Spotlight Radial Gradient */}
            <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/40 via-black/90 to-black" />
            
            {/* Objective 2: Cyber Micro-Grid Overlay */}
            <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

            <div className="max-w-7xl mx-auto relative z-10">
              <FadeIn>
                <h2 className="font-serif text-4xl md:text-5xl mb-12 text-center">Find what linters miss</h2>
              </FadeIn>
            
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.1
                  }
                }
              }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:auto-rows-[240px]"
            >
              {/* Large Card */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="md:col-span-2 lg:col-span-2 min-h-[300px] md:h-full bg-gradient-to-br from-black to-zinc-900 border border-white/10 rounded-3xl p-6 md:p-8 relative overflow-hidden group will-change-transform"
              >
                <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
                  <Network className="w-32 h-32" />
                </div>
                <div className="relative z-10">
                  <h3 className="text-2xl font-medium mb-2">Autonomous Red Teaming</h3>
                  <p className="text-gray-400 max-w-md">A hierarchical LangGraph swarm (Commander, Recon, Social, Exploit) simulates real adversary kill chains nightly.</p>
                </div>
                <div className="absolute bottom-8 left-8 right-8 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg p-4 font-mono text-xs text-green-400 min-h-[80px]">
                  <Typewriter 
                    text="> agent_alpha: Found exposed /.git directory on admin.juiceshop.local" 
                    delay={1.2}
                  />
                  <br/>
                  <Typewriter 
                    text="> commander: Prioritizing. agent_gamma, generate payload." 
                    delay={3.5}
                  />
                </div>
              </motion.div>

              {/* Small Card 1 */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="h-full bg-[#0a0a0a] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-between will-change-transform"
              >
                <Activity className="w-8 h-8 text-gray-400" />
                <div>
                  <h3 className="text-lg font-medium mb-1">Built-in Taint Analysis</h3>
                  <p className="text-sm text-gray-400">Semgrep OSS integration tracks data from sources to dangerous sinks automatically.</p>
                </div>
              </motion.div>

              {/* Small Card 2 */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="h-full bg-[#0a0a0a] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-between will-change-transform"
              >
                <Cpu className="w-8 h-8 text-gray-400" />
                <div>
                  <h3 className="text-lg font-medium mb-1">VRAM-Adaptive</h3>
                  <p className="text-sm text-gray-400">Scales from 8GB (Qwen 7B) to 24GB+ (Qwen 32B) for local reasoning.</p>
                </div>
              </motion.div>

              {/* Wide Card */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="md:col-span-2 lg:col-span-1 min-h-[240px] md:h-full bg-[#0a0a0a] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-center relative overflow-hidden will-change-transform"
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 opacity-10">
                  <Shield className="w-64 h-64" />
                </div>
                <h3 className="text-2xl font-medium mb-2 relative z-10">6-Detector Parallel Suite</h3>
                <p className="text-gray-400 max-w-md relative z-10 mb-6">Runs N+1 checks, taint analysis, secret scanning, unguarded route detection, O(n²) complexity analysis, and dependency audits simultaneously.</p>
                <div className="flex gap-2 relative z-10">
                  {['Cypher', 'AST', 'Semgrep', 'LLM', 'Audit'].map(tag => (
                    <span key={tag} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-gray-300">{tag}</span>
                  ))}
                </div>
              </motion.div>
            </motion.div>
            </div>
          </section>

          {/* Separator */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Privacy Section */}
          <section className="py-24 px-4 text-center relative overflow-hidden">
            {/* Ambient Floating Background Pills */}
            <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
              <motion.div
                animate={{ 
                  y: [0, -20, 0],
                  rotate: [-8, -3, -8]
                }}
                transition={{
                  repeat: Infinity,
                  duration: 8,
                  ease: "easeInOut"
                }}
                className="absolute left-[5%] md:left-[10%] bottom-[5%] md:bottom-[10%] w-64 h-24 bg-violet-500/10 blur-[80px] rounded-full"
              />
              <motion.div
                animate={{ 
                  y: [0, 20, 0],
                  rotate: [20, 25, 20]
                }}
                transition={{
                  repeat: Infinity,
                  duration: 9,
                  ease: "easeInOut",
                  delay: 1
                }}
                className="absolute right-[15%] md:right-[20%] top-[10%] md:top-[15%] w-48 h-16 bg-amber-500/10 blur-[60px] rounded-full"
              />
            </div>

            <div className="max-w-4xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="relative inline-flex items-center justify-center mb-8">
                  <motion.div 
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-full border border-white/20 blur-[2px]"
                  />
                  <div className="relative w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ 
                        type: "spring", 
                        stiffness: 300, 
                        damping: 20,
                        delay: 0.2
                      }}
                    >
                      <Lock className="w-8 h-8 text-white" />
                    </motion.div>
                  </div>
                </div>
                <h2 className="font-serif text-3xl md:text-4xl mb-4">Privacy is built into VibeCheck</h2>
                <p className="text-gray-400 mb-16 max-w-2xl mx-auto">You stay in control. Your codebase never leaves your infrastructure unless you want it to.</p>
              </motion.div>

              <motion.div 
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.1
                    }
                  }
                }}
                className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center"
              >
                {[
                  { icon: CloudOff, title: "Zero Data Retention", desc: "No code or transcripts are saved on our servers." },
                  { icon: Server, title: "Local LLMs", desc: "Heavy compute runs locally via Ollama." },
                  { icon: Terminal, title: "Docker Sandboxing", desc: "Each scan runs in a fresh, isolated container." },
                  { icon: Shield, title: "Cloud Optional", desc: "Use OpenRouter only for high-reasoning tasks." }
                ].map((feature, i) => (
                  <motion.div 
                    key={i}
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
                    }}
                    className="flex flex-col items-center group cursor-default"
                  >
                    <motion.div 
                      whileHover={{ scale: 1.1 }}
                      className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 transition-colors group-hover:border-white/20 group-hover:bg-white/10"
                    >
                      <feature.icon className="w-6 h-6 text-gray-500 group-hover:text-white transition-colors" />
                    </motion.div>
                    <h4 className="text-sm font-medium mb-2 group-hover:text-white transition-colors">{feature.title}</h4>
                    <p className="text-xs text-gray-500 leading-relaxed">{feature.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* Separator */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Pricing & Testimonials Combined Background */}
          <section className="relative overflow-hidden">
            <PremiumBackground className="py-32 px-4">
              {/* Pricing Content */}
              <div className="max-w-5xl mx-auto relative z-10 mb-32">
                <FadeIn className="text-center mb-16">
                  <h2 className="font-serif text-4xl md:text-5xl mb-4">Pricing</h2>
                  <p className="text-gray-400">Deploy locally for free, or upgrade for cloud reasoning.</p>
                </FadeIn>

                <motion.div 
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.2 }}
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: {
                        staggerChildren: 0.15
                      }
                    }
                  }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-8"
                >
                  {/* Free Tier */}
                  <motion.div 
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
                    }}
                    whileHover={{ scale: 1.02, translateY: -5 }}
                    className="h-full bg-[#050505] border border-white/10 rounded-3xl p-8 md:p-10"
                  >
                    <p className="text-gray-400 mb-2">Community</p>
                    <h3 className="text-4xl font-serif mb-6">Free</h3>
                    <ul className="space-y-4 mb-10">
                      {['Local Ollama models only', 'Structural Graph RAG (FalkorDB)', 'Basic Semgrep Taint Analysis', 'Community Discord Support'].map((feature, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                          <Check className="w-4 h-4 text-gray-500" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <button className="w-full py-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-base font-medium">
                      Get started
                    </button>
                  </motion.div>

                  {/* Pro Tier */}
                  <motion.div 
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
                    }}
                    whileHover={{ scale: 1.02, translateY: -5 }}
                    className="h-full bg-gradient-to-b from-zinc-900 to-black border border-white/20 rounded-3xl p-8 md:p-10 relative overflow-hidden"
                  >
                    <motion.div 
                      animate={{ opacity: [0.5, 1, 0.5], boxShadow: ["0 0 0px rgba(255,255,255,0)", "0 0 10px rgba(255,255,255,0.5)", "0 0 0px rgba(255,255,255,0)"] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                      className="absolute top-0 right-0 bg-white text-black text-xs font-bold px-3 py-1 rounded-bl-lg"
                    >
                      PRO
                    </motion.div>
                    <p className="text-gray-400 mb-2">Enterprise</p>
                    <div className="flex items-baseline gap-2 mb-6">
                      <h3 className="text-4xl font-serif">$100</h3>
                      <span className="text-gray-500">/yr</span>
                    </div>
                    <ul className="space-y-4 mb-10">
                      {['Cloud Reasoning (OpenRouter)', 'Full Semantic Clone (Gemini 1M)', 'Red Team Swarm (LangGraph)', 'Cross-scan Regression Detection', 'Priority Support'].map((feature, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                          <Check className="w-4 h-4 text-white" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <button className="w-full py-4 rounded-lg bg-white text-black hover:bg-gray-100 transition-colors text-base font-medium">
                      Upgrade to Pro
                    </button>
                  </motion.div>
                </motion.div>
              </div>

              {/* Separator inside background */}
              <div className="max-w-5xl mx-auto h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-32" />

              {/* Testimonials Content */}
              <div className="w-full relative z-10">
                <FadeIn>
                  <h2 className="font-serif text-3xl md:text-4xl mb-12 text-center">Hear what security teams are saying</h2>
                </FadeIn>
                
                <TestimonialMarquee items={testimonials} />
              </div>
            </PremiumBackground>
          </section>

          {/* Footer */}
          <footer className="py-8 border-t border-white/10 text-center text-sm text-gray-500 flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-2 text-white mb-2">
              <Shield className="w-5 h-5" />
              <span className="font-semibold tracking-tight">VibeCheck</span>
            </div>
            <p>© 2026 VibeCheck Security. All rights reserved.</p>
          </footer>
        </div>
      </div>
    </SmoothScrollProvider>
  );
}
