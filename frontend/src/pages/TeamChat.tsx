import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, ArrowUp, Shield, Code2, ChevronDown, ChevronUp, Check, MessageSquare, Plus, Settings, Loader2, MoreVertical, Trash2, Edit3, Square, ArrowDown, PanelLeft, PanelRight, Paperclip } from 'lucide-react';
import { sendChatMessage } from '../lib/api';
import { supabase, ChatMessageFromDB, Conversation } from '../lib/supabase';
import { cn } from '../lib/utils';
import { PulsatingButton } from '../components/ui/pulsating-button';
import { TeamChatMessage, Message } from '../components/TeamChatMessage';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const RED_TEAM_AGENTS = ['RECON', 'EXPLOIT', 'SOCIAL', 'COMMANDER'];
const BLUE_TEAM_AGENTS = ['LINTER', 'DEPCHECK', 'COMPLEXITY'];

function isRedTeamAgent(agentName: string): boolean {
    const upperAgent = agentName.toUpperCase();
    return RED_TEAM_AGENTS.some(a => upperAgent.includes(a));
}

function isBlueTeamAgent(agentName: string): boolean {
    const upperAgent = agentName.toUpperCase();
    return BLUE_TEAM_AGENTS.some(a => upperAgent.includes(a));
}

function dbToMessage(dbMsg: ChatMessageFromDB): Message {
    return {
        id: dbMsg.id,
        team: dbMsg.team,
        agent: dbMsg.agent_name,
        content: dbMsg.content,
        timestamp: new Date(dbMsg.created_at),
        isUser: dbMsg.agent_name.toLowerCase() === 'user',
    };
}

function MessageSkeleton({ isRed }: { isRed: boolean }) {
    return (
        <div className="flex flex-col">
            <div className="flex items-baseline mb-1">
                <div className="h-3 w-20 bg-white/10 rounded animate-pulse" />
                <div className="h-2 w-16 bg-white/5 rounded animate-pulse ml-3" />
            </div>
            <div className={cn("border border-white/[0.07] rounded-xl p-4 mb-3 bg-white/[0.04] backdrop-blur-[16px]", "border-l-2 border-l-white/10")}>
                <div className="flex gap-1 py-1.5">
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0.15 }} className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0.3 }} className="w-1.5 h-1.5 rounded-full bg-white/40" />
                </div>
            </div>
        </div>
    );
}

