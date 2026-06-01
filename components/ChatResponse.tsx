'use client';

import React from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponseProps {
  messages: ChatMessage[];
  loading?: boolean;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(
      <strong key={`b-${match.index}`} className="font-semibold">
        {match[1]}
      </strong>
    );
    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

function renderContent(content: string): React.ReactNode[] {
  return content.split('\n').map((line, i) => {
    if (line.trim() === '---') {
      return <hr key={i} className="border-slate-200 my-2" />;
    }
    if (line.startsWith('### ')) {
      return (
        <p key={i} className="font-semibold text-slate-800 text-sm mt-3 mb-0.5 first:mt-0">
          {renderInline(line.slice(4))}
        </p>
      );
    }
    if (line.startsWith('## ')) {
      return (
        <p key={i} className="font-bold text-slate-800 text-base mt-3 mb-1 first:mt-0">
          {renderInline(line.slice(3))}
        </p>
      );
    }
    if (line.trim() === '') {
      return <div key={i} className="h-1.5" />;
    }
    return (
      <p key={i} className="leading-relaxed">
        {renderInline(line)}
      </p>
    );
  });
}

const AgentAvatar = () => (
  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-blue-500/30">
    <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
      <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
    </svg>
  </div>
);

export function ChatResponse({ messages, loading = false }: ChatResponseProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-6 flex flex-col">

      {/* Empty state */}
      {messages.length === 0 && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
            </svg>
          </div>
          <div>
            <p className="text-base font-semibold text-slate-700">Prêt à explorer</p>
            <p className="text-sm text-slate-400 mt-1.5 max-w-xs leading-relaxed">
              Entrez une adresse française à gauche pour consulter l'historique des transactions immobilières DVF.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs text-slate-400 bg-white rounded-xl border border-slate-100 px-5 py-3.5 shadow-sm">
            <p className="font-medium text-slate-500 mb-0.5">Données disponibles</p>
            <p>✓ Prix de vente et date</p>
            <p>✓ Surface et nombre de pièces</p>
            <p>✓ Prix au m² calculé</p>
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-4">
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex items-start animate-fade-in ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && <AgentAvatar />}

              <div
                className={`max-w-[78%] rounded-2xl px-5 py-3.5 text-sm shadow-sm ${
                  message.role === 'user'
                    ? 'ml-10 bg-gradient-to-br from-blue-500 to-violet-500 text-white rounded-br-sm shadow-blue-500/20'
                    : 'ml-2.5 bg-white text-slate-700 rounded-bl-sm border border-slate-100'
                }`}
              >
                {message.role === 'user' ? (
                  <p className="leading-relaxed">{message.content}</p>
                ) : (
                  <div className="leading-relaxed space-y-0.5 text-[13px]">
                    {renderContent(message.content)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex items-start justify-start animate-fade-in">
              <AgentAvatar />
              <div className="ml-2.5 bg-white rounded-2xl rounded-bl-sm border border-slate-100 px-5 py-4 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '160ms' }} />
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading before any message */}
      {messages.length === 0 && loading && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-start justify-start animate-fade-in">
            <AgentAvatar />
            <div className="ml-2.5 bg-white rounded-2xl rounded-bl-sm border border-slate-100 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '160ms' }} />
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '320ms' }} />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
