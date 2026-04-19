import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Github, Play, GitBranch, FileCode2, Shield, Code2, Terminal, Check, Loader2, AlertCircle, FileText, ChevronDown, ChevronUp, ExternalLink, Eye, History, Clock, BarChart3, ShieldCheck } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ScanProgress } from '../components/ScanProgress';
import { triggerScan, getScanStatus, getScanResults, listScans } from '../lib/api';
import type { ScanStatusResponse, ScanReportResponse, VulnerabilityFinding } from '../types';

// Helper function to extract vulnerability type from finding
function getVulnerabilityType(finding: VulnerabilityFinding): string {
    // First check vuln_type
    if (finding.vuln_type && finding.vuln_type !== 'null' && finding.vuln_type !== 'undefined' && finding.vuln_type.trim() !== '') {
        return finding.vuln_type.replace(/_/g, ' ').trim();
    }
    
    // Try to extract from title
    const title = finding.title || '';
    const titleLower = title.toLowerCase();
    
    if (titleLower.includes('sql injection') || titleLower.includes('sqli')) return 'SQL Injection';
    if (titleLower.includes('xss') || titleLower.includes('cross-site scripting')) return 'XSS';
    if (titleLower.includes('path traversal') || titleLower.includes('directory traversal')) return 'Path Traversal';
    if (titleLower.includes('hardcoded') || titleLower.includes('secret') || titleLower.includes('password') || titleLower.includes('api key')) return 'Hardcoded Secret';
    if (titleLower.includes('idor')) return 'IDOR';
    if (titleLower.includes('xxe') || titleLower.includes('xml external entity')) return 'XXE';
    if (titleLower.includes('command injection') || titleLower.includes('code injection')) return 'Command Injection';
    if (titleLower.includes('deserialization')) return 'Insecure Deserialization';
    if (titleLower.includes('csrf') || titleLower.includes('cross-site request forgery')) return 'CSRF';
    if (titleLower.includes('lfi') || titleLower.includes('local file inclusion')) return 'LFI';
    if (titleLower.includes('rfi') || titleLower.includes('remote file inclusion')) return 'RFI';
    if (titleLower.includes('open redirect')) return 'Open Redirect';
    if (titleLower.includes('ssrf')) return 'SSRF';
    if (titleLower.includes('rce') || titleLower.includes('remote code execution')) return 'RCE';
    if (titleLower.includes('authentication') || titleLower.includes('auth bypass')) return 'Auth Bypass';
    
    // If title exists, use first few words
    if (title && title.trim() !== '') {
        const words = title.trim().split(/\s+/).slice(0, 3).join(' ');
        if (words) return words;
    }
    
    // Try description as last resort
    const desc = finding.description || '';
    if (desc && desc.trim() !== '') {
        const descWords = desc.trim().split(/\s+/).slice(0, 3).join(' ');
        if (descWords) return descWords;
    }
    
    return 'Other';
}

interface PipelineStage {
    id: string;
    name: string;
    description: string;
    icon: React.ElementType;
    status: 'pending' | 'running' | 'completed' | 'failed';
    team: 'red' | 'blue';
}

