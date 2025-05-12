// frontend/app/page.tsx
'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import Image from 'next/image'; // Import Next.js Image component
import { Send, User, Cpu, Copy, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
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

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }, 0);

    try {
      const res = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_message: userInput.text }),
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
    navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy: ', err));
  };

  return (
    <div className="relative flex flex-col h-screen max-w-3xl mx-auto bg-white dark:bg-slate-900 shadow-xl overflow-hidden"> {/* Added overflow-hidden */}
      {/* Cat Image - Decorative Top Right */}
      <div className="absolute top-3 right-3 sm:top-5 sm:right-5 z-0 opacity-50 pointer-events-none"> {/* z-0, pointer-events-none */}
        <Image 
          src="/cat.png" 
          alt="" // Decorative image, empty alt
          width={70} // Adjust size as needed
          height={70} 
          className="rounded-full" // Optional styling
        />
      </div>

      {/* Header with Logo */}
      <header className="relative z-10 p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-center sm:justify-start">
        <Image 
          src="/logo.svg" 
          alt="AI Assistant Logo" 
          width={150} // Adjust as per your logo's aspect ratio
          height={35} 
          priority // Good for LCP elements
        />
      </header>

      {/* Messages Area */}
      <main 
        className={`flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900/70 relative z-10 
                   ${messages.length === 0 && !isLoading ? 'flex flex-col' : 'space-y-4'}`}
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex-grow flex flex-col justify-center items-center text-center text-slate-500 dark:text-slate-400 pb-16"> {/* Added pb-16 to push it up slightly from absolute center */}
            <Cpu size={52} className="mx-auto mb-5 text-slate-400 dark:text-slate-500" />
            <p className="text-xl font-medium mb-1.5">Welcome!</p>
            <p className="text-base">Ask me anything to get started.</p>
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
              className={`max-w-[80%] p-3.5 rounded-2xl shadow-md ${ // Increased rounding and padding slightly
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-lg' // Sharper corner for "tail"
                  : m.role === 'assistant'
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-lg relative group' // Sharper corner for "tail"
                  : 'bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300 rounded-bl-lg flex items-center gap-2' // Sharper corner for "tail"
              }`}
            >
              {m.role === 'error' && <AlertTriangle size={18} className="flex-shrink-0" />}
              <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed"> {/* Added leading-relaxed */}
                {m.role === 'user' ? m.text : <ReactMarkdown>{m.text}</ReactMarkdown>}
              </div>
              {m.role === 'assistant' && (
                <button
                  onClick={() => copyToClipboard(m.text)}
                  className="absolute -top-2.5 -right-2.5 p-1.5 bg-slate-200 dark:bg-slate-600 rounded-full text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all duration-150"
                  aria-label="Copy message"
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start animate-fadeInUp">
            <div className="max-w-[80%] p-3.5 rounded-2xl shadow-md bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-lg">
              <div className="flex items-center space-x-1.5">
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
      <footer className="relative z-10 p-3 sm:px-4 sm:pb-4 sm:pt-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"> {/* Added more horizontal padding via sm:px-4 */}
        <form onSubmit={handleSend} className="flex items-end space-x-2 sm:space-x-3">
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
            placeholder="Message AI Assistant…"
            className="flex-1 p-3.5 border border-slate-300 dark:border-slate-600 rounded-xl // Changed to rounded-xl (was 2xl, button is also xl)
                       resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 
                       dark:focus:border-blue-500 outline-none dark:bg-slate-700 dark:text-slate-100 
                       min-h-[52px] max-h-[150px] overflow-y-auto transition-shadow duration-150 focus:shadow-md" // Increased min-h, added focus:shadow
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-3 bg-blue-600 text-white rounded-xl // Consistent rounding with textarea
                       hover:bg-blue-700 focus:outline-none focus:ring-2 
                       focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-opacity-75 
                       disabled:opacity-60 disabled:cursor-not-allowed 
                       h-[52px] w-[52px] flex items-center justify-center transition-all duration-150 flex-shrink-0" // Made button square, increased height
            aria-label="Send message"
          >
            <Send size={22} /> {/* Slightly larger icon */}
          </button>
        </form>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2.5 text-center">
          Press <kbd className="px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 rounded text-xs font-mono bg-slate-50 dark:bg-slate-700">Shift</kbd> + <kbd className="px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 rounded text-xs font-mono bg-slate-50 dark:bg-slate-700">Enter</kbd> for a new line.
        </p>
      </footer>
    </div>
  );
}