// frontend/app/page.tsx
'use client';

import { useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const send = async () => {
    if (!input.trim()) return;
    const next = [...messages, { role: 'user', text: input }];
    setMessages(next);
    setInput('');

    const res = await fetch('http://localhost:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_message: input }),
    });

    const { reply } = await res.json();
    setMessages([...next, { role: 'assistant', text: reply }]);
  };

  return (
    <main className="flex flex-col h-screen p-4">
      <section className="flex-1 overflow-y-auto space-y-2">
        {messages.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'text-blue-500' : 'text-green-500'}>
            <strong>{m.role}:</strong> {m.text}
          </p>
        ))}
      </section>

      <section className="flex pt-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          className="flex-1 border rounded p-2"
          placeholder="Ask me anything…"
        />
        <button onClick={send} className="ml-2 border rounded px-3">
          Send
        </button>
      </section>
    </main>
  );
}