// Mock data for demo/report preview
const MOCK_SCAN_REPORT: ScanReportResponse = {
    scan_id: 'demo-scan-001',
    repo_url: 'https://github.com/demo/juice-shop',
    status: 'completed',
    summary: {
        total: 8,
        confirmed: 6,
        critical: 2,
        high: 2,
        medium: 2,
        low: 0,
    },
    findings: [
        {
            id: 'vuln-001',
            scan_id: 'demo-scan-001',
            file_path: 'routes/login.ts',
            line_start: 34,
            vuln_type: 'sql_injection',
            title: 'SQL Injection in login.ts:34',
            description: 'User input is directly concatenated into SQL query without parameterization, allowing attackers to execute arbitrary SQL commands.',
            severity: 'critical',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code constructs a SQL query by directly concatenating user input (req.body.email and req.body.password) into the query string. This is a classic SQL injection vulnerability.',
            fix_suggestion: 'Use parameterized queries: db.query("SELECT * FROM users WHERE email = ? AND password = ?", [email, password])',
            code_snippet: `models.sequelize.query(\`SELECT * FROM Users WHERE email = '\${req.body.email}'\`)`,
            details: { rule_id: 'rules.taint-express-sqli' },
            created_at: new Date().toISOString(),
        },
        {
            id: 'vuln-002',
            scan_id: 'demo-scan-001',
            file_path: 'routes/fileServer.ts',
            line_start: 33,
            vuln_type: 'path_traversal',
            title: 'Path Traversal in fileServer.ts:33',
            description: 'User-controlled file path is used without proper validation, allowing access to files outside the intended directory.',
            severity: 'critical',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code uses res.sendFile with path.resolve("ftp/", file). If file contains path traversal characters like "../", it could access files outside the intended directory.',
            fix_suggestion: 'Validate and sanitize file paths: const safePath = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");',
            code_snippet: `res.sendFile(path.resolve('ftp/', req.params.file))`,
            details: { rule_id: 'javascript.express.security.audit.express-res-sendfile' },
            created_at: new Date().toISOString(),
        },
        {
            id: 'vuln-003',
            scan_id: 'demo-scan-001',
            file_path: 'lib/insecurity.ts',
            line_start: 56,
            vuln_type: 'hardcoded_secret',
            title: 'Hardcoded Secret in insecurity.ts:56',
            description: 'JWT secret key is generated using Math.random() which is not cryptographically secure and could be predictable.',
            severity: 'high',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code uses Math.random() to generate a JWT secret in the denyAll function. This is not a secure way to handle secrets.',
            fix_suggestion: 'Move secrets to environment variables: const secret = process.env.JWT_SECRET;',
            code_snippet: `export const denyAll = () => expressJwt({ secret: '' + Math.random() })`,
            details: { rule_id: 'javascript.jsonwebtoken.security.jwt-hardcode' },
            created_at: new Date().toISOString(),
        },
        {
            id: 'vuln-004',
            scan_id: 'demo-scan-001',
            file_path: 'routes/dataErasure.ts',
            line_start: 41,
            vuln_type: 'xss',
            title: 'XSS in dataErasure.ts:41',
            description: 'User input is rendered in a template without proper escaping, potentially allowing script injection.',
            severity: 'high',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code uses res.render() with user input (email and question.question) without proper escaping, which can lead to XSS vulnerabilities.',
            fix_suggestion: 'Ensure template engine auto-escapes values or manually escape: res.render("template", { userEmail: escapeHtml(email) })',
            code_snippet: `res.render('dataErasureForm', { userEmail: email, securityQuestion: question.question })`,
            details: { rule_id: 'rules.taint-express-xss' },
            created_at: new Date().toISOString(),
        },
        {
            id: 'vuln-005',
            scan_id: 'demo-scan-001',
            file_path: 'routes/chatbot.ts',
            line_start: 141,
            vuln_type: 'sql_injection',
            title: 'NoSQL Injection in chatbot.ts:141',
            description: 'User input is used directly in a MongoDB update operation without sanitization.',
            severity: 'medium',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code directly uses user input (req.body.query) in a MongoDB update query without parameterization.',
            fix_suggestion: 'Validate and sanitize input before using in queries. Use explicit field assignments instead of spreading user input.',
            code_snippet: `const updatedUser = await userModel.update({ username: req.body.query })`,
            details: { rule_id: 'rules.taint-express-nosqli' },
            created_at: new Date().toISOString(),
        },
        {
            id: 'vuln-006',
            scan_id: 'demo-scan-001',
            file_path: 'routes/memory.ts',
            line_start: 17,
            vuln_type: 'security_misconfiguration',
            title: 'Mass Assignment in memory.ts:17',
            description: 'User input is spread directly into model creation without field whitelist, allowing potential mass assignment attacks.',
            severity: 'medium',
            confidence: 'high',
            confirmed: true,
            verification_reason: 'The code spreads req.body directly into the record object which is then passed to MemoryModel.create(), allowing potential mass assignment.',
            fix_suggestion: 'Explicitly whitelist allowed fields: MemoryModel.create({ caption: req.body.caption, imagePath: req.file?.filename })',
            code_snippet: `const memory = await MemoryModel.create({ ...req.body, imagePath: 'assets/uploads/' + req.file?.filename })`,
            details: { rule_id: 'rules.taint-express-mass-assignment' },
            created_at: new Date().toISOString(),
        },
    ],
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
};

