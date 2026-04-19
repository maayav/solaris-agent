import { useState, useEffect, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { FileCode2, Shield, Activity, Code2, Play, ChevronRight, BarChart3, AlertTriangle, Lock, FileWarning, Loader2, Check } from 'lucide-react';
import { Card } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { AnimatedNumber } from '@/shared/components/primitives/AnimatedNumber';

interface DashboardStats {
  totalScans: number;
  completedScans: number;
  runningScans: number;
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  vulnerabilityTypes: { type: string; count: number; severity: string }[];
  recentScans: { scan_id: string; status: string; created_at: string; progress: number }[];
  topFindings: { id: string; severity: string; title: string; file_path: string; line_start: number; confirmed: boolean }[];
}

const topQualityIssues = [
  { id: 'qual-1', severity: 'critical', title: 'express 4.17.1 has known CVEs — upgrade to 4.21+', path: 'package.json:15', label: 'TRIVIAL' },
  { id: 'qual-2', severity: 'high', title: 'moment.js detected — replace with date-fns', path: 'src/utils/dates.ts:1', label: 'MEDIUM' },
  { id: 'qual-3', severity: 'high', title: 'processPayment() is 187 lines — split into smaller functions', path: 'src/services/payments.ts:22', label: 'LARGE' },
  { id: 'qual-4', severity: 'medium', title: 'console.log statements left in production code', path: 'src/routes/auth.ts:28', label: 'SMALL' },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const severityRef = useRef<HTMLDivElement>(null);
  const recentScansRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        setError(null);

        await new Promise(resolve => setTimeout(resolve, 500));

        setStats({
          totalScans: 24,
          completedScans: 18,
          runningScans: 2,
          totalVulnerabilities: 47,
          criticalCount: 5,
          highCount: 12,
          mediumCount: 18,
          lowCount: 12,
          vulnerabilityTypes: [
            { type: 'SQL Injection', count: 8, severity: 'critical' },
            { type: 'XSS', count: 12, severity: 'high' },
            { type: 'Hardcoded Secret', count: 6, severity: 'high' },
            { type: 'Path Traversal', count: 4, severity: 'medium' },
            { type: 'Command Injection', count: 3, severity: 'critical' },
            { type: 'IDOR', count: 5, severity: 'high' },
            { type: 'SSRF', count: 4, severity: 'medium' },
            { type: 'CSRF', count: 5, severity: 'low' },
          ],
          recentScans: [
            { scan_id: 'abc123def456', status: 'running', created_at: '2026-03-29T10:30:00Z', progress: 45 },
            { scan_id: 'def456ghi789', status: 'completed', created_at: '2026-03-28T14:20:00Z', progress: 100 },
            { scan_id: 'ghi789jkl012', status: 'completed', created_at: '2026-03-27T09:15:00Z', progress: 100 },
            { scan_id: 'jkl012mno345', status: 'failed', created_at: '2026-03-26T16:45:00Z', progress: 0 },
          ],
          topFindings: [
            { id: 'vuln-1', severity: 'critical', title: 'SQL Injection in user input', file_path: 'src/routes/users.ts', line_start: 45, confirmed: true },
            { id: 'vuln-2', severity: 'critical', title: 'Hardcoded AWS credentials', file_path: 'src/config/aws.ts', line_start: 12, confirmed: true },
            { id: 'vuln-3', severity: 'high', title: 'XSS via innerHTML', file_path: 'src/components/Editor.tsx', line_start: 78, confirmed: true },
            { id: 'vuln-4', severity: 'high', title: 'Command injection in exec()', file_path: 'src/utils/builder.ts', line_start: 156, confirmed: true },
          ]
        });
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        setError('Failed to load dashboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  useGSAP(() => {
    if (loading || !containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo('.stat-card', 
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out' }
      );

      gsap.fromTo('.vuln-card',
        { opacity: 0, y: 10, rotateX: 0 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out', delay: 0.3 }
      );

      gsap.fromTo('.scan-row',
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out', delay: 0.4 }
      );

      gsap.fromTo('.finding-row',
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out', delay: 0.5 }
      );

      gsap.fromTo('.quality-row',
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out', delay: 0.6 }
      );
    }, containerRef);

    return () => ctx.revert();
  }, [loading]);

  const severityCounts = {
    critical: stats?.criticalCount || 0,
    high: stats?.highCount || 0,
    medium: stats?.mediumCount || 0,
    low: stats?.lowCount || 0,
  };

  const totalVulns = stats?.totalVulnerabilities || 1;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-blue-500';
    }
  };

  const getSeverityBadgeVariant = (severity: string): 'destructive' | 'warning' | 'secondary' | 'default' => {
    switch (severity) {
      case 'critical': return 'destructive';
      case 'high': return 'warning';
      case 'medium': return 'secondary';
      default: return 'default';
    }
  };

  const getVulnIcon = (type: string) => {
    const typeLower = type.toLowerCase();
    if (typeLower.includes('sql') || typeLower.includes('secret')) return Lock;
    if (typeLower.includes('xss') || typeLower.includes('traversal') || typeLower.includes('command')) return AlertTriangle;
    if (typeLower.includes('idor')) return Shield;
    return FileWarning;
  };

  if (loading) {
    return (
      <div className="w-full relative z-10 px-6 py-8 flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
        <p className="text-gray-400">Loading dashboard data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full relative z-10 px-6 py-8 flex flex-col items-center justify-center min-h-screen">
        <div className="text-red-400 mb-2">⚠️ {error}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full relative z-10 px-6 py-8 flex flex-col gap-6 max-w-[1400px] mx-auto min-h-screen">
      <div>
        <h1 className="text-[2rem] font-[800] tracking-[-0.03em] text-white mb-1">Dashboard</h1>
        <p className="font-mono text-[0.7rem] text-[rgba(232,234,240,0.4)]">Security & code quality overview</p>
      </div>

      <div ref={statsRef} className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-4">
        <Card className="stat-card p-5 flex flex-col justify-between h-32 relative overflow-hidden">
          <div className="absolute top-[4px] right-[4px] bottom-[-4px] left-[-4px] border border-white/5 rounded-2xl opacity-30 pointer-events-none" />
          <div className="absolute top-[8px] right-[8px] bottom-[-8px] left-[-8px] border border-white/5 rounded-2xl opacity-15 pointer-events-none" />
          <div className="relative z-10 flex justify-between items-start text-gray-400">
            <span className="text-xs font-semibold tracking-wider uppercase flex items-center gap-1">
              <Shield className="w-4 h-4 text-red-400" /> Security Issues
            </span>
            <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          </div>
          <div className="relative z-10 flex flex-col justify-end">
            <div className="text-[4rem] font-black text-white leading-none tracking-tighter mb-0">
              <AnimatedNumber value={stats?.totalVulnerabilities || 0} />
            </div>
            <div className="text-sm font-mono text-[#ff3b3b] font-medium">
              <AnimatedNumber value={stats?.criticalCount || 0} /> critical
            </div>
          </div>
        </Card>

        <Card className="stat-card p-5 flex flex-col justify-between h-32">
          <div className="absolute top-[4px] right-[4px] bottom-[-4px] left-[-4px] border border-white/5 rounded-2xl opacity-30 pointer-events-none" />
          <div className="absolute top-[8px] right-[8px] bottom-[-8px] left-[-8px] border border-white/5 rounded-2xl opacity-15 pointer-events-none" />
          <div className="relative z-10 flex justify-between items-start text-gray-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Total Scans</span>
            <FileCode2 className="w-4 h-4 text-gray-500" />
          </div>
          <div className="relative z-10 flex flex-col justify-end">
            <div className="text-4xl font-black text-white leading-none tracking-tighter mb-1">
              <AnimatedNumber value={stats?.totalScans || 0} />
            </div>
            <div className="text-xs font-mono text-gray-500">
              <AnimatedNumber value={stats?.completedScans || 0} /> completed
            </div>
          </div>
        </Card>

        <Card className="stat-card p-5 flex flex-col justify-between h-32">
          <div className="absolute top-[4px] right-[4px] bottom-[-4px] left-[-4px] border border-white/5 rounded-2xl opacity-30 pointer-events-none" />
          <div className="absolute top-[8px] right-[8px] bottom-[-8px] left-[-8px] border border-white/5 rounded-2xl opacity-15 pointer-events-none" />
          <div className="relative z-10 flex justify-between items-start text-gray-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Quality Issues</span>
            <Code2 className="w-4 h-4 text-blue-400" />
          </div>
          <div className="relative z-10 flex flex-col justify-end">
            <div className="text-4xl font-black text-white leading-none tracking-tighter mb-1">
              <AnimatedNumber value={132} />
            </div>
            <div className="text-xs font-mono text-gray-500">Across all scans</div>
          </div>
        </Card>

        <Card className="stat-card p-5 flex flex-col justify-between h-32">
          <div className="absolute top-[4px] right-[4px] bottom-[-4px] left-[-4px] border border-white/5 rounded-2xl opacity-30 pointer-events-none" />
          <div className="absolute top-[8px] right-[8px] bottom-[-8px] left-[-8px] border border-white/5 rounded-2xl opacity-15 pointer-events-none" />
          <div className="relative z-10 flex justify-between items-start text-gray-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Active Scans</span>
            <Activity className="w-4 h-4 text-[#2dffb3]" />
          </div>
          <div className="relative z-10 flex flex-col justify-end">
            <div className="text-4xl font-black text-white leading-none tracking-tighter mb-1">
              <AnimatedNumber value={stats?.runningScans || 0} />
            </div>
            <div className={`text-xs font-mono ${(stats?.runningScans || 0) > 0 ? 'text-[#2dffb3]/80' : 'text-gray-500'}`}>
              {(stats?.runningScans || 0) > 0 ? 'In progress' : 'No active scans'}
            </div>
          </div>
        </Card>
      </div>

      {(stats?.totalVulnerabilities || 0) > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card ref={severityRef} className="p-5 relative flex flex-col items-center justify-center min-h-[300px]">
            <div className="absolute top-5 left-5 flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[#2dffb3]" />
              <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-widest">Severity</h2>
            </div>

            <div className="relative w-48 h-48 mt-8 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="96" cy="96" r="80" stroke="rgba(255,255,255,0.05)" strokeWidth="12" fill="none" />
                <circle cx="96" cy="96" r="80" stroke="#3b82f6" strokeWidth="12" fill="none" strokeDasharray="502" strokeDashoffset={502 * (1 - (severityCounts.low + severityCounts.medium + severityCounts.high + severityCounts.critical) / totalVulns)} className="transition-all duration-1000" />
                <circle cx="96" cy="96" r="80" stroke="#eab308" strokeWidth="12" fill="none" strokeDasharray="502" strokeDashoffset={502 * (1 - (severityCounts.medium + severityCounts.high + severityCounts.critical) / totalVulns)} className="transition-all duration-1000 delay-100" />
                <circle cx="96" cy="96" r="80" stroke="#f97316" strokeWidth="12" fill="none" strokeDasharray="502" strokeDashoffset={502 * (1 - (severityCounts.high + severityCounts.critical) / totalVulns)} className="transition-all duration-1000 delay-200" />
                <circle cx="96" cy="96" r="80" stroke="#ff3b3b" strokeWidth="12" fill="none" strokeDasharray="502" strokeDashoffset={502 * (1 - severityCounts.critical / totalVulns)} className="transition-all duration-1000 delay-300" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black">{stats?.totalVulnerabilities || 0}</span>
                <span className="text-xs text-gray-500 font-mono uppercase">Total</span>
              </div>
            </div>

            <div className="w-full grid grid-cols-4 gap-2 mt-6">
              <div className="flex flex-col items-center"><div className="w-2 h-2 rounded-full bg-[#ff3b3b] mb-1" /> <span className="text-white font-bold">{severityCounts.critical}</span><span className="text-[9px] text-gray-500 uppercase">Crit</span></div>
              <div className="flex flex-col items-center"><div className="w-2 h-2 rounded-full bg-[#f97316] mb-1" /> <span className="text-white font-bold">{severityCounts.high}</span><span className="text-[9px] text-gray-500 uppercase">High</span></div>
              <div className="flex flex-col items-center"><div className="w-2 h-2 rounded-full bg-[#eab308] mb-1" /> <span className="text-white font-bold">{severityCounts.medium}</span><span className="text-[9px] text-gray-500 uppercase">Med</span></div>
              <div className="flex flex-col items-center"><div className="w-2 h-2 rounded-full bg-[#3b82f6] mb-1" /> <span className="text-white font-bold">{severityCounts.low}</span><span className="text-[9px] text-gray-500 uppercase">Low</span></div>
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4 relative z-10">
              <Shield className="w-4 h-4 text-[#2dffb3]" />
              <h2 className="text-sm font-semibold text-gray-200">Vulnerabilities by Type</h2>
            </div>
            {stats?.vulnerabilityTypes && stats.vulnerabilityTypes.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
                {stats.vulnerabilityTypes.map((vuln) => {
                  const Icon = getVulnIcon(vuln.type);
                  return (
                    <div
                      key={vuln.type}
                      className="vuln-card p-4 bg-white/[0.02] backdrop-blur-md rounded-xl border border-white/[0.05] hover:bg-white/[0.04] transition-colors cursor-pointer relative transform-gpu shadow-lg"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className={`w-2 h-2 rounded-full ${getSeverityColor(vuln.severity)} shadow-[0_0_10px_currentColor]`} />
                        <Icon className="w-4 h-4 text-gray-400 opacity-50" />
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[2.5rem] font-black text-white leading-none tracking-tighter mb-1">
                          <AnimatedNumber value={vuln.count} />
                        </div>
                        <div className="text-[11px] text-gray-400 font-medium leading-tight truncate">{vuln.type}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 relative z-10">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No vulnerability data available yet</p>
              </div>
            )}
          </Card>
        </div>
      )}

      <Card ref={recentScansRef}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800/60">
          <h2 className="text-sm font-semibold text-gray-200">Recent Scans</h2>
          <button className="text-xs text-emerald-500 hover:text-emerald-400 flex items-center transition-colors">
            View all <ChevronRight className="w-3 h-3 ml-1" />
          </button>
        </div>
        <div className="flex flex-col">
          {stats?.recentScans && stats.recentScans.length > 0 ? (
            stats.recentScans.map((scan, i) => (
              <div key={scan.scan_id} className={`scan-row relative flex items-center justify-between p-4 hover:bg-white/[0.02] transition-all group overflow-hidden ${i !== (stats.recentScans?.length || 0) - 1 ? 'border-b border-gray-800/40' : ''}`}>
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#2dffb3] opacity-0 group-hover:opacity-100 transform -translate-y-full group-hover:translate-y-0 transition-all duration-300 pointer-events-none" />

                <div className="flex items-start gap-3 relative z-10">
                  <div className="mt-1 flex items-center justify-center">
                    {scan.status === 'running' ? (
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" />
                    ) : scan.status === 'completed' ? (
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                    ) : scan.status === 'failed' ? (
                      <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-mono text-sm text-gray-300 font-medium tracking-tight mb-1 cursor-crosshair">
                      {scan.scan_id.slice(0, 8)}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {scan.created_at ? new Date(scan.created_at).toLocaleString() : 'Unknown date'}
                      {scan.progress > 0 && ` • ${scan.progress}%`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className={`px-2 py-1 border rounded text-[10px] font-medium uppercase tracking-wider ${scan.status === 'completed'
                      ? 'bg-emerald-500/5 text-emerald-500 border-emerald-500/20'
                      : scan.status === 'failed'
                          ? 'bg-red-500/5 text-red-500 border-red-500/20'
                          : scan.status === 'running'
                              ? 'bg-blue-500/5 text-blue-500 border-blue-500/20'
                              : 'bg-gray-500/5 text-gray-500 border-gray-500/20'
                    }`}>
                    {scan.status}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Play className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scans yet. Start your first scan!</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col">
          <div className="p-4 border-b border-gray-800/60 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-200">Top Security Findings</h2>
          </div>
          <div className="flex flex-col p-4 gap-3">
            {stats?.topFindings && stats.topFindings.length > 0 ? (
              stats.topFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="finding-row flex justify-between items-start gap-4 p-3 bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.02] rounded-lg transition-colors group cursor-pointer"
                >
                  <div className="flex gap-3 items-start min-w-0">
                    <Badge variant={getSeverityBadgeVariant(finding.severity) as any} className="mt-0.5" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-200 truncate group-hover:text-white transition-colors">{finding.title}</span>
                      <span className="text-xs font-mono text-gray-500 mt-1 truncate group-hover:text-gray-400 transition-colors">{finding.file_path}:{finding.line_start}</span>
                    </div>
                  </div>
                  {finding.confirmed && (
                    <div className="px-1.5 py-0.5 border border-red-900/50 bg-red-950/20 text-red-500 text-[9px] font-bold rounded uppercase tracking-widest shrink-0">
                      CONFIRMED
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Check className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-50" />
                <p className="text-sm">No confirmed vulnerabilities found</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="p-4 border-b border-gray-800/60 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-200">Top Quality Issues</h2>
          </div>
          <div className="flex flex-col p-4 gap-3">
            {topQualityIssues.map((issue) => (
              <div
                key={issue.id}
                className="quality-row flex justify-between items-start gap-4 p-3 bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.02] rounded-lg transition-colors group cursor-pointer"
              >
                <div className="flex gap-3 items-start min-w-0">
                  <Badge variant={getSeverityBadgeVariant(issue.severity) as any} className="mt-0.5" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-200 truncate group-hover:text-white transition-colors">{issue.title}</span>
                    <span className="text-xs font-mono text-gray-500 mt-1 truncate group-hover:text-gray-400 transition-colors">{issue.path}</span>
                  </div>
                </div>
                {issue.label && (
                  <div className="px-1.5 py-0.5 border border-gray-700 bg-gray-800/50 text-gray-400 text-[9px] font-bold rounded uppercase tracking-widest shrink-0">
                    {issue.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
