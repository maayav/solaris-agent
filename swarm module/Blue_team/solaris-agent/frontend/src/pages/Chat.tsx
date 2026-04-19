import React from 'react';
import { Send, User, Bot, AlertTriangle, Code, Play } from 'lucide-react';

export default function Chat() {
    const redTeamMessages = [
        { id: 1, sender: "user", text: "What's the current attack surface looking like?", time: "14:22:55", author: "Red Lead" },
        {
            id: 2,
            sender: "agent",
            agentType: "Recon",
            agentIcon: Bot,
            text: "I've mapped the full attack surface for `acme/api-server`:\n\n- 34 HTTP endpoints discovered across 12 route files\n- 3 unprotected POST endpoints missing auth middleware\n- 2 file upload endpoints without size/type validation\n- 1 WebSocket endpoint with no origin checking\n\nThe most promising targets are the unprotected endpoints. I've forwarded them to the Exploit agent.",
            time: "14:23:05"
        },
        { id: 3, sender: "user", text: "Can you try SQL injection on the user search?", time: "14:23:06", author: "Red Lead" },
        {
            id: 4,
            sender: "agent",
            agentType: "Exploit",
            agentIcon: AlertTriangle,
            text: "Running SQLi probe on `/api/users?search=` now...\n\n```bash\n$ curl 'http://target:3000/api/users?search=%27%20OR%201%3D1%20--'\n→ HTTP 200 - returned 847 rows (full table dump)\n```\n\n🔴 **CRITICAL: SQL Injection confirmed.**\n\nThe `search` parameter is concatenated directly into a SQL query at `src/controllers/user.ts:52`:\n\n```typescript\nconst sql = `SELECT * FROM users WHERE name LIKE '%${req.query.search}%'`;\n```\n\nFix: Use parameterized queries or an ORM.",
            time: "14:23:17"
        },
        { id: 5, sender: "user", text: "What about XSS vectors?", time: "14:25:19", author: "Red Lead" }
    ];

    const blueTeamMessages = [
        { id: 1, sender: "user", text: "Run a full quality scan on the repo", time: "14:22:50", author: "Blue Lead" },
        {
            id: 2,
            sender: "agent",
            agentType: "Linter",
            agentIcon: Code,
            text: "Semgrep scan complete. Here's the summary:\n\n| Category | Count |\n|---|---|\n| Anti-patterns | 8 |\n| Dead code | 5 |\n| Console.log in production | 6 |\n| Missing error handling | 4 |\n\nMost issues are in `/src/controllers/` and `/src/utils/`. I'll pass the details to the Complexity Analyzer.",
            time: "14:23:06"
        },
        { id: 3, sender: "user", text: "How are the dependencies looking?", time: "14:23:10", author: "Blue Lead" },
        {
            id: 4,
            sender: "agent",
            agentType: "DepCheck",
            agentIcon: Play,
            text: "Dependency audit results:\n\n🔴 **4 Critical CVEs:**\n- `express@4.17.1` → Known prototype pollution (upgrade to 4.21.0)\n- `jsonwebtoken@8.5.1` → Algorithm confusion attack (upgrade to 9.0.0)\n- `lodash@4.17.15` → Prototype pollution (upgrade to 4.17.21)\n- `minimist@1.2.0` → Prototype pollution (upgrade to 1.2.8)\n\n🟡 **Suggestions:**\n- Replace `moment.js` → `date-fns` (87% smaller)\n- Replace `lodash` → native ES6 where possible\n- 12 unused dependencies detected by depcheck",
            time: "14:23:13"
        },
        { id: 5, sender: "user", text: "what about code complexity?", time: "14:23:14", author: "Blue Lead" },
        {
            id: 6,
            sender: "agent",
            agentType: "Complexity",
            agentIcon: Activity,
            text: "Complexity analysis complete:",
            time: "14:25:19"
        }
    ];

    const renderMessage = (msg: any, isRedTeam: boolean) => {
        if (msg.sender === 'user') {
            return (
                <div key={msg.id} className="flex flex-col items-end mb-6">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-gray-500 font-mono">{msg.time}</span>
                    </div>
                    <div className="flex gap-3 max-w-[85%]">
                        <div className="bg-[#1A1D21] border border-gray-800 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-gray-200">
                            {msg.text}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-gray-400" />
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div key={msg.id} className="flex flex-col items-start mb-6">
                <div className="flex items-center gap-2 mb-1">
                    <div className={`flex items-center gap-1.5 text-xs font-mono font-medium ${isRedTeam ? 'text-red-400' : 'text-blue-400'}`}>
                        <msg.agentIcon className="w-3.5 h-3.5" />
                        {msg.agentType}
                    </div>
                </div>
                <div className="flex gap-3 max-w-[90%]">
                    <div className={`bg-[#111214] border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-300 font-mono ${isRedTeam ? 'border-red-900/30' : 'border-blue-900/30'}`}>
                        <div className="whitespace-pre-wrap leading-relaxed space-y-2">
                            {msg.text.split('\n\n').map((paragraph: string, i: number) => {
                                if (paragraph.startsWith('```')) {
                                    const isBash = paragraph.includes('```bash');
                                    const content = paragraph.replace(/```[a-z]*\n/, '').replace(/\n```/, '');
                                    return (
                                        <div key={i} className="bg-black border border-gray-800 rounded p-3 my-2 text-xs overflow-x-auto text-gray-300 font-mono">
                                            {content.split('\n').map((line, j) => (
                                                <div key={j} className="flex">
                                                    {isBash && line.startsWith('$') ? (
                                                        <span className="text-gray-500 mr-2">$</span>
                                                    ) : null}
                                                    <span>{line.replace(/^\$ /, '')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }

                                // Simple markdown parsing for bold and emojis
                                const formatted = paragraph.split(/(🔴|🟡|\*\*.*?\*\*)/g).map((part, k) => {
                                    if (part === '🔴') return <span key={k} className="text-red-500 mr-1">●</span>;
                                    if (part === '🟡') return <span key={k} className="text-yellow-500 mr-1">●</span>;
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                        return <strong key={k} className="text-white font-bold">{part.replace(/\*\*/g, '')}</strong>;
                                    }
                                    if (part.includes('`')) {
                                        const codeParts = part.split(/(`.*?`)/g);
                                        return codeParts.map((c, idx) =>
                                            c.startsWith('`') && c.endsWith('`') ?
                                                <code key={idx} className="bg-gray-800/50 text-emerald-400 px-1 py-0.5 rounded text-[11px]">{c.replace(/`/g, '')}</code> : c
                                        );
                                    }
                                    return part;
                                });

                                return <div key={i}>{formatted}</div>;
                            })}
                        </div>
                    </div>
                </div>
                <span className="text-[10px] text-gray-600 font-mono mt-1.5 ml-1">{msg.time}</span>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full overflow-hidden p-6 md:p-8 max-w-screen-2xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold font-sans tracking-tight text-white mb-1">Team Chat</h1>
                <p className="text-gray-400 text-sm">Communicate with Red Team and Blue Team agents</p>
            </div>

            {/* Split Chat Area */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">

                {/* Red Team Pane */}
                <div className="flex-1 flex flex-col bg-[#111214] border border-gray-800/80 rounded-xl overflow-hidden shadow-lg relative">
                    {/* Top Glow */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500/0 via-red-500/50 to-red-500/0"></div>

                    <div className="p-4 border-b border-gray-800/60 flex items-center justify-between bg-[#151619]">
                        <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-red-500" />
                            <span className="font-semibold text-gray-200">Red Team</span>
                        </div>
                        <span className="text-xs text-gray-500 font-mono">6 messages</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2 custom-scrollbar">
                        {redTeamMessages.map(msg => renderMessage(msg, true))}
                    </div>

                    <div className="p-4 bg-[#151619] border-t border-gray-800/60">
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                placeholder="Ask the Red Team..."
                                className="w-full bg-[#0A0A0B] border border-gray-800 rounded-lg py-3 px-4 text-sm text-gray-200 focus:outline-none focus:border-red-500/50 transition-colors placeholder-gray-600"
                                defaultValue="What about XSS vectors?"
                            />
                            <button className="absolute right-2 p-2 bg-red-600 hover:bg-red-500 text-white rounded-md transition-colors flex items-center justify-center cursor-pointer">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Blue Team Pane */}
                <div className="flex-1 flex flex-col bg-[#111214] border border-gray-800/80 rounded-xl overflow-hidden shadow-lg relative mt-6 lg:mt-0">
                    {/* Top Glow */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0"></div>

                    <div className="p-4 border-b border-gray-800/60 flex items-center justify-between bg-[#151619]">
                        <div className="flex items-center gap-2">
                            <Code className="w-4 h-4 text-blue-500" />
                            <span className="font-semibold text-gray-200">Blue Team</span>
                        </div>
                        <span className="text-xs text-gray-500 font-mono">6 messages</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2 custom-scrollbar">
                        {blueTeamMessages.map(msg => renderMessage(msg, false))}
                    </div>

                    <div className="p-4 bg-[#151619] border-t border-gray-800/60">
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                placeholder="Ask the Blue Team..."
                                className="w-full bg-[#0A0A0B] border border-gray-800 rounded-lg py-3 px-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 transition-colors placeholder-gray-600"
                            />
                            <button className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors flex items-center justify-center cursor-pointer">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
