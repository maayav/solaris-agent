"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { MissionProgress } from "@/components/MissionProgress";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { useMission } from "@/hooks/useMission";
import { generateId, extractTargetName } from "@/lib/utils";
import type { ChatMessage as ChatMessageType, MissionSession } from "@/types";

export default function Home() {
    const [sessions, setSessions] = useState<MissionSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const {
        missionId,
        missionState,
        isLoading,
        error: missionError,
        startMission,
        cancelMission,
        reset: resetMission,
    } = useMission({
        pollInterval: 2000,
        onComplete: (state) => {
            // Add completion message to conversation
            addAssistantMessage(
                generateMissionSummary(state),
                state.blackboard?.vulnerabilities,
                state
            );
        },
        onError: (error) => {
            addAssistantMessage(`❌ Error: ${error.message}`);
        },
    });

    // Get active session
    const activeSession = sessions.find((s) => s.id === activeSessionId);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activeSession?.messages]);

    // Add a message to the active session
    const addMessage = useCallback(
        (message: Omit<ChatMessageType, "id" | "timestamp">) => {
            const newMessage: ChatMessageType = {
                ...message,
                id: generateId(),
                timestamp: new Date(),
            };

            setSessions((prev) =>
                prev.map((session) =>
                    session.id === activeSessionId
                        ? {
                            ...session,
                            messages: [...session.messages, newMessage],
                            updated_at: new Date(),
                        }
                        : session
                )
            );
        },
        [activeSessionId]
    );

    // Add assistant message
    const addAssistantMessage = useCallback(
        (
            content: string,
            findings?: ChatMessageType["findings"],
            mission_state?: ChatMessageType["mission_state"]
        ) => {
            addMessage({
                role: "assistant",
                content,
                findings,
                mission_state,
            });
        },
        [addMessage]
    );

    // Create new session
    const createNewSession = useCallback(() => {
        const newSession: MissionSession = {
            id: generateId(),
            title: "New Mission",
            target: "",
            messages: [],
            created_at: new Date(),
            updated_at: new Date(),
        };
        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        resetMission();
    }, [resetMission]);

    // Handle sending a message
    const handleSendMessage = useCallback(
        async (message: string, isTargetUrl: boolean) => {
            // If no active session, create one
            let sessionId = activeSessionId;
            if (!sessionId) {
                const newSession: MissionSession = {
                    id: generateId(),
                    title: isTargetUrl ? extractTargetName(message) : "New Mission",
                    target: message,
                    messages: [],
                    created_at: new Date(),
                    updated_at: new Date(),
                };
                setSessions((prev) => [newSession, ...prev]);
                sessionId = newSession.id;
                setActiveSessionId(sessionId);
            }

            // Add user message
            addMessage({
                role: "user",
                content: message,
            });

            // If it's a target URL, start mission
            if (isTargetUrl) {
                // Update session title and target
                setSessions((prev) =>
                    prev.map((session) =>
                        session.id === sessionId
                            ? {
                                ...session,
                                title: extractTargetName(message),
                                target: message,
                            }
                            : session
                    )
                );

                // Add starting message
                addMessage({
                    role: "assistant",
                    content: `🎯 Starting security assessment for **${extractTargetName(message)}**...\n\nThe agent swarm will:\n- 🔍 **Reconnaissance**: Scan for open ports and services\n- 🐛 **Vulnerability Detection**: Test for known vulnerabilities\n- ⚔️ **Exploitation**: Attempt to exploit found vulnerabilities\n- 📊 **Reporting**: Generate comprehensive security report`,
                    isLoading: true,
                });

                await startMission(message);
            } else {
                // Regular chat message
                addMessage({
                    role: "assistant",
                    content: "I'm here to help you with security assessments. Please enter a target URL (e.g., http://localhost:3000) to start a penetration test.",
                });
            }
        },
        [activeSessionId, addMessage, startMission]
    );

    // Handle example click
    const handleExampleClick = useCallback(
        (url: string) => {
            handleSendMessage(url, true);
        },
        [handleSendMessage]
    );

    // Select session
    const handleSelectSession = useCallback((id: string) => {
        setActiveSessionId(id);
    }, []);

    // Generate mission summary
    function generateMissionSummary(state: ChatMessageType["mission_state"]): string {
        if (!state) return "Mission completed.";

        const vulns = state.blackboard?.vulnerabilities || [];
        const total = vulns.length;
        const critical = vulns.filter(v => v.severity === "critical").length;
        const high = vulns.filter(v => v.severity === "high").length;
        const medium = vulns.filter(v => v.severity === "medium").length;
        const low = vulns.filter(v => v.severity === "low").length;

        let summary = `## 🛡️ Security Assessment Complete\n\n`;
        summary += `**Target:** ${state.target}\n\n`;
        summary += `### Summary\n\n`;
        summary += `| Severity | Count |\n`;
        summary += `|----------|-------|\n`;
        summary += `| 🔴 Critical | ${critical} |\n`;
        summary += `| 🟠 High | ${high} |\n`;
        summary += `| 🟡 Medium | ${medium} |\n`;
        summary += `| 🟢 Low | ${low} |\n\n`;
        summary += `**Total:** ${total} findings\n\n`;

        if (total > 0) {
            summary += `### Next Steps\n\n`;
            summary += `You can ask me about:\n`;
            summary += `- Details about specific vulnerabilities\n`;
            summary += `- Exploitation methods\n`;
            summary += `- Remediation recommendations\n`;
        } else {
            summary += `✅ No significant vulnerabilities detected.\n\n`;
            summary += `However, this doesn't guarantee your target is secure. Consider:\n`;
            summary += `- Manual penetration testing\n`;
            summary += `- Additional security tools\n`;
            summary += `- Code review\n`;
        }

        return summary;
    }

    return (
        <>
            {/* Sidebar */}
            <Sidebar
                sessions={sessions.map((s) => ({
                    id: s.id,
                    title: s.title,
                    target: s.target,
                    created_at: s.created_at,
                }))}
                activeSessionId={activeSessionId}
                onNewSession={createNewSession}
                onSelectSession={handleSelectSession}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto">
                    {!activeSession || activeSession.messages.length === 0 ? (
                        <WelcomeScreen onExampleClick={handleExampleClick} />
                    ) : (
                        <div className="max-w-4xl mx-auto">
                            {/* Mission Progress */}
                            {isLoading && missionState && (
                                <div className="p-6">
                                    <MissionProgress
                                        missionState={missionState}
                                        targetUrl={activeSession.target}
                                    />
                                </div>
                            )}

                            {/* Messages */}
                            {activeSession.messages.map((msg) => (
                                <ChatMessage key={msg.id} message={msg} />
                            ))}

                            {/* Error */}
                            {missionError && (
                                <div className="p-6">
                                    <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                                        <p className="text-red-400">{missionError}</p>
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* Input Area */}
                <ChatInput
                    onSendMessage={handleSendMessage}
                    isLoading={isLoading}
                    disabled={false}
                />
            </div>
        </>
    );
}
