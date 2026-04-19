"use client";

import { cn } from "@/lib/utils";
import { getSeverityColor } from "@/lib/utils";
import type { ChatMessage as ChatMessageType, Vulnerability } from "@/types";
import { User, Bot, Shield, AlertTriangle, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ChatMessageProps {
  message: ChatMessageType;
}

function VulnerabilityCard({ vuln }: { vuln: Vulnerability }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 bg-dark-700",
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
          <p className="text-sm text-gray-400 mb-2">
            {vuln.file_path}
            {vuln.line_start && `:${vuln.line_start}`}
          </p>
          {vuln.description && (
            <p className="text-sm text-gray-300">{vuln.description}</p>
          )}
        </div>
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      </div>
      {vuln.code_snippet && (
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
            {vuln.code_snippet}
          </SyntaxHighlighter>
        </div>
      )}
      {vuln.fix_suggestion && (
        <div className="mt-3 p-3 rounded-lg bg-dark-600">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
            Fix Suggestion
          </p>
          <p className="text-sm text-gray-300">{vuln.fix_suggestion}</p>
        </div>
      )}
    </div>
  );
}

function ReportSummary({ report }: { report: ChatMessageType["report"] }) {
  if (!report) return null;

  return (
    <div className="rounded-lg border border-dark-500 bg-dark-700 p-4">
      <h4 className="font-medium text-white mb-3 flex items-center gap-2">
        <Shield className="w-4 h-4 text-accent-primary" />
        Scan Report Summary
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-dark-600 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-vuln-critical">
            {report.critical_count}
          </p>
          <p className="text-xs text-gray-500">Critical</p>
        </div>
        <div className="bg-dark-600 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-vuln-high">
            {report.high_count}
          </p>
          <p className="text-xs text-gray-500">High</p>
        </div>
        <div className="bg-dark-600 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-vuln-medium">
            {report.medium_count}
          </p>
          <p className="text-xs text-gray-500">Medium</p>
        </div>
        <div className="bg-dark-600 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-vuln-low">{report.low_count}</p>
          <p className="text-xs text-gray-500">Low</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">
          Total: {report.total_vulnerabilities} vulnerabilities
        </span>
        <span className="text-accent-primary">
          {report.confirmed_count} confirmed
        </span>
      </div>
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isLoading = message.isLoading;

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
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-white">
            {isUser ? "You" : "VibeCheck"}
          </span>
          <span className="text-xs text-gray-500">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Analyzing...</span>
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

        {/* Report Summary */}
        {message.report && <ReportSummary report={message.report} />}

        {/* Vulnerabilities List */}
        {message.vulnerabilities && message.vulnerabilities.length > 0 && (
          <div className="mt-4 space-y-3">
            {message.vulnerabilities.map((vuln) => (
              <VulnerabilityCard key={vuln.id} vuln={vuln} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