function ChatPanel({
    team,
    messages,
    onSendMessage,
    inputValue,
    setInputValue,
    isLoading,
    error,
    activeTeam,
    setActiveTeam,
    isDropdownOpen,
    setIsDropdownOpen,
    isLoadingHistory,
    isStreaming,
    streamingThinking,
    streamingResponse,
    isThinkingOpen,
    onToggleThinking,
    onStop,
    isStopped
}: {
    team: 'red' | 'blue';
    messages: Message[];
    onSendMessage: (team: 'red' | 'blue', message: string) => void;
    inputValue: string;
    setInputValue: (value: string) => void;
    isLoading: boolean;
    error: string | null;
    activeTeam: 'red' | 'blue';
    setActiveTeam: (team: 'red' | 'blue') => void;
    isDropdownOpen: boolean;
    setIsDropdownOpen: (open: boolean) => void;
    isLoadingHistory: boolean;
    isStreaming?: boolean;
    streamingThinking?: string;
    streamingResponse?: string;
    isThinkingOpen?: boolean;
    onToggleThinking?: () => void;
    onStop?: () => void;
    isStopped?: boolean;
}) {
    const isRed = team === 'red';
    const scrollRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
    const [attachment, setAttachment] = useState<File | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsDropdownOpen(false);
            }
        };
        if (isDropdownOpen) {
            document.addEventListener('keydown', handleEscape);
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isDropdownOpen]);

    useEffect(() => {
        if (!isUserScrolledUp && (streamingResponse || streamingThinking)) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [streamingResponse, streamingThinking]);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            const isNearBottom = distanceFromBottom <= 100;

            if (isNearBottom && isUserScrolledUp) {
                setIsUserScrolledUp(false);
            } else if (!isNearBottom && !isUserScrolledUp) {
                setIsUserScrolledUp(true);
            }
        }
    };

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        setIsUserScrolledUp(false);
    };

    const handleSend = () => {
        if (inputValue.trim() && !isLoading) {
            setIsUserScrolledUp(false);
            onSendMessage(team, inputValue.trim());
            setInputValue('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className={cn("flex flex-col h-full relative pb-[56px] md:pb-0 transition-colors duration-700")} style={{}}>
            <div className={cn("h-[60px] px-6 flex items-center justify-between shrink-0")} style={{}}>
                <div className="flex items-center">
                    <div className="w-[5px] h-[5px] rounded-full animate-pulse mr-3" style={{ backgroundColor: team === 'red' ? 'rgba(220,38,38,0.8)' : 'rgba(59,130,246,0.8)' }} />
                    <h1 className="font-['Syne'] font-[600] text-[1rem] text-white tracking-wide">
                        {isRed ? "Red Team" : "Blue Team"}
                    </h1>
                </div>
                <div className="flex items-center">
                    <span className="font-['Inter'] font-[400] text-[0.6875rem] uppercase text-white/50">
                        ACTIVE
                    </span>
                    <div className="w-[5px] h-[5px] rounded-full animate-pulse ml-2 bg-white/40" />
                </div>
            </div>

            {error && (
                <div className="px-5 py-3 border-b shrink-0 bg-white/5 border-white/10">
                    <div className="flex items-center gap-2 text-xs font-mono text-white/60">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {error}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6" onScroll={handleScroll} ref={scrollRef}>
                {isLoadingHistory && messages.length === 0 ? (
                    <>
                        <MessageSkeleton isRed={isRed} />
                        <MessageSkeleton isRed={isRed} />
                        <MessageSkeleton isRed={isRed} />
                    </>
                ) : (
                    <>
                        {messages.map((msg) => (
                            <TeamChatMessage key={msg.id} msg={msg} />
                        ))}
                        {isStreaming && (
                            <TeamChatMessage
                                msg={{
                                    id: 'streaming-msg',
                                    team: activeTeam,
                                    agent: activeTeam === 'red' ? 'RED TEAM' : 'BLUE TEAM',
                                    content: '',
                                    timestamp: new Date(),
                                    isUser: false
                                }}
                                streamingMode={true}
                                streamingThinking={streamingThinking}
                                streamingResponse={streamingResponse}
                                isThinkingOpen={isThinkingOpen}
                                onToggleThinking={onToggleThinking}
                            />
                        )}
                    </>
                )}

                {isLoading && !isLoadingHistory && (
                    <MessageSkeleton isRed={isRed} />
                )}

                <div ref={messagesEndRef} />
            </div>

            {isUserScrolledUp && messages.length > 0 && (
                <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={scrollToBottom}
                    className="absolute bottom-0 left-1/2 transform -translate-x-1/2 mb-3 z-25 w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                    style={{
                        background: 'rgba(255,255,255,0.08)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                    title="Scroll to bottom"
                >
                    <ChevronDown className="w-5 h-5 text-white/80" />
                </motion.button>
            )}

            <div className={cn("flex flex-col shrink-0 z-20 relative")} style={{
                maxWidth: '680px',
                width: '100%',
                margin: '0 auto 24px auto',
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px'
            }}>
                <div className="relative mb-3" ref={dropdownRef} style={{ width: 'fit-content' }}>
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="px-3 py-1 border rounded-lg flex items-center gap-2 cursor-pointer transition-all duration-150"
                        style={{
                            background: 'rgba(255,255,255,0.04)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            backdropFilter: 'blur(16px)'
                        }}
                    >
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeTeam === 'red' ? '#ef4444' : '#3b82f6' }} />
                        <span className="font-['Inter'] font-[500] text-[0.8125rem] text-white/90 tracking-wide">
                            {activeTeam === 'red' ? 'Red Team' : 'Blue Team'}
                        </span>
                        <ChevronUp className="w-[12px] h-[12px] text-white/40" />
                    </button>

                    <AnimatePresence>
                        {isDropdownOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className="absolute bottom-[calc(100%+8px)] left-0 min-w-[200px] z-50 overflow-hidden"
                                style={{
                                    background: 'rgba(15, 15, 20, 0.95)',
                                    backdropFilter: 'blur(20px)',
                                    border: '1px solid rgba(255, 255, 255, 0.15)',
                                    borderRadius: '12px',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                                    padding: '6px'
                                }}
                            >
                                <button
                                    onClick={() => { setActiveTeam('red'); setIsDropdownOpen(false); }}
                                    className="w-full rounded-lg flex items-center gap-3 cursor-pointer transition-all duration-150"
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        background: activeTeam === 'red' ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
                                        color: activeTeam === 'red' ? '#ffffff' : 'rgba(255, 255, 255, 0.9)'
                                    }}
                                >
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
                                    <div className="flex flex-col items-start">
                                        <span className="font-['Inter'] font-[500] text-[0.875rem]" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Red Team</span>
                                        <span className="font-['JetBrains_Mono'] font-[400]" style={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: '0.75rem' }}>Commander</span>
                                    </div>
                                    {activeTeam === 'red' && <Check className="w-[13px] h-[13px] ml-auto" style={{ color: 'white', opacity: 1 }} />}
                                </button>
                                <button
                                    onClick={() => { setActiveTeam('blue'); setIsDropdownOpen(false); }}
                                    className="w-full rounded-lg flex items-center gap-3 cursor-pointer transition-all duration-150"
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        background: activeTeam === 'blue' ? 'rgba(37, 99, 235, 0.2)' : 'transparent',
                                        color: activeTeam === 'blue' ? '#ffffff' : 'rgba(255, 255, 255, 0.9)'
                                    }}
                                >
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                                    <div className="flex flex-col items-start">
                                        <span className="font-['Inter'] font-[500] text-[0.875rem]" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Blue Team</span>
                                        <span className="font-['JetBrains_Mono'] font-[400]" style={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: '0.75rem' }}>Analysis</span>
                                    </div>
                                    {activeTeam === 'blue' && <Check className="w-[13px] h-[13px] ml-auto" style={{ color: 'white', opacity: 1 }} />}
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeTeam === 'red' ? 'Ask the Red Team...' : 'Ask the Blue Team...'}
                    disabled={isLoading || isLoadingHistory}
                    rows={1}
                    className="w-full font-['Inter'] text-[0.875rem] text-white/90 placeholder:font-['Inter'] placeholder:text-white/30 focus:ring-0 outline-none resize-none"
                    style={{
                        minHeight: '36px',
                        maxHeight: '200px',
                        height: 'auto',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '0',
                        padding: '0',
                        marginBottom: '12px',
                    }}
                />

                {attachmentPreview && (
                    <div className="relative mb-3" style={{ width: '80px', height: '80px' }}>
                        <img
                            src={attachmentPreview}
                            alt="Attachment preview"
                            className="w-full h-full rounded-lg object-cover"
                        />
                        <button
                            onClick={() => { setAttachment(null); setAttachmentPreview(null); }}
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}
                            title="Remove attachment"
                        >
                            <span style={{ color: 'white', fontSize: '12px', lineHeight: 1 }}>×</span>
                        </button>
                    </div>
                )}

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            setAttachment(file);
                            const reader = new FileReader();
                            reader.onload = () => setAttachmentPreview(reader.result as string);
                            reader.readAsDataURL(file);
                        }
                    }}
                    accept="image/*"
                    className="hidden"
                    id="attachment-input"
                />

                <div className="flex items-center justify-end gap-3">
                    <button
                        className="flex items-center justify-center transition-colors duration-200 ease"
                        style={{ color: 'rgba(255,255,255,0.4)' }}
                        onClick={() => fileInputRef.current?.click()}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                        title="Attach file"
                    >
                        <Paperclip className="w-4 h-4" />
                    </button>

                    {isStreaming ? (
                        <button
                            onClick={onStop}
                            className="w-[32px] h-[32px] rounded-full flex items-center justify-center p-0 transition-all duration-150 group"
                            style={{
                                background: 'rgba(255,255,255,0.15)',
                                border: 'none',
                            }}
                            title="Stop generating"
                        >
                            <motion.div
                                animate={{ scale: [1, 1.1, 1] }}
                                transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
                            >
                                <Square className="w-3 h-3 text-white/70 group-hover:text-white" />
                            </motion.div>
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!inputValue.trim() || isLoading || isLoadingHistory}
                            className="w-[32px] h-[32px] rounded-full flex items-center justify-center p-0 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: team === 'red' ? 'rgba(220,38,38,0.8)' : 'rgba(37,99,235,0.8)',
                                border: `1px solid ${team === 'red' ? 'rgba(220,38,38,0.6)' : 'rgba(37,99,235,0.6)'}`,
                            }}
                        >
                            <ArrowUp className="w-4 h-4 text-white" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function TeamChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTeam, setActiveTeam] = useState<'red' | 'blue'>('red');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);

    const [streamingThinking, setStreamingThinking] = useState("");
    const [streamingResponse, setStreamingResponse] = useState("");
    const [isThinkingOpen, setIsThinkingOpen] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isStopped, setIsStopped] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);

    const [currentSessionId, setCurrentSessionId] = useState<string>('default-session');
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [conversations, setConversations] = useState<Conversation[]>([]);

    const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    const fetchConversations = useCallback(async () => {
        try {
            const { data, error: err } = await supabase
                .from('conversations')
                .select('*')
                .order('updated_at', { ascending: false })
                .limit(20);

            if (err) throw err;

            if (data && data.length > 0) {
                setConversations(data);
            } else {
                const { data: newConv, error: createErr } = await supabase
                    .from('conversations')
                    .insert({
                        title: 'New Chat',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (createErr) {
                    console.error('Error creating default conversation:', createErr);
                    setConversations([{
                        id: 'default-session',
                        title: 'New Chat',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }]);
                } else if (newConv) {
                    setConversations([newConv]);
                    setCurrentSessionId(newConv.id);
                }
            }
        } catch (err) {
            console.error('Error fetching conversations:', err);
            setConversations([{
                id: 'default-session',
                title: 'New Chat',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }]);
        }
    }, []);

    const fetchChatHistory = useCallback(async (sessionId: string, team: 'red' | 'blue', retryCount = 0) => {
        setMessages([]);
        setIsLoadingHistory(true);
        setError(null);

        try {
            const { data, error: err } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', sessionId)
                .eq('team', team)
                .order('created_at', { ascending: true });

            if (err) {
                if (retryCount < 1) {
                    setTimeout(() => {
                        fetchChatHistory(sessionId, team, retryCount + 1);
                    }, 2000);
                    return;
                }
                throw err;
            }

            if (data) {
                setMessages(data.map(dbToMessage));
            }
        } catch (err) {
            console.error('Error fetching chat history:', err);
            setError('Connection error — retrying...');
            setMessages([]);
            if (retryCount < 1) {
                setTimeout(() => {
                    fetchChatHistory(sessionId, team, retryCount + 1);
                }, 2000);
            }
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = () => setOpenMenuId(null);
        if (openMenuId) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => document.removeEventListener('click', handleClickOutside);
    }, [openMenuId]);

    const setupSubscription = useCallback((sessionId: string, team: 'red' | 'blue') => {
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }

        const channel = supabase
            .channel('chat_messages')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `session_id=eq.${sessionId}`
                },
                (payload) => {
                    const newMsg = payload.new as ChatMessageFromDB;
                    if (newMsg.team === team) {
                        const msgTimestamp = new Date(newMsg.created_at).getTime();
                        setMessages(prev => {
                            const exists = prev.some(m => {
                                if (m.id === newMsg.id) return true;
                                if (m.content === newMsg.content) {
                                    const existingTime = new Date(m.timestamp).getTime();
                                    if (Math.abs(existingTime - msgTimestamp) < 5000) return true;
                                }
                                return false;
                            });
                            if (exists) {
                                console.log('[Supabase] Skipping duplicate message:', newMsg.id, newMsg.content?.substring(0, 30));
                                return prev;
                            }
                            console.log('[Supabase] Adding new message:', newMsg.id, newMsg.agent_name, newMsg.content?.substring(0, 30));
                            return [...prev, dbToMessage(newMsg)];
                        });
                    }
                }
            )
            .subscribe();

        subscriptionRef.current = channel;
    }, []);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    useEffect(() => {
        fetchChatHistory(currentSessionId, activeTeam);
    }, [currentSessionId, activeTeam, fetchChatHistory]);

    useEffect(() => {
        setupSubscription(currentSessionId, activeTeam);

        return () => {
            if (subscriptionRef.current) {
                subscriptionRef.current.unsubscribe();
                subscriptionRef.current = null;
            }
        };
    }, [currentSessionId, activeTeam, setupSubscription]);

    const handleSendMessage = async (team: 'red' | 'blue', content: string) => {
        const optimisticMessage: Message = {
            id: `temp-${Date.now()}`,
            team,
            agent: 'user',
            content,
            timestamp: new Date(),
            isUser: true,
        };

        setMessages(prev => [...prev, optimisticMessage]);
        setIsLoading(true);
        setError(null);
        setIsStopped(false);

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch(`${API_URL}/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content }],
                    team: team
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                throw new Error('Failed to send message to backend');
            }

            const { error: insertErr } = await supabase
                .from('chat_messages')
                .insert({
                    session_id: currentSessionId,
                    team,
                    agent_name: 'user',
                    content,
                    created_at: new Date().toISOString()
                });

            if (insertErr) {
                console.error('Error inserting message to Supabase:', insertErr);
            }

            setIsStreaming(true);
            setStreamingThinking("");
            setStreamingResponse("");
            setIsThinkingOpen(true);

            console.log("Starting stream...", response.status);

            const reader = response.body?.getReader();
            if (!reader) {
                console.error("No reader available");
                throw new Error('Stream not available');
            }

            const decoder = new TextDecoder('utf-8');
            let fullContent = "";
            let currentSection: "thinking" | "response" | "none" = "none";
            let buffer = "";
            let lastThinkingLen = 0;
            let lastResponseLen = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log("Stream done");
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                console.log("Received chunk:", chunk.slice(0, 100));
                buffer += chunk;
                fullContent += chunk;

                const lowerBuffer = buffer.toLowerCase();
                const hasXmlThinkingOpen = lowerBuffer.includes("<thinking>");
                const hasXmlThinkingClose = lowerBuffer.includes("</thinking>");
                const hasXmlResponseOpen = lowerBuffer.includes("<response>");
                const hasXmlResponseClose = lowerBuffer.includes("</response>");
                const hasMdThinking = lowerBuffer.includes("### thinking") || lowerBuffer.includes("### response");

                if (chunk.includes("<thinking>") || chunk.includes("</thinking>")) {
                    console.log("Detected thinking tags in chunk:", chunk.slice(0, 50));
                }

                if (hasXmlThinkingOpen && !hasXmlThinkingClose) {
                    currentSection = "thinking";
                } else if (hasXmlThinkingClose) {
                    currentSection = "response";
                } else if (hasMdThinking) {
                    const thinkingMatch = buffer.match(/### Thinking\n([\s\S]*?)(?=### Response|$)/i);
                    const responseMatch = buffer.match(/### Response\n([\s\S]*)/i);
                    if (thinkingMatch && !responseMatch) {
                        currentSection = "thinking";
                    } else if (responseMatch) {
                        currentSection = "response";
                    }
                } else if (!hasXmlThinkingOpen && !hasXmlThinkingClose && !hasMdThinking && !currentSection) {
                    currentSection = "response";
                }

                if (chunk.includes("</thinking>") || chunk.includes("### Response")) {
                    setIsThinkingOpen(false);
                }

                let thinkingContent = "";
                let responseContent = "";

                if (currentSection === "thinking") {
                    const xmlThinkingMatch = buffer.match(/<thinking>([\s\S]*?)<\/thinking>/i);
                    if (xmlThinkingMatch) {
                        thinkingContent = xmlThinkingMatch[1].trim();
                    } else {
                        const mdMatch = buffer.match(/### Thinking\n([\s\S]*?)(?=### Response|$)/i);
                        if (mdMatch) {
                            thinkingContent = mdMatch[1].trim();
                        } else {
                            const afterThinking = buffer.replace(/^[\s\S]*<thinking>/i, "");
                            thinkingContent = afterThinking.replace(/<\/thinking>[\s\S]*/i, "").trim();
                        }
                    }

                    if (thinkingContent.length > lastThinkingLen) {
                        const newContent = thinkingContent.slice(lastThinkingLen);
                        setStreamingThinking(prev => prev + newContent);
                        lastThinkingLen = thinkingContent.length;
                    }
                } else if (currentSection === "response") {
                    const xmlResponseMatch = buffer.match(/<response>([\s\S]*?)<\/response>/i);
                    if (xmlResponseMatch) {
                        responseContent = xmlResponseMatch[1].trim();
                    } else {
                        const mdMatch = buffer.match(/### Response\n([\s\S]*)/i);
                        if (mdMatch) {
                            responseContent = mdMatch[1].trim();
                        } else {
                            responseContent = buffer
                                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                                .replace(/### Thinking[\s\S]*?### Response\n?/gi, "")
                                .trim();
                        }
                    }

                    if (responseContent.length > lastResponseLen) {
                        const newContent = responseContent.slice(lastResponseLen);
                        setStreamingResponse(prev => prev + newContent);
                        lastResponseLen = responseContent.length;
                    }
                } else {
                    const cleanContent = buffer
                        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                        .replace(/<response>[\s\S]*?<\/response>/gi, "")
                        .replace(/### Thinking[\s\S]*?### Response\n?/gi, "")
                        .trim();
                    if (cleanContent.length > lastResponseLen) {
                        const newContent = cleanContent.slice(lastResponseLen);
                        setStreamingResponse(prev => prev + newContent);
                        lastResponseLen = cleanContent.length;
                    }
                }

                if (buffer.length > 2000) {
                    buffer = buffer.slice(-1000);
                }
            }

            const lastChunk = decoder.decode();
            if (lastChunk) {
                fullContent += lastChunk;
                if (currentSection === "thinking") {
                    setStreamingThinking(prev => prev + lastChunk);
                } else {
                    setStreamingResponse(prev => prev + lastChunk);
                }
            }

            setIsStreaming(false);

            const aiMessage: Message = {
                id: `agent-${Date.now()}`,
                team,
                agent: team === 'red' ? 'RED TEAM' : 'BLUE TEAM',
                content: fullContent,
                timestamp: new Date(),
                isUser: false,
            };

            setMessages(prev => [...prev, aiMessage]);

            await supabase
                .from('chat_messages')
                .insert({
                    session_id: currentSessionId,
                    team,
                    agent_name: aiMessage.agent,
                    content: aiMessage.content,
                    created_at: new Date().toISOString()
                });

        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                console.log('Request aborted by user');
                setIsStopped(true);
                setIsStreaming(false);
                setIsLoading(false);

                const currentThinking = streamingThinking;
                const currentResponse = streamingResponse;
                const partialContent = `<thinking>${currentThinking}</thinking><response>${currentResponse}</response>`;

                if (currentThinking || currentResponse) {
                    const partialMessage: Message = {
                        id: `stopped-${Date.now()}`,
                        team,
                        agent: team === 'red' ? 'RED TEAM' : 'BLUE TEAM',
                        content: partialContent,
                        timestamp: new Date(),
                        isUser: false,
                    };
                    setMessages(prev => [...prev, partialMessage]);
                }

                setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
                return;
            }

            console.error('Error sending message:', err);
            const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
            setError('Connection error — retrying...');

            setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));

            setTimeout(() => {
                handleSendMessage(team, content);
            }, 2000);
        } finally {
            setIsStreaming(false);
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            console.log('Aborting stream...');
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    const handleTeamSwitch = (newTeam: 'red' | 'blue') => {
        if (newTeam === activeTeam) return;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }

        setActiveTeam(newTeam);
        setInputValue('');
        setError(null);
        setIsStopped(false);
        setIsStreaming(false);
    };

    const handleSessionSwitch = (conversationId: string) => {
        if (conversationId === currentSessionId) return;

        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }

        setCurrentSessionId(conversationId);
        setInputValue('');
        setError(null);
    };

    const handleNewChat = async () => {
        try {
            const { data, error: err } = await supabase
                .from('conversations')
                .insert({
                    title: 'New Chat',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (err) {
                console.error('Error creating new chat, fetching existing:', err);
                await fetchConversations();
                return;
            }

            if (data) {
                setConversations(prev => {
                    const exists = prev.some(c => c.id === data.id);
                    if (exists) return prev;
                    return [data, ...prev];
                });
                handleSessionSwitch(data.id);
            }
        } catch (err) {
            console.error('Error creating new chat:', err);
            await fetchConversations();
        }
    };

    const handleRenameConversation = async (conversationId: string, newTitle: string) => {
        if (!newTitle.trim()) {
            setEditingConversationId(null);
            return;
        }

        try {
            await supabase
                .from('conversations')
                .update({ title: newTitle.trim(), updated_at: new Date().toISOString() })
                .eq('id', conversationId);

            setConversations(prev => prev.map(c =>
                c.id === conversationId ? { ...c, title: newTitle.trim() } : c
            ));
        } catch (err) {
            console.error('Error renaming conversation:', err);
        }
        setEditingConversationId(null);
    };

    const handleDeleteConversation = async (conversationId: string) => {
        try {
            await supabase
                .from('chat_messages')
                .delete()
                .eq('session_id', conversationId);

            await supabase
                .from('conversations')
                .delete()
                .eq('id', conversationId);

            setConversations(prev => prev.filter(c => c.id !== conversationId));

            if (conversationId === currentSessionId) {
                const remaining = conversations.filter(c => c.id !== conversationId);
                if (remaining.length > 0) {
                    handleSessionSwitch(remaining[0].id);
                } else {
                    handleNewChat();
                }
            }
        } catch (err) {
            console.error('Error deleting conversation:', err);
        }
        setOpenMenuId(null);
    };

    return (
        <div className="w-full h-[calc(100vh-80px)] flex flex-col font-sans overflow-hidden relative isolation-isolate">
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                    zIndex: 1,
                    pointerEvents: 'none'
                }}
            />

            <div
                className="absolute pointer-events-none"
                style={{
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '60%',
                    zIndex: 2,
                    background: activeTeam === 'red'
                        ? 'radial-gradient(ellipse at 50% 120%, rgba(220,38,38,0.12) 0%, transparent 60%)'
                        : 'radial-gradient(ellipse at 50% 120%, rgba(37,99,235,0.12) 0%, transparent 60%)'
                }}
            />

            <div className={cn("flex h-full w-full flex-col md:flex-row overflow-hidden")}>
                <div
                    className={cn(
                        "hidden md:flex flex-col h-full relative shrink-0 z-10 overflow-hidden",
                        isSidebarOpen ? "w-[200px]" : "w-0"
                    )}
                    style={{
                        background: isSidebarOpen ? 'rgba(8,8,12,0.75)' : 'transparent',
                        backdropFilter: 'blur(24px)',
                        borderRight: isSidebarOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
                        transition: 'width 250ms ease, background 250ms ease, border 250ms ease'
                    }}
                >
                    {isSidebarOpen && (
                        <div className="px-3 pt-3 pb-2">
                            <button
                                onClick={() => setIsSidebarOpen(false)}
                                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg transition-all hover:bg-white/10"
                                style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '8px',
                                }}
                            >
                                <PanelLeft className="w-3.5 h-3.5 text-white/70" />
                            </button>
                        </div>
                    )}
                    <div className="px-4 pt-4 pb-3 border-b border-white/[0.06] shrink-0">
                        <div className="font-['Syne'] font-[700] text-[0.9375rem] text-white/90 tracking-wide">VibeCheck</div>
                        <div className="font-['Syne'] font-[600] text-[1.125rem] text-white/90 tracking-wide mt-[2px]">Team Chat</div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-3 py-3">
                        <div className="font-['Inter'] font-[500] text-[0.625rem] text-white/50 tracking-[0.12em] px-1 mb-2 uppercase">CONVERSATIONS</div>

                        <button
                            onClick={handleNewChat}
                            className="w-full px-3 py-2 mb-3 border rounded-xl flex items-center gap-2 group transition-all"
                            style={{
                                background: 'rgba(255,255,255,0.04)',
                                borderColor: 'rgba(255,255,255,0.1)',
                                backdropFilter: 'blur(16px)',
                                borderRadius: '16px'
                            }}
                        >
                            <Plus className="w-[13px] h-[13px] text-white/50 group-hover:text-white transition-colors" />
                            <span className="font-['Inter'] font-[400] text-[0.8125rem] text-white/70 group-hover:text-white/90 transition-colors">New Chat</span>
                        </button>

                        {conversations.length > 0 ? (
                            conversations.map((conv) => (
                                <div key={conv.id} className="relative">
                                    {editingConversationId === conv.id ? (
                                        <input
                                            type="text"
                                            defaultValue={conv.title}
                                            autoFocus
                                            onBlur={(e) => handleRenameConversation(conv.id, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleRenameConversation(conv.id, e.currentTarget.value);
                                                if (e.key === 'Escape') setEditingConversationId(null);
                                            }}
                                            className="w-full px-2 py-1 bg-black/50 border border-white/20 rounded text-[0.8125rem] text-white font-['Inter'] outline-none"
                                        />
                                    ) : (
                                        <button
                                            onClick={() => handleSessionSwitch(conv.id)}
                                            className={cn(
                                                "w-full px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer transition-all duration-150",
                                                conv.id === currentSessionId
                                                    ? "bg-white/[0.08] text-white/90 my-0.5"
                                                    : "text-white/50 hover:text-white/90 hover:bg-white/[0.06]"
                                            )}
                                            style={{
                                                background: conv.id === currentSessionId ? 'rgba(255,255,255,0.08)' : 'transparent',
                                                backdropFilter: 'blur(10px)'
                                            }}
                                        >
                                            <MessageSquare className="w-[13px] h-[13px] text-white/30 shrink-0" />
                                            <span className="font-['Inter'] font-[400] text-[0.8125rem] text-white/70 truncate flex-1 text-left">{conv.title}</span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                                                }}
                                                className="p-1 hover:bg-white/10 rounded"
                                            >
                                                <MoreVertical className="w-[12px] h-[12px] text-white/40" />
                                            </button>
                                        </button>
                                    )}

                                    {openMenuId === conv.id && (
                                        <div className="absolute right-2 top-8 z-50 bg-black/90 backdrop-blur border border-white/10 rounded-lg py-1 min-w-[120px]">
                                            <button
                                                onClick={() => {
                                                    setEditingConversationId(conv.id);
                                                    setOpenMenuId(null);
                                                }}
                                                className="w-full px-3 py-2 text-left text-[0.75rem] text-white/70 hover:bg-white/10 flex items-center gap-2"
                                            >
                                                <Edit3 className="w-[12px] h-[12px]" />
                                                Rename
                                            </button>
                                            <button
                                                onClick={() => handleDeleteConversation(conv.id)}
                                                className="w-full px-3 py-2 text-left text-[0.75rem] text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-[12px] h-[12px]" />
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <>
                                <button className="w-full px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer transition-all duration-150 bg-white/[0.08] text-[#e8e8f0] my-0.5">
                                    <MessageSquare className="w-[13px] h-[13px] text-[#44444f] shrink-0" />
                                    <span className="font-['Inter'] font-[400] text-[0.8125rem] text-white truncate">Security scan #4</span>
                                </button>
                                <button className="w-full px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer transition-all duration-150 hover:bg-white/[0.05] text-[#6b6b7a] hover:text-[#e8e8f0]">
                                    <MessageSquare className="w-[13px] h-[13px] text-[#44444f] shrink-0" />
                                    <span className="font-['Inter'] font-[400] text-[0.8125rem] text-[#9090a0] truncate">API recon session</span>
                                </button>
                            </>
                        )}
                    </div>

                    <div className="mt-auto px-4 py-3 border-t border-white/[0.06] shrink-0 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {isStreaming ? (
                                <>
                                    <div className={cn("w-1.5 h-1.5 rounded-full bg-red-500 animate-ping")} />
                                    <span className="font-['Inter'] font-[400] text-[0.6875rem] text-red-400">
                                        Generating...
                                    </span>
                                </>
                            ) : isStopped ? (
                                <>
                                    <div className={cn("w-1.5 h-1.5 rounded-full bg-yellow-500")} />
                                    <span className="font-['Inter'] font-[400] text-[0.6875rem] text-yellow-400">
                                        Stopped
                                    </span>
                                </>
                            ) : (
                                <>
                                    <div className={cn("w-1.5 h-1.5 rounded-full bg-[#2dffb3] animate-ping")} />
                                    <span className="font-['Inter'] font-[400] text-[0.6875rem] text-[#44444f]">
                                        {isLoading ? 'Processing...' : 'Ready'}
                                    </span>
                                </>
                            )}
                        </div>
                        <button className="flex items-center justify-center text-[#44444f] hover:text-[#6b6b7a] transition-colors">
                            <Settings className="w-[14px] h-[14px]" />
                        </button>
                    </div>
                </div>

                <main className="flex-1 w-full h-full relative overflow-hidden flex flex-col min-h-[60vh] md:min-h-0 min-w-0 z-1">
                    {!isSidebarOpen && (
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="absolute top-4 left-4 z-10 flex items-center justify-center gap-1.5 p-1.5 rounded-lg transition-all hover:bg-white/10"
                            style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                            }}
                        >
                            <PanelRight className="w-3.5 h-3.5 text-white/70" />
                        </button>
                    )}
                    <ChatPanel
                        team={activeTeam}
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                        isLoading={isLoading}
                        error={error}
                        activeTeam={activeTeam}
                        setActiveTeam={handleTeamSwitch}
                        isDropdownOpen={isDropdownOpen}
                        setIsDropdownOpen={setIsDropdownOpen}
                        isLoadingHistory={isLoadingHistory}
                        isStreaming={isStreaming}
                        streamingThinking={streamingThinking}
                        streamingResponse={streamingResponse}
                        isThinkingOpen={isThinkingOpen}
                        onToggleThinking={() => setIsThinkingOpen(!isThinkingOpen)}
                        onStop={handleStop}
                        isStopped={isStopped}
                    />
                </main>

                <div className="md:hidden fixed bottom-0 inset-x-0 h-[56px] flex items-center justify-around px-4 z-50"
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        backdropFilter: 'blur(20px)',
                        borderTop: '1px solid rgba(255,255,255,0.08)'
                    }}
                >
                    <button
                        onClick={() => handleTeamSwitch('red')}
                        className={cn(
                            "flex flex-col items-center justify-center py-1 px-4 gap-1 rounded-lg transition-colors flex-1 max-w-[120px]",
                            activeTeam === "red" ? "text-white" : "text-white/50"
                        )}
                    >
                        <Shield className="w-5 h-5" />
                        <span className="font-['Syne'] font-medium text-[0.65rem]">Red</span>
                    </button>
                    <button
                        onClick={() => handleTeamSwitch('blue')}
                        className={cn(
                            "flex flex-col items-center justify-center py-1 px-4 gap-1 rounded-lg transition-colors flex-1 max-w-[120px]",
                            activeTeam === "blue" ? "text-white" : "text-white/50"
                        )}
                    >
                        <Code2 className="w-5 h-5" />
                        <span className="font-['Syne'] font-medium text-[0.65rem]">Blue</span>
                    </button>
                </div>
            </div>
        </div>
    );
}