const pipelineStages: PipelineStage[] = [
    { id: '1', name: 'Repository Clone', description: 'Clone repository from GitHub', icon: Github, status: 'pending', team: 'blue' },
    { id: '2', name: 'Dependency Analysis', description: 'Scan package.json/requirements.txt for CVEs', icon: GitBranch, status: 'pending', team: 'blue' },
    { id: '3', name: 'Static Analysis', description: 'Run Semgrep and tree-sitter parsing', icon: FileCode2, status: 'pending', team: 'blue' },
    { id: '4', name: 'Attack Surface Mapping', description: 'Identify endpoints and entry points', icon: Shield, status: 'pending', team: 'red' },
    { id: '5', name: 'Vulnerability Detection', description: 'Run exploit probes on discovered targets', icon: Code2, status: 'pending', team: 'red' },
    { id: '6', name: 'Report Generation', description: 'Compile findings into structured report', icon: Terminal, status: 'pending', team: 'blue' },
];

// Map scan status to pipeline stages
function mapStatusToStages(status: string, progress: number, currentStage?: string): PipelineStage[] {
    const stages = [...pipelineStages];

    if (status === 'pending') {
        return stages.map(s => ({ ...s, status: 'pending' as const }));
    }

    if (status === 'completed') {
        return stages.map(s => ({ ...s, status: 'completed' as const }));
    }

    if (status === 'failed') {
        const failedIndex = Math.floor((progress / 100) * stages.length);
        return stages.map((s, idx) => {
            if (idx < failedIndex) return { ...s, status: 'completed' as const };
            if (idx === failedIndex) return { ...s, status: 'failed' as const };
            return { ...s, status: 'pending' as const };
        });
    }

    // Running state
    const activeIndex = Math.floor((progress / 100) * stages.length);
    return stages.map((s, idx) => {
        if (idx < activeIndex) return { ...s, status: 'completed' as const };
        if (idx === activeIndex) return { ...s, status: 'running' as const };
        return { ...s, status: 'pending' as const };
    });
}

