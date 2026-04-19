import React from 'react';
import { Files, Shield, AlertTriangle, Activity, Code, Clock } from 'lucide-react';

export default function Dashboard() {
    const stats = [
        { label: "TOTAL SCANS", value: "4", subtext: "3 completed", icon: Files },
        { label: "SECURITY ISSUES", value: "41", subtext: "6 critical", icon: Shield, highlight: true },
        { label: "QUALITY ISSUES", value: "132", subtext: "Across all scans", icon: Code },
        { label: "ACTIVE SCANS", value: "1", subtext: "In progress", icon: Activity },
    ];

    const recentScans = [
        {
            name: "acme/payments-api",
            details: "247 files · 18,420 lines · In about 3 hours",
            type: "Full Scan",
            status: "Completed",
            issues: { critical: 2, high: 5, medium: 12, low: 8 },
            quality: { critical: 3, high: 1, medium: 8, low: 23, info: 15, verylow: 6 }
        },
        {
            name: "acme/web-dashboard",
            details: "89 files · 6,200 lines · about 17 hours ago",
            type: "Security",
            status: "Completed",
            issues: null,
            quality: { critical: 0, high: 2, medium: 5, low: 3, info: 1 }
        },
        {
            name: "acme/auth-service",
            details: "156 files · 11,300 lines · In about 4 hours",
            type: "Full Scan",
            status: "Running",
            issues: null,
            quality: null
        },
        {
            name: "acme/mobile-backend",
            details: "312 files · 24,100 lines · 2 days ago",
            type: "Quality",
            status: "Completed",
            issues: null,
            quality: { critical: 3, high: 11, medium: 34, low: 22, info: 9 }
        },
    ];

    const securityFindings = [
        {
            severity: "Critical",
            title: "SQL Injection in user search endpoint",
            file: "src/routes/users.ts:42",
            tag: "EXPLOITABLE"
        },
        {
            severity: "Critical",
            title: "Hardcoded JWT secret in source code",
            file: "src/config/auth.ts:7",
            tag: "EXPLOITABLE"
        },
        {
            severity: "High",
            title: "Missing rate limiting on authentication endpoint",
            file: "src/routes/auth.ts:15",
            tag: "EXPLOITABLE"
        },
        {
            severity: "High",
            title: "N+1 query in payment listing",
            file: "src/services/payments.ts:89",
        }
    ];

    const qualityIssues = [
        {
            severity: "Critical",
            title: "express 4.17.1 has known CVEs — upgrade to 4.21+",
            file: "package.json:15",
            tag: "TRIVIAL"
        },
        {
            severity: "High",
            title: "moment.js detected — replace with date-fns",
            file: "src/utils/dates.ts:1",
            tag: "MEDIUM"
        },
        {
            severity: "High",
            title: "processPayment() is 187 lines — split into smaller functions",
            file: "src/services/payments.ts:22",
            tag: "LARGE"
        },
        {
            severity: "Medium",
            title: "console.log statements left in production code",
            file: "src/routes/auth.ts:28",
            tag: "SMALL"
        }
    ];

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold font-sans tracking-tight text-white mb-2">Dashboard</h1>
                <p className="text-gray-400 text-sm">Security & code quality overview</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                    <div key={i} className={`bg-[#111214] border rounded-xl p-5 ${stat.highlight ? 'border-red-500/20' : 'border-gray-800/80'} shadow-lg relative overflow-hidden group`}>
                        {stat.highlight && <div className="absolute inset-0 bg-red-500/5 mix-blend-overlay"></div>}
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{stat.label}</span>
                            <stat.icon className="w-4 h-4 text-gray-600" />
                        </div>
                        <div className="relative z-10">
                            <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                            <div className="text-xs text-gray-500">{stat.subtext}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Recent Scans */}
            <div className="bg-[#111214] border border-gray-800/80 rounded-xl p-6 shadow-lg">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-sm font-bold text-white">Recent Scans</h2>
                    <button className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">View all →</button>
                </div>

                <div className="space-y-4">
                    {recentScans.map((scan, i) => (
                        <div key={i} className="flex flex-col lg:flex-row lg:items-center justify-between py-3 border-b border-gray-800/40 last:border-0 gap-4">
                            <div className="flex items-start gap-3">
                                <div className="min-w-2 min-h-2 w-2 h-2 mt-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                                <div>
                                    <div className="font-mono text-sm text-gray-200">{scan.name}</div>
                                    <div className="text-xs text-gray-500 mt-1">{scan.details}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 ml-5 lg:ml-0 overflow-x-auto pb-2 lg:pb-0 hide-scrollbar">
                                <div className="text-xs text-gray-500 whitespace-nowrap">{scan.type}</div>

                                <div className="flex items-center gap-4">
                                    {scan.issues && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.issues.critical}</span>
                                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.issues.high}</span>
                                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.issues.medium}</span>
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.issues.low}</span>
                                        </div>
                                    )}
                                    {scan.quality ? (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-gray-600">{'</>'}</span>
                                            {scan.quality.critical > 0 && <><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.critical}</span></>}
                                            <><span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.high}</span></>
                                            <><span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.medium}</span></>
                                            <><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.low}</span></>
                                            {scan.quality.info && <><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.info}</span></>}
                                            {scan.quality.verylow && <><span className="w-1.5 h-1.5 rounded-full bg-gray-500 inline-block"></span><span className="text-gray-300 font-mono">{scan.quality.verylow}</span></>}
                                        </div>
                                    ) : (
                                        scan.issues === null && scan.quality === null && <div className="text-xs text-gray-500 flex items-center gap-2 font-mono"><span>O</span><span>--</span><span>{'</>'}</span><span>--</span></div>
                                    )}
                                </div>

                                <div className={`text-xs px-2 py-1 rounded bg-[#1A1D21] font-medium whitespace-nowrap w-20 text-center ${scan.status === 'Completed' ? 'text-emerald-400' : 'text-blue-400'}`}>
                                    {scan.status}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Two Column Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">
                {/* Top Security */}
                <div className="bg-[#111214] border border-gray-800/80 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-2 mb-6">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <h2 className="text-sm font-bold text-white">Top Security Findings</h2>
                    </div>

                    <div className="space-y-4">
                        {securityFindings.map((finding, i) => (
                            <div key={i} className="flex justify-between items-start border-b border-gray-800/40 pb-4 last:border-0 last:pb-0">
                                <div className="flex items-start gap-3">
                                    <div className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-mono border ${finding.severity === 'Critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-current inline-block mr-1.5"></span>
                                        {finding.severity}
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-200 font-medium">{finding.title}</div>
                                        <div className="text-xs text-gray-500 font-mono mt-1">{finding.file}</div>
                                    </div>
                                </div>
                                {finding.tag && (
                                    <div className="text-[9px] font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20 mt-1 whitespace-nowrap">
                                        {finding.tag}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Top Quality */}
                <div className="bg-[#111214] border border-gray-800/80 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-2 mb-6">
                        <Code className="w-4 h-4 text-blue-400" />
                        <h2 className="text-sm font-bold text-white">Top Quality Issues</h2>
                    </div>

                    <div className="space-y-4">
                        {qualityIssues.map((issue, i) => (
                            <div key={i} className="flex justify-between items-start border-b border-gray-800/40 pb-4 last:border-0 last:pb-0">
                                <div className="flex items-start gap-3">
                                    <div className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-mono border ${issue.severity === 'Critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                            issue.severity === 'High' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                        }`}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-current inline-block mr-1.5"></span>
                                        {issue.severity}
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-200 font-medium">{issue.title}</div>
                                        <div className="text-xs text-gray-500 font-mono mt-1">{issue.file}</div>
                                    </div>
                                </div>
                                {issue.tag && (
                                    <div className="text-[9px] font-mono px-2 py-0.5 rounded bg-gray-800/50 text-gray-400 border border-gray-700/50 mt-1 whitespace-nowrap">
                                        {issue.tag}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
