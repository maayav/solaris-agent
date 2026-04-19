"use client";

import { cn } from "@/lib/utils";
import { getSeverityColor } from "@/lib/utils";
import type { ChatMessage as ChatMessageType, VulnerabilityFinding } from "@/types";
import { User, Bot, Shield, AlertTriangle, Loader2, Target, Bug } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ChatMessageProps {
    message: ChatMessageType;
}

function VulnerabilityCard({ vuln }: { vuln: VulnerabilityFinding }) {
    return (
        <div
            className={cn(
                "rounded-lg border p-4 bg-dark-700 border-l-4",
                getSeverityColor(vuln.severity)
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span
                            className={cn(
                                "px-2 py-0.5 rounded text-xs font-medium uppercase",
                                getSeverityColor(vuln.severity)
                            )}
                        >
                            {vuln.severity}
                        </span>
                        <span className="text-xs text-gray-500">{vuln.type}</span>
                        {vuln.confirmed && (
                            <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                                Confirmed
                            </span>
                        )}
                    </div>
                    <h4 className="font-medium text-white mb-1">
                        {vuln.title || vuln.type}
                    </h4>
                    {vuln.file_path && (
                        <p className="text-sm text-gray-400 mb-2">
                            {vuln.file_path}
                            {vuln.line_number && `:${vuln.line_number}`}
                        </p>
                    )}
                    {vuln.description && (
                        <p className="text-sm text-gray-300">{vuln.description}</p>
                    )}
                </div>
                <Bug className="w-5 h-5 flex-shrink-0 text-vuln-high" />
            </div>
            {vuln.evidence && (
                <div className="mt-3 rounded-lg overflow-hidden">
                    <SyntaxHighlighter
                        language="typescript"
                        style={oneDark}
                        customStyle={{
                            margin: 0,
                            padding: "12px",
                            fontSize: "12px",
                            background: "#1a1a1a",
                        }}
                    >
                        {vuln.evidence}
                    </SyntaxHighlighter>
                </div>
            )}
            {vuln.remediation && (
                <div className="mt-3 p-3 rounded-lg bg-dark-600">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                        Remediation
                    </p>
                    <p className="text-sm text-gray-300">{vuln.remediation}</p>
                </div>
            )}
        </div>
    );
}

function MissionStateCard({ state }: { state: ChatMessageType["mission_state"] }) {
    if (!state) return null;

    return (
        <div className="rounded-lg border border-dark-500 bg-dark-700 p-4">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-accent-primary" />
                Mission Status
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-dark-600 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Phase</p>
                    <p className="text-sm font-medium text-white capitalize">{state.phase}</p>
                </div>
                <div className="bg-dark-600 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Progress</p>
                    <p className="text-sm font-medium text-accent-primary">{state.progress}%</p>
                </div>
            </div>
            <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">
                    Vulnerabilities: {state.blackboard?.vulnerabilities?.length || 0}
                </span>
                <span className="text-accent-primary">
                    Active: {state.current_agent || "None"}
                </span>
            </div>
        </div>
    );
}

const agentIcons: Record<string, React.ReactNode> = {
    commander: <Shield className="w-4 h-4 text-purple-400" />,
    alpha_recon: <Target className="w-4 h-4 text-blue-400" />,
    gamma_exploit: <AlertTriangle className="w-4 h-4 text-orange-400" />,
    report_generator: <Bot className="w-4 h-4 text-green-400" />,
};

export function ChatMessage({ message }: ChatMessageProps) {
    const isUser = message.role === "user";
    const isLoading = message.isLoading;
    const agentName = message.agent_name;

    return (
        <div
            className={cn(
                "flex gap-4 p-6",
                isUser ? "bg-dark-800" : "bg-dark-900"
            )}
        >
            <div
                className={cn(
                    "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                    isUser ? "bg-blue-600" : "bg-accent-primary"
                )}
            >
                {isUser ? (
                    <User className="w-4 h-4 text-white" />
                ) : agentName ? (
                    agentIcons[agentName] || <Bot className="w-4 h-4 text-white" />
                ) : (
                    <Bot className="w-4 h-4 text-white" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white">
                        {isUser ? "You" : agentName ? agentName.replace("_", " ").toUpperCase() : "Red Team"}
                    </span>
                    <span className="text-xs text-gray-500">
                        {message.timestamp.toLocaleTimeString()}
                    </span>
                </div>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Processing...</span>
                    </div>
                ) : (
                    <div className="markdown-content">
                        <ReactMarkdown
                            components={{
                                code({ className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || "");
                                    const isInline = !match;
                                    return isInline ? (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    ) : (
                                        <SyntaxHighlighter
                                            language={match[1]}
                                            style={oneDark}
                                            customStyle={{
                                                margin: 0,
                                                borderRadius: "8px",
                                                fontSize: "13px",
                                            }}
                                        >
                                            {String(children).replace(/\n$/, "")}
                                        </SyntaxHighlighter>
                                    );
                                },
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                    </div>
                )}

                {/* Mission State */}
                {message.mission_state && <MissionStateCard state={message.mission_state} />}

                {/* Vulnerabilities List */}
                {message.findings && message.findings.length > 0 && (
                    <div className="mt-4 space-y-3">
                        {message.findings.map((vuln) => (
                            <VulnerabilityCard key={vuln.id} vuln={vuln} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
