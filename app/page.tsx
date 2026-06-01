'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/* ── Inline markdown renderer ── */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = /\*\*([^*]+)\*\*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, m.index)}</span>);
    }
    parts.push(<strong key={`b${m.index}`}>{m[1]}</strong>);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

function renderMarkdown(content: string): React.ReactNode[] {
  return content.split('\n').map((line, i) => {
    if (line.trim() === '---') return <hr key={i} />;
    if (line.startsWith('### ')) return <p key={i} className="md-h3">{renderInline(line.slice(4))}</p>;
    if (line.startsWith('## '))  return <p key={i} className="md-h3">{renderInline(line.slice(3))}</p>;
    if (line.trim() === '')      return <div key={i} className="md-empty" />;
    return <p key={i}>{renderInline(line)}</p>;
  });
}

/* ── Shared search pill (full + compact) ── */
const PILL_WRAP: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  backgroundColor: 'white',
  borderRadius: '9999px',
  width: '100%',
};

const PILL_INPUT: React.CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: '#1a1a1a',
  fontFamily: 'inherit',
  minWidth: 0,
  cursor: 'text',
};

function pillBtn(disabled: boolean): React.CSSProperties {
  return {
    backgroundColor: '#2d6a4f',
    color: 'white',
    border: 'none',
    borderRadius: '9999px',
    fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  };
}

const DROPDOWN: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: '8px',
  backgroundColor: 'white',
  borderRadius: '16px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  zIndex: 1000,
  overflow: 'hidden',
};

/* ── Page ── */
export default function Home() {
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug]         = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasContent = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!hasContent) inputRef.current?.focus();
  }, [hasContent]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSug(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function handleInputChange(value: string) {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) { setSuggestions([]); setShowSug(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value)}&limit=5&autocomplete=1`
        );
        const data = await res.json();
        const labels: string[] = (data.features ?? []).map(
          (f: { properties: { label: string } }) => f.properties.label
        );
        setSuggestions(labels);
        setShowSug(labels.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }

  function selectSuggestion(label: string) {
    setInput(label);
    setSuggestions([]);
    setShowSug(false);
    handleSearch(label);
  }

  function resetAll() {
    setMessages([]);
    setInput('');
    setSuggestions([]);
    setShowSug(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /* Always replaces results (fresh search each time) */
  const handleSearch = useCallback(async (address: string) => {
    if (isLoading || !address.trim()) return;
    setIsLoading(true);
    setShowSug(false);
    setSuggestions([]);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: address.trim(),
    };
    setMessages([userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMsg] }),
      });
      if (!res.ok) throw new Error(`${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');

      const dec = new TextDecoder();
      let assistantMsg: ChatMessage | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        if (!chunk) continue;

        if (!assistantMsg) {
          assistantMsg = { id: `assistant-${Date.now()}`, role: 'assistant', content: chunk };
          setMessages(prev => [...prev, assistantMsg!]);
        } else {
          assistantMsg.content += chunk;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...assistantMsg! };
            return updated;
          });
        }
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Erreur lors de la recherche. Vérifiez votre adresse et réessayez.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  /* ── Shared autocomplete dropdown ── */
  function Dropdown() {
    if (!showSug || suggestions.length === 0) return null;
    return (
      <div style={DROPDOWN}>
        {suggestions.map((s, i) => (
          <div
            key={i}
            onClick={() => selectSuggestion(s)}
            style={{
              padding: '12px 20px',
              cursor: 'pointer',
              fontSize: '15px',
              color: '#1a1a1a',
              borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
              backgroundColor: 'white',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
          >
            {s}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="app">

      {/* ══ HERO — full ══ */}
      {!hasContent && (
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-heading">
              <h1>Explorez les transactions immobilières.</h1>
              <p className="hero-sub">Base DVF · Données officielles DGFiP</p>
            </div>
            <div ref={wrapRef} style={{ position: 'relative', maxWidth: '700px', width: '100%', margin: '0 auto' }}>
              <div style={{ ...PILL_WRAP, padding: '6px 6px 6px 24px' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); setShowSug(false); handleSearch(input); }
                    if (e.key === 'Escape') { setShowSug(false); }
                  }}
                  placeholder="10 Rue de la Paix, 75002 Paris"
                  disabled={isLoading}
                  autoFocus
                  autoComplete="off"
                  style={{ ...PILL_INPUT, fontSize: '16px' }}
                />
                <button
                  onClick={() => { setShowSug(false); handleSearch(input); }}
                  disabled={isLoading || !input.trim()}
                  style={{ ...pillBtn(isLoading || !input.trim()), padding: '12px 28px', fontSize: '15px' }}
                >
                  {isLoading && <span className="spinner" />}
                  Rechercher
                </button>
              </div>
              <Dropdown />
            </div>
          </div>
        </section>
      )}

      {/* ══ HERO — compact ══ */}
      {hasContent && (
        <section className="hero hero--compact">
          <div className="hero-inner">
            <div ref={wrapRef} style={{ position: 'relative', maxWidth: '700px', width: '100%', margin: '0 auto' }}>
              <div style={{ ...PILL_WRAP, padding: '5px 5px 5px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onFocus={e => e.currentTarget.select()}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); setShowSug(false); handleSearch(input); }
                    if (e.key === 'Escape') { setShowSug(false); }
                  }}
                  placeholder="Nouvelle adresse…"
                  disabled={isLoading}
                  autoComplete="off"
                  style={{ ...PILL_INPUT, fontSize: '15px' }}
                />
                <button
                  onClick={() => { setShowSug(false); handleSearch(input); }}
                  disabled={isLoading || !input.trim()}
                  style={{ ...pillBtn(isLoading || !input.trim()), padding: '10px 22px', fontSize: '14px' }}
                >
                  {isLoading && <span className="spinner" />}
                  Rechercher
                </button>
              </div>
              <Dropdown />
            </div>
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button
                onClick={resetAll}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '2px 0',
                }}
              >
                Nouvelle recherche
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ══ RESULTS ══ */}
      {hasContent && (
        <main className="content animate-fade-in">
          <div className="content-inner">

            {messages.map((msg, i) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="animate-fade-in">
                    <div className="result-query">
                      <span className="result-query-label">Adresse recherchée</span>
                      <span className="result-query-text">{msg.content}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className="animate-fade-in">
                  <div className="result-body">
                    {renderMarkdown(msg.content)}
                  </div>
                  {i < messages.length - 1 && <hr className="result-sep" />}
                </div>
              );
            })}

            {isLoading && messages.at(-1)?.role === 'user' && (
              <div className="typing-dots animate-fade-in">
                <div className="typing-dot-group">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
                <span>Analyse en cours…</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>
      )}

      {/* ══ FOOTER ══ */}
      <footer className="footer">
        <p className="footer-text">Données DVF · DGFiP · Décalage de mise à jour ~6 mois</p>
      </footer>

    </div>
  );
}
