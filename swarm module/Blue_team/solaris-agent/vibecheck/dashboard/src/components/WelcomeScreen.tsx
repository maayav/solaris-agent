"use client";

import { useState, useEffect } from "react";
import { Shield, Github, GitBranch, AlertTriangle, Cpu, Zap, Wifi, WifiOff, Loader2 } from "lucide-react";
import api, { ApiError } from "@/lib/api";

interface WelcomeScreenProps {
  onExampleClick: (url: string) => void;
}

export function WelcomeScreen({ onExampleClick }: WelcomeScreenProps) {
  const [backendStatus, setBackendStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    checkBackendHealth();
  }, []);

  const checkBackendHealth = async () => {
    try {
      await api.checkHealth();
      setBackendStatus("connected");
      setBackendError(null);
    } catch (error) {
      setBackendStatus("disconnected");
      if (error instanceof ApiError) {
        setBackendError(error.message);
      } else {
        setBackendError("Cannot connect to backend server");
      }
    }
  };

  const exampleRepos = [
    {
      name: "Juice Shop",
      url: "https://github.com/juice-shop/juice-shop",
      description: "OWASP's vulnerable web application",
    },
    {
      name: "DVWA",
      url: "https://github.com/digininja/DVWA",
      description: "Damn Vulnerable Web Application",
    },
    {
      name: "NodeGoat",
      url: "https://github.com/OWASP/NodeGoat",
      description: "OWASP Node.js security application",
    },
  ];

  const features = [
    {
      icon: GitBranch,
      title: "Code Analysis",
      description: "Deep structural analysis using knowledge graphs",
    },
    {
      icon: AlertTriangle,
      title: "Vulnerability Detection",
      description: "6 parallel detectors for comprehensive coverage",
    },
    {
      icon: Cpu,
      title: "AI Verification",
      description: "LLM-powered false positive filtering",
    },
    {
      icon: Zap,
      title: "Fast Results",
      description: "Results in minutes, not hours",
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      {/* Backend Status Banner */}
      {backendStatus === "disconnected" && (
        <div className="w-full max-w-2xl mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-400 mb-1">Backend Server Not Running</p>
              <pre className="text-xs text-red-300/80 whitespace-pre-wrap font-mono">
                {backendError}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Logo and Title */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/20 mb-4 relative">
          <Shield className="w-8 h-8 text-accent-primary" />
          {backendStatus === "checking" && (
            <div className="absolute -top-1 -right-1">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          )}
          {backendStatus === "connected" && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-dark-800" />
          )}
          {backendStatus === "disconnected" && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-dark-800" />
          )}
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">VibeCheck</h1>
        <p className="text-gray-400 max-w-md">
          AI-powered security analysis for your code repositories. Paste a
          GitHub URL to get started.
        </p>
        {backendStatus === "connected" && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-green-400">
            <Wifi className="w-4 h-4" />
            <span>Connected to backend</span>
          </div>
        )}
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 max-w-3xl">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="p-4 rounded-xl bg-dark-700 border border-dark-600 hover:border-accent-primary/30 transition-colors"
          >
            <feature.icon className="w-6 h-6 text-accent-primary mb-2" />
            <h3 className="font-medium text-white text-sm mb-1">
              {feature.title}
            </h3>
            <p className="text-xs text-gray-500">{feature.description}</p>
          </div>
        ))}
      </div>

      {/* Example Repositories */}
      <div className="w-full max-w-xl">
        <p className="text-sm text-gray-500 mb-3 text-center">
          Or try with an example repository:
        </p>
        <div className="space-y-2">
          {exampleRepos.map((repo) => (
            <button
              key={repo.url}
              onClick={() => onExampleClick(repo.url)}
              disabled={backendStatus !== "connected"}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-dark-700 border border-dark-600 hover:border-accent-primary/30 hover:bg-dark-600 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Github className="w-5 h-5 text-gray-400 group-hover:text-accent-primary transition-colors" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white text-sm">{repo.name}</p>
                <p className="text-xs text-gray-500 truncate">{repo.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
