// frontend/app/page.tsx
'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { Send, User, Cpu, Copy, AlertTriangle, CornerDownLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string; // Add an ID for better keying
  role: 'user' | 'assistant' | 'error';
  text: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const textareaRef = useRef<null | HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${scrollHeight}px`;
    }
  }, [input]);

  const handleSend = async (e?: FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userInput: Message = { id: Date.now().toString(), role: 'user', text: input };
    setMessages((prev) => [...prev, userInput]);
    setInput('');
    setIsLoading(true);

    // Ensure textarea resizes down after sending
    setTimeout(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, 0);

    try {
      const res = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_message: userInput.text }), // Send original input text
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: 'Unknown server error' }));
        throw new Error(errorData.detail || `Error: ${res.status}`);
      }

      const { reply } = await res.json();
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: reply }]);
    } catch (error: any) {
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: 'error', text: error.message || 'Failed to connect to the assistant.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Optional: show a temporary "Copied!" message
    }).catch(err => console.error('Failed to copy: ', err));
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto bg-white dark:bg-slate-800 shadow-xl">
      {/* Header (Optional) */}
      <header className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">AI Assistant</h1>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50 dark:bg-slate-900/50">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-slate-500 dark:text-slate-400 pt-10">
            <Cpu size={48} className="mx-auto mb-2" />
            <p className="text-lg font-medium">Welcome!</p>
            <p>Ask me anything to get started.</p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex animate-fadeInUp ${
              m.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-xl shadow-sm ${
                m.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : m.role === 'assistant'
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none relative group'
                  : 'bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300 rounded-bl-none flex items-center gap-2'
              }`}
            >
              {m.role === 'error' && <AlertTriangle size={18} className="flex-shrink-0" />}
              <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                {/* Using ReactMarkdown for assistant and error messages */}
                {m.role === 'user' ? m.text : <ReactMarkdown>{m.text}</ReactMarkdown>}
              </div>
              {m.role === 'assistant' && (
                <button
                  onClick={() => copyToClipboard(m.text)}
                  className="absolute -top-2 -right-2 p-1 bg-slate-200 dark:bg-slate-600 rounded-full text-slate-500 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Copy message"
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] p-3 rounded-xl shadow-sm bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none">
              <div className="flex items-center space-x-1">
                <span className="text-sm text-slate-500 dark:text-slate-400">Assistant is typing</span>
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-dotFlashing"></div>
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-dotFlashing-delay1"></div>
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-dotFlashing-delay2"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <form onSubmit={handleSend} className="flex items-end space-x-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask me anything…"
            className="flex-1 p-3 border border-slate-300 dark:border-slate-600 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none dark:bg-slate-700 dark:text-slate-100 min-h-[48px] max-h-[150px] overflow-y-auto"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed h-[48px] flex items-center justify-center"
            aria-label="Send message"
          >
            <Send size={20} />
          </button>
        </form>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 text-center">
          Press <kbd className="px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 rounded-sm text-xs">Shift</kbd> + <kbd className="px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 rounded-sm text-xs">Enter</kbd> for a new line.
        </p>
      </footer>
    </div>
  );
}