export function Pipeline() {
    const [repoUrl, setRepoUrl] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [stages, setStages] = useState<PipelineStage[]>(pipelineStages);
    const [scanId, setScanId] = useState<string | null>(null);
    const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
    const [scanReport, setScanReport] = useState<ScanReportResponse | null>(null);
    const [reportView, setReportView] = useState<'summary' | 'detailed'>('summary');
    const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
    const [scanHistory, setScanHistory] = useState<ScanStatusResponse[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Load scan history
    const loadScanHistory = async () => {
        setLoadingHistory(true);
        try {
            const response = await listScans(10, 0);
            setScanHistory(response.scans);
        } catch (err) {
            console.error('Failed to load scan history:', err);
        } finally {
            setLoadingHistory(false);
        }
    };

    // View a scan from history
    const viewScanFromHistory = async (scan: ScanStatusResponse) => {
        setScanId(scan.scan_id);
        setScanStatus(scan);
        setStages(mapStatusToStages(scan.status, scan.progress, scan.current_stage || undefined));
        setError(null);
        
        // Fetch results for completed scans, or partial results for running scans
        if (scan.status === 'completed' || scan.status === 'running') {
            try {
                const report = await getScanResults(scan.scan_id);
                setScanReport(report);
            } catch (err) {
                console.error('Failed to fetch scan report:', err);
                // Don't show error for running scans - results might not be available yet
                if (scan.status === 'completed') {
                    setError('Failed to load scan report');
                }
            }
        } else {
            setScanReport(null);
        }
        
        // Start polling if scan is still running
        if (scan.status === 'running') {
            setIsLoading(true);
        }
    };

    // Poll for scan status updates
    useEffect(() => {
        if (!scanId || !isLoading) return;

        const interval = setInterval(async () => {
            try {
                const status = await getScanStatus(scanId);
                setScanStatus(status);
                setStages(mapStatusToStages(status.status, status.progress, status.current_stage || undefined));

                // Fetch partial results during vulnerability detection phase (progress > 50%)
                // This allows showing confirmed vulnerabilities in real-time
                if (status.status === 'running' && status.progress >= 50) {
                    try {
                        const report = await getScanResults(scanId);
                        setScanReport(report);
                    } catch (err) {
                        console.error('Failed to fetch partial scan report:', err);
                    }
                }

                // Stop polling if scan is complete or failed
                if (status.status === 'completed' || status.status === 'failed') {
                    setIsLoading(false);
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        setPollInterval(null);
                    }
                    // Fetch final report when scan completes
                    if (status.status === 'completed') {
                        try {
                            const report = await getScanResults(scanId);
                            setScanReport(report);
                        } catch (err) {
                            console.error('Failed to fetch scan report:', err);
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to poll scan status:', err);
            }
        }, 2000);

        setPollInterval(interval);

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [scanId, isLoading]);

    const handleStartScan = async () => {
        if (!repoUrl.trim()) return;

        setError(null);
        setIsLoading(true);
        setScanStatus(null);

        // Reset stages
        setStages(pipelineStages.map(s => ({ ...s, status: 'pending' })));

        try {
            // Trigger the scan via API
            const response = await triggerScan({
                repo_url: repoUrl.trim(),
                triggered_by: 'web-ui',
                priority: 'normal',
            });

            setScanId(response.scan_id);

            // Initial status fetch
            const status = await getScanStatus(response.scan_id);
            setScanStatus(status);
            setStages(mapStatusToStages(status.status, status.progress, status.current_stage || undefined));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start scan');
            setIsLoading(false);
        }
    };

    // Load mock data for demo/testing
    const loadMockReport = () => {
        setError(null);
        setIsLoading(false);
        setScanId('demo-scan-001');
        setScanStatus({
            scan_id: 'demo-scan-001',
            status: 'completed',
            progress: 100,
            current_stage: 'Completed',
        });
        setStages(pipelineStages.map(s => ({ ...s, status: 'completed' as const })));
        setScanReport(MOCK_SCAN_REPORT);
    };

    const isValidGithubUrl = (url: string) => {
        return url.match(/^https:\/\/github\.com\/[\w-]+\/[\w-]+/);
    };

    return (
        <div className="w-full relative z-10 px-6 py-8 max-w-[1400px] mx-auto min-h-screen">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
            >
                <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Security Pipeline</h1>
                <p className="text-sm text-gray-400">Scan a GitHub repository for vulnerabilities and code quality issues</p>
            </motion.div>

            {/* Error Message */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6"
                >
                    <Card className="p-4 border-red-500/30 bg-red-950/20">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-red-400" />
                            <p className="text-red-200">{error}</p>
                        </div>
                    </Card>
                </motion.div>
            )}

            {/* Repository Input Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mb-8"
            >
                <Card className="p-6 border-gray-800 bg-[#0c0c0c]/90">
                    <div className="flex flex-col gap-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-emerald-500/10 rounded-lg">
                                <Github className="w-6 h-6 text-emerald-500" />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-lg font-semibold text-white mb-1">Enter Repository URL</h2>
                                <p className="text-sm text-gray-400 mb-4">Provide a public GitHub repository link to start the security analysis</p>

                                <div className="flex gap-3">
                                    <div className="flex-1 relative">
                                        <input
                                            type="text"
                                            value={repoUrl}
                                            onChange={(e) => setRepoUrl(e.target.value)}
                                            placeholder="https://github.com/username/repository"
                                            className="w-full bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                                            disabled={isLoading}
                                        />
                                        {repoUrl && isValidGithubUrl(repoUrl) && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <Check className="w-4 h-4 text-emerald-500" />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleStartScan}
                                        disabled={!isValidGithubUrl(repoUrl) || isLoading}
                                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Scanning...
                                            </>
                                        ) : (
                                            <>
                                                <Play className="w-4 h-4" />
                                                Start Scan
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={loadMockReport}
                                        disabled={isLoading}
                                        className="px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 disabled:cursor-not-allowed text-gray-300 font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-700"
                                        title="Load demo report with sample vulnerabilities"
                                    >
                                        <Eye className="w-4 h-4" />
                                        Demo Report
                                    </button>
                                    <button
                                        onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadScanHistory(); }}
                                        disabled={isLoading}
                                        className="px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 disabled:cursor-not-allowed text-gray-300 font-medium rounded-lg transition-colors flex items-center gap-2 border border-gray-700"
                                        title="View scan history"
                                    >
                                        <History className="w-4 h-4" />
                                        History
                                    </button>
                                </div>

                                <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
                                    <span className="flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Public repos only
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Auto-detects language
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Results in ~2-5 min
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </motion.div>

            {/* Scan Status Info */}
            {scanStatus && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6"
                >
                    <Card className="p-4 border-gray-800 bg-[#0c0c0c]/90">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400">Scan ID</p>
                                <p className="font-mono text-sm text-gray-200">{scanId}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-gray-400">Status</p>
                                <p className={`font-medium ${scanStatus.status === 'completed' ? 'text-emerald-400' :
                                    scanStatus.status === 'failed' ? 'text-red-400' :
                                        scanStatus.status === 'running' ? 'text-blue-400' :
                                            'text-gray-400'
                                    }`}>
                                    {scanStatus.status.charAt(0).toUpperCase() + scanStatus.status.slice(1)}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-gray-400">Progress</p>
                                <p className="font-mono text-sm text-gray-200">{scanStatus.progress}%</p>
                            </div>
                        </div>
                        {scanStatus.current_stage && (
                            <div className="mt-3 pt-3 border-t border-gray-800">
                                <p className="text-xs text-gray-500">Current Stage: <span className="text-gray-300">{scanStatus.current_stage}</span></p>
                            </div>
                        )}
                    </Card>
                </motion.div>
            )}

            {/* Scan History Panel */}
            <AnimatePresence>
                {showHistory && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-6 overflow-hidden"
                    >
                        <Card className="border-gray-800 bg-[#0c0c0c]/90 overflow-hidden">
                            <div className="p-4 border-b border-gray-800/60 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <History className="w-5 h-5 text-blue-400" />
                                    <h2 className="text-sm font-semibold text-gray-200">Scan History</h2>
                                </div>
                                <button
                                    onClick={() => setShowHistory(false)}
                                    className="text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="p-4">
                                {loadingHistory ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                                    </div>
                                ) : scanHistory.length === 0 ? (
                                    <p className="text-center text-gray-500 py-8">No scan history found</p>
                                ) : (
                                    <div className="space-y-2 max-h-80 overflow-y-auto">
                                        {scanHistory.map((scan) => (
                                            <div
                                                key={scan.scan_id}
                                                onClick={() => viewScanFromHistory(scan)}
                                                className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50 hover:bg-gray-800/50 cursor-pointer transition-colors border border-gray-800/50 hover:border-gray-700"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${
                                                        scan.status === 'completed' ? 'bg-emerald-500' :
                                                        scan.status === 'failed' ? 'bg-red-500' :
                                                        scan.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                                        'bg-gray-500'
                                                    }`} />
                                                    <div>
                                                        <p className="font-mono text-xs text-gray-400">{scan.scan_id.slice(0, 8)}...</p>
                                                        <p className="text-xs text-gray-500">
                                                            {scan.created_at ? new Date(scan.created_at).toLocaleString() : 'Unknown date'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-xs px-2 py-1 rounded ${
                                                        scan.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                                                        scan.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                                                        scan.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                                                        'bg-gray-500/10 text-gray-400'
                                                    }`}>
                                                        {scan.status}
                                                    </span>
                                                    {scan.status === 'completed' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); viewScanFromHistory(scan); }}
                                                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                            View
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Pipeline Stages */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
            >
                <Card className="border-gray-800 bg-[#0c0c0c]/90 overflow-hidden">
                    <div className="p-4 border-b border-gray-800/60">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-gray-200">Pipeline Stages</h2>
                            {scanStatus?.status === 'completed' && (
                                <Badge severity="success" label="Completed" />
                            )}
                            {scanStatus?.status === 'failed' && (
                                <Badge severity="critical" label="Failed" />
                            )}
                            {isLoading && (
                                <Badge severity="info" label="In Progress" />
                            )}
                        </div>
                    </div>

                    <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {stages.map((stage, index) => {
                                const Icon = stage.icon;
                                const isActive = stage.status === 'running';
                                const isCompleted = stage.status === 'completed';
                                const isFailed = stage.status === 'failed';
                                const isPending = stage.status === 'pending';

                                return (
                                    <motion.div
                                        key={stage.id}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: index * 0.1 }}
                                        className={`relative p-4 rounded-lg border transition-all duration-300 ${isFailed
                                            ? 'border-red-500/50 bg-red-950/20'
                                            : isActive
                                                ? stage.team === 'red'
                                                    ? 'border-red-500/50 bg-red-950/20'
                                                    : 'border-blue-500/50 bg-blue-950/20'
                                                : isCompleted
                                                    ? 'border-emerald-500/30 bg-emerald-950/10'
                                                    : 'border-gray-800 bg-gray-900/20'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-lg ${isFailed
                                                ? 'bg-red-500/20'
                                                : isActive
                                                    ? stage.team === 'red'
                                                        ? 'bg-red-500/20'
                                                        : 'bg-blue-500/20'
                                                    : isCompleted
                                                        ? 'bg-emerald-500/20'
                                                        : 'bg-gray-800'
                                                }`}>
                                                {isActive ? (
                                                    <Loader2 className={`w-4 h-4 animate-spin ${stage.team === 'red' ? 'text-red-400' : 'text-blue-400'}`} />
                                                ) : isFailed ? (
                                                    <AlertCircle className="w-4 h-4 text-red-400" />
                                                ) : isCompleted ? (
                                                    <Check className="w-4 h-4 text-emerald-400" />
                                                ) : (
                                                    <Icon className={`w-4 h-4 ${isPending ? 'text-gray-500' : 'text-gray-400'}`} />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className={`font-medium text-sm ${isFailed ? 'text-red-400' :
                                                        isActive ? 'text-white' :
                                                            isCompleted ? 'text-emerald-400' :
                                                                'text-gray-400'
                                                        }`}>
                                                        {stage.name}
                                                    </h3>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${stage.team === 'red'
                                                        ? 'bg-red-500/10 text-red-400'
                                                        : 'bg-blue-500/10 text-blue-400'
                                                        }`}>
                                                        {stage.team === 'red' ? 'Red' : 'Blue'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 leading-relaxed">{stage.description}</p>

                                                {isActive && (
                                                    <div className="mt-2 text-xs text-gray-400 animate-pulse">
                                                        Processing...
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                </Card>
            </motion.div>

            {/* Scan Report Section - Show during LLM verification or when completed */}
            <AnimatePresence>
                {scanReport && (scanStatus?.status === 'completed' || (scanStatus?.status === 'running' && scanStatus.progress >= 70)) && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="mt-8"
                    >
                        <Card className="border-gray-800 bg-[#0c0c0c]/90 overflow-hidden">
                            {/* Report Header */}
                            <div className="p-4 border-b border-gray-800/60">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <FileText className="w-5 h-5 text-emerald-400" />
                                        <h2 className="text-lg font-semibold text-gray-200">
                                            {scanStatus?.status === 'running' ? '🔄 Live Security Report' : 'Security Scan Report'}
                                        </h2>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setReportView('summary')}
                                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                                reportView === 'summary'
                                                    ? 'bg-emerald-600 text-white'
                                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                            }`}
                                        >
                                            Summary
                                        </button>
                                        <button
                                            onClick={() => setReportView('detailed')}
                                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                                reportView === 'detailed'
                                                    ? 'bg-emerald-600 text-white'
                                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                            }`}
                                        >
                                            Detailed Analysis
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Report Content */}
                            <div className="p-6">
                                {reportView === 'summary' ? (
                                    /* Summary View */
                                    <div className="space-y-6">
                                        {/* Summary Stats */}
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                            <div className="bg-gray-900/50 rounded-lg p-4 text-center">
                                                <p className="text-2xl font-bold text-white">{scanReport.summary.total}</p>
                                                <p className="text-xs text-gray-500">Total Findings</p>
                                            </div>
                                            <div className="bg-red-950/30 rounded-lg p-4 text-center border border-red-500/20">
                                                <p className="text-2xl font-bold text-red-400">{scanReport.summary.critical}</p>
                                                <p className="text-xs text-red-400/70">Critical</p>
                                            </div>
                                            <div className="bg-orange-950/30 rounded-lg p-4 text-center border border-orange-500/20">
                                                <p className="text-2xl font-bold text-orange-400">{scanReport.summary.high}</p>
                                                <p className="text-xs text-orange-400/70">High</p>
                                            </div>
                                            <div className="bg-yellow-950/30 rounded-lg p-4 text-center border border-yellow-500/20">
                                                <p className="text-2xl font-bold text-yellow-400">{scanReport.summary.medium}</p>
                                                <p className="text-xs text-yellow-400/70">Medium</p>
                                            </div>
                                            <div className="bg-blue-950/30 rounded-lg p-4 text-center border border-blue-500/20">
                                                <p className="text-2xl font-bold text-blue-400">{scanReport.summary.low}</p>
                                                <p className="text-xs text-blue-400/70">Low</p>
                                            </div>
                                        </div>

                                        {/* Vulnerability Type Distribution */}
                                        {(() => {
                                            // Calculate vulnerability type distribution from actual findings
                                            const typeCounts: Record<string, { count: number; severity: string }> = {};
                                            
                                            if (scanReport.findings && Array.isArray(scanReport.findings)) {
                                                scanReport.findings
                                                    .filter(f => f && f.confirmed)
                                                    .forEach(f => {
                                                        const type = getVulnerabilityType(f);
                                                        if (!typeCounts[type]) {
                                                            typeCounts[type] = { count: 0, severity: f.severity || 'low' };
                                                        }
                                                        typeCounts[type].count++;
                                                    });
                                            }
                                            
                                            const sortedTypes = Object.entries(typeCounts)
                                                .sort((a, b) => b[1].count - a[1].count)
                                                .slice(0, 8);
                                            
                                            const maxCount = sortedTypes.length > 0 ? sortedTypes[0][1].count : 1;
                                            
                                            return sortedTypes.length > 0 ? (
                                                <div className="bg-gray-900/30 border border-gray-800 rounded-lg p-4">
                                                    <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
                                                        <BarChart3 className="w-4 h-4" />
                                                        Vulnerability Type Distribution
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {sortedTypes.map(([type, data], idx) => {
                                                            const percentage = (data.count / maxCount) * 100;
                                                            const barColor = data.severity === 'critical' ? 'bg-red-500' :
                                                                data.severity === 'high' ? 'bg-orange-500' :
                                                                data.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500';
                                                            return (
                                                                <div key={type} className="flex items-center gap-3">
                                                                    <div className="flex-1">
                                                                        <div className="flex justify-between text-xs mb-1">
                                                                            <span className="text-gray-300 capitalize">{type}</span>
                                                                            <span className="text-gray-500">{data.count}</span>
                                                                        </div>
                                                                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                                                            <motion.div
                                                                                initial={{ width: 0 }}
                                                                                animate={{ width: `${percentage}%` }}
                                                                                transition={{ duration: 0.5, delay: idx * 0.05 }}
                                                                                className={`h-full ${barColor} rounded-full`}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="bg-gray-900/30 border border-gray-800 rounded-lg p-4 text-center">
                                                    <Shield className="w-6 h-6 text-gray-600 mx-auto mb-2" />
                                                    <p className="text-sm text-gray-500">No vulnerability type data available</p>
                                                </div>
                                            );
                                        })()}

                                        {/* Key Findings */}
                                        <div>
                                            <h3 className="text-sm font-medium text-gray-400 mb-3">Key Findings</h3>
                                            {isLoading ? (
                                                <div className="bg-blue-950/20 border border-blue-500/20 rounded-lg p-6 text-center">
                                                    <Loader2 className="w-8 h-8 text-blue-400 mx-auto mb-2 animate-spin" />
                                                    <p className="text-blue-400 font-medium">Loading findings...</p>
                                                </div>
                                            ) : scanReport.findings.filter(f => f.confirmed).length === 0 && scanStatus?.status === 'running' ? (
                                                <div className="bg-blue-950/20 border border-blue-500/20 rounded-lg p-6 text-center">
                                                    <Loader2 className="w-8 h-8 text-blue-400 mx-auto mb-2 animate-spin" />
                                                    <p className="text-blue-400 font-medium">Scanning in progress...</p>
                                                    <p className="text-sm text-gray-500 mt-1">Analyzing your code for security vulnerabilities</p>
                                                </div>
                                            ) : scanReport.findings.filter(f => f.confirmed).length === 0 ? (
                                                <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-6 text-center">
                                                    <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                                                    <p className="text-emerald-400 font-medium">No confirmed vulnerabilities found!</p>
                                                    <p className="text-sm text-gray-500 mt-1">Your code passed all security checks.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {scanReport.findings
                                                        .filter(f => f.confirmed)
                                                        .slice(0, 5)
                                                        .map((finding, idx) => (
                                                            <div
                                                                key={finding.id}
                                                                className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800"
                                                            >
                                                                <Badge
                                                                    severity={finding.severity as 'critical' | 'high' | 'medium' | 'low'}
                                                                    label={finding.severity?.toUpperCase() || 'UNKNOWN'}
                                                                />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm text-gray-200 truncate">
                                                                        {finding.vuln_type?.replace(/_/g, ' ') || finding.title || 'Unknown'}
                                                                    </p>
                                                                    <p className="text-xs text-gray-500">
                                                                        {finding.file_path?.split('/').pop() || 'unknown'}:{finding.line_start || 0}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    {scanReport.findings.filter(f => f.confirmed).length > 5 && (
                                                        <button
                                                            onClick={() => setReportView('detailed')}
                                                            className="w-full py-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                                                        >
                                                            View all {scanReport.findings.filter(f => f.confirmed).length} findings →
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    /* Detailed View */
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-medium text-gray-400">
                                                All Findings ({scanReport.findings.filter(f => f.confirmed).length} confirmed)
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">Sort by:</span>
                                                <select
                                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
                                                    onChange={(e) => {
                                                        const sorted = [...scanReport.findings];
                                                        if (e.target.value === 'severity') {
                                                            const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                                                            sorted.sort((a, b) => severityOrder[a.severity as keyof typeof severityOrder] - severityOrder[b.severity as keyof typeof severityOrder]);
                                                        }
                                                        setScanReport({ ...scanReport, findings: sorted });
                                                    }}
                                                >
                                                    <option value="default">Default</option>
                                                    <option value="severity">Severity</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
                                            {scanReport.findings
                                                .filter(f => f.confirmed)
                                                .map((finding) => (
                                                    <div
                                                        key={finding.id}
                                                        className="border border-gray-800 rounded-lg overflow-hidden"
                                                    >
                                                        <button
                                                            onClick={() => setExpandedFinding(expandedFinding === finding.id ? null : finding.id)}
                                                            className="w-full flex items-center gap-3 p-4 bg-gray-900/30 hover:bg-gray-900/50 transition-colors text-left"
                                                        >
                                                            <Badge
                                                                severity={finding.severity as 'critical' | 'high' | 'medium' | 'low'}
                                                                label={finding.severity?.toUpperCase() || 'UNKNOWN'}
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-medium text-gray-200">
                                                                    {finding.vuln_type?.replace(/_/g, ' ') || finding.title || 'Unknown'}
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    {finding.file_path || 'unknown'}:{finding.line_start || 0}
                                                                    {finding.line_end && `-${finding.line_end}`}
                                                                </p>
                                                            </div>
                                                            {expandedFinding === finding.id ? (
                                                                <ChevronUp className="w-4 h-4 text-gray-500" />
                                                            ) : (
                                                                <ChevronDown className="w-4 h-4 text-gray-500" />
                                                            )}
                                                        </button>

                                                        <AnimatePresence>
                                                            {expandedFinding === finding.id && (
                                                                <motion.div
                                                                    initial={{ height: 0, opacity: 0 }}
                                                                    animate={{ height: 'auto', opacity: 1 }}
                                                                    exit={{ height: 0, opacity: 0 }}
                                                                    className="border-t border-gray-800"
                                                                >
                                                                    <div className="p-4 space-y-4">
                                                                        {/* Description */}
                                                                        <div>
                                                                            <h4 className="text-xs font-medium text-gray-500 mb-1">Description</h4>
                                                                            <p className="text-sm text-gray-300">{finding.description}</p>
                                                                        </div>

                                                                        {/* Code Snippet */}
                                                                        {finding.code_snippet && (
                                                                            <div>
                                                                                <h4 className="text-xs font-medium text-gray-500 mb-1">Code Snippet</h4>
                                                                                <pre className="bg-gray-950 rounded-lg p-3 overflow-x-auto">
                                                                                    <code className="text-xs text-gray-400 font-mono">
                                                                                        {finding.code_snippet}
                                                                                    </code>
                                                                                </pre>
                                                                            </div>
                                                                        )}

                                                                        {/* Verification Reason */}
                                                                        {finding.verification_reason && (
                                                                            <div>
                                                                                <h4 className="text-xs font-medium text-gray-500 mb-1">Analysis</h4>
                                                                                <p className="text-sm text-gray-300">{finding.verification_reason}</p>
                                                                            </div>
                                                                        )}

                                                                        {/* Fix Suggestion */}
                                                                        {finding.fix_suggestion ? (
                                                                            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-3">
                                                                                <h4 className="text-xs font-medium text-emerald-400 mb-1 flex items-center gap-1">
                                                                                    <Check className="w-3 h-3" />
                                                                                    Fix Suggestion
                                                                                </h4>
                                                                                <p className="text-sm text-gray-300">{finding.fix_suggestion}</p>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="bg-gray-800/50 rounded-lg p-3">
                                                                                <p className="text-xs text-gray-500 italic">No fix suggestion available</p>
                                                                            </div>
                                                                        )}

                                                                        {/* Confidence */}
                                                                        <div className="flex items-center gap-4 text-xs">
                                                                            <span className="text-gray-500">
                                                                                Confidence: <span className={`font-medium ${
                                                                                    finding.confidence === 'high' ? 'text-emerald-400' :
                                                                                    finding.confidence === 'medium' ? 'text-yellow-400' :
                                                                                    'text-orange-400'
                                                                                }`}>{finding.confidence}</span>
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
