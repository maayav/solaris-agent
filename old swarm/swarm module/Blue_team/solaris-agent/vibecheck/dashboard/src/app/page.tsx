"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ScanProgress } from "@/components/ScanProgress";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { useScan } from "@/hooks/useScan";
import { generateId, extractRepoName } from "@/lib/utils";
import api from "@/lib/api";
import type { ChatMessage as ChatMessageType, Conversation } from "@/types";

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    scanId,
    status: scanStatus,
    report,
    vulnerabilities,
    isLoading: isScanning,
    error: scanError,
    startScan,
    reset: resetScan,
  } = useScan({
    pollInterval: 2000,
    onComplete: (report) => {
      // Add report message to conversation - use vulnerabilities from report response
      addAssistantMessage(
        generateReportSummary(report),
        report,
        report.vulnerabilities || []
      );
    },
    onError: (error) => {
      addAssistantMessage(`❌ Error: ${error.message}`);
    },
  });

  // Get active conversation
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages]);

  // Add a message to the active conversation
  const addMessage = useCallback(
    (message: Omit<ChatMessageType, "id" | "timestamp">) => {
      const newMessage: ChatMessageType = {
        ...message,
        id: generateId(),
        timestamp: new Date(),
      };

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === activeConversationId
            ? {
                ...conv,
                messages: [...conv.messages, newMessage],
                updated_at: new Date(),
              }
            : conv
        )
      );
    },
    [activeConversationId]
  );

  // Add assistant message
  const addAssistantMessage = useCallback(
    (
      content: string,
      report?: ChatMessageType["report"],
      vulnerabilities?: ChatMessageType["vulnerabilities"]
    ) => {
      addMessage({
        role: "assistant",
        content,
        report,
        vulnerabilities,
      });
    },
    [addMessage]
  );

  // Create new conversation
  const createNewConversation = useCallback(() => {
    const newConv: Conversation = {
      id: generateId(),
      title: "New Analysis",
      messages: [],
      created_at: new Date(),
      updated_at: new Date(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    resetScan();
  }, [resetScan]);

  // Handle sending a message
  const handleSendMessage = useCallback(
    (message: string, isRepoUrl?: boolean) => {
      // If no active conversation, create one
      let convId = activeConversationId;
      if (!convId) {
        const newConv: Conversation = {
          id: generateId(),
          title: isRepoUrl ? extractRepoName(message) : "New Chat",
          messages: [],
          created_at: new Date(),
          updated_at: new Date(),
        };
        setConversations((prev) => [newConv, ...prev]);
        convId = newConv.id;
        setActiveConversationId(convId);
      }

      // Add user message
      addMessage({
        role: "user",
        content: message,
      });

      // If it's a repo URL, start scanning
      if (isRepoUrl) {
        // Update conversation title and store scan_id when scan starts
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === convId
              ? { ...conv, title: extractRepoName(message) }
              : conv
          )
        );

        // Add scanning message
        addMessage({
          role: "assistant",
          content: `🔍 Starting security analysis for **${extractRepoName(message)}**...\n\nI'll analyze the repository for vulnerabilities including:\n- N+1 Query patterns\n- SQL Injection\n- XSS vulnerabilities\n- Hardcoded secrets\n- Authentication bypasses\n- Architectural issues`,
          isLoading: true,
        });

        // Start scan and store scan_id when available
        startScan(message).then(() => {
          // After scan starts, store the scan_id in the conversation
          setTimeout(() => {
            if (scanId) {
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id === convId
                    ? { ...conv, scan_id: scanId }
                    : conv
                )
              );
            }
          }, 100);
        });
      } else {
        // Regular chat message - for now, just acknowledge
        addMessage({
          role: "assistant",
          content: "I'm here to help you analyze code repositories. Please paste a GitHub repository URL to start a security scan, or ask me questions about the scan results.",
        });
      }
    },
    [activeConversationId, addMessage, startScan, scanId]
  );

  // Handle example click
  const handleExampleClick = useCallback(
    (url: string) => {
      handleSendMessage(url, true);
    },
    [handleSendMessage]
  );

  // Select conversation and load scan results if available
  const handleSelectConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      setActiveConversationId(id);

      // If this conversation has a scan_id and scan results weren't loaded yet,
      // we need to load them
      if (conv?.scan_id && !conv.messages.some((m) => m.report)) {
        // Load existing scan results from backend
        const loadExistingScan = async () => {
          try {
            const reportResponse = await api.getReport(conv.scan_id!);
            if (reportResponse) {
              // Add the report to the conversation
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === id
                    ? {
                        ...c,
                        messages: [
                          ...c.messages,
                          {
                            id: generateId(),
                            role: "assistant" as const,
                            content: generateReportSummary(reportResponse),
                            timestamp: new Date(),
                            report: reportResponse,
                            vulnerabilities: reportResponse.vulnerabilities,
                          },
                        ],
                      }
                    : c
                )
              );
            }
          } catch (err) {
            console.error("Failed to load existing scan:", err);
          }
        };
        loadExistingScan();
      }
    },
    [conversations]
  );

  // Generate report summary
  function generateReportSummary(report: ChatMessageType["report"]): string {
    if (!report) return "Scan completed.";

    const total = report.total_vulnerabilities;
    const confirmed = report.confirmed_count;

    let summary = `## 🛡️ Security Analysis Complete\n\n`;
    summary += `**Repository:** ${report.repo_url || "Unknown"}\n\n`;
    summary += `### Summary\n\n`;
    summary += `| Severity | Count |\n`;
    summary += `|----------|-------|\n`;
    summary += `| 🔴 Critical | ${report.critical_count} |\n`;
    summary += `| 🟠 High | ${report.high_count} |\n`;
    summary += `| 🟡 Medium | ${report.medium_count} |\n`;
    summary += `| 🟢 Low | ${report.low_count} |\n\n`;
    summary += `**Total:** ${total} vulnerabilities found\n`;
    summary += `**Confirmed:** ${confirmed} verified by LLM\n\n`;

    if (total > 0) {
      summary += `### Next Steps\n\n`;
      summary += `You can ask me about:\n`;
      summary += `- Details about specific vulnerabilities\n`;
      summary += `- How to fix a particular issue\n`;
      summary += `- Security best practices for your codebase\n`;
      summary += `- Prioritization of fixes\n`;
    } else {
      summary += `✅ No significant vulnerabilities detected. Great job!\n\n`;
      summary += `However, this doesn't guarantee your code is secure. Consider:\n`;
      summary += `- Running additional security tools\n`;
      summary += `- Manual code review\n`;
      summary += `- Penetration testing\n`;
    }

    return summary;
  }

  return (
    <>
      {/* Sidebar */}
      <Sidebar
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          created_at: c.created_at,
        }))}
        activeConversationId={activeConversationId}
        onNewConversation={createNewConversation}
        onSelectConversation={handleSelectConversation}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          {activeConversationId && activeConversation && activeConversation.messages.length > 0 ? (
            <div className="max-w-4xl mx-auto">
              {/* Scan Progress */}
              {isScanning && scanStatus && (
                <div className="p-6">
                  <ScanProgress
                    scanStatus={scanStatus}
                    repoUrl={activeConversation.messages[0]?.content}
                  />
                </div>
              )}

              {/* Messages */}
              {activeConversation.messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}

              {/* Error */}
              {scanError && (
                <div className="p-6">
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                    <p className="text-red-400">{scanError}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          ) : (
            <WelcomeScreen onExampleClick={handleExampleClick} />
          )}
        </div>

        {/* Input Area */}
        <ChatInput
          onSendMessage={handleSendMessage}
          isLoading={isScanning}
          disabled={false}
        />
      </div>
    </>
  );
}
