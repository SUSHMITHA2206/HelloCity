import { useEffect, useState } from "react";
import "./App.css";

type Message = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
};

type ExampleCard = {
  name: string;
  neighborhood?: string;
  address?: string;
  description?: string;
  hours?: string;
  imageUrl?: string;
};

type SessionState = {
  interests: string[];
  completed: boolean;
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [examples, setExamples] = useState<ExampleCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [completedProfile, setCompletedProfile] = useState<{
    interests: string[];
  } | null>(null);

  useEffect(() => {
    startSession();
  }, []);

  async function startSession() {
    try {
      setIsLoading(true);
      setCompletedProfile(null);
      setExamples([]);
      const res = await fetch(`${API_BASE}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      setSessionState(data.state);
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: data.message,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages([
        {
          id: "error",
          role: "system",
          text: "We’re having trouble starting your session. Please check that the backend is running on http://localhost:4000.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestart() {
    setInput("");
    await startSession();
  }

  async function sendToBackend(payload: {
    message?: string;
    feedback?: "yes" | "no";
  }) {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      const nextMessages: Message[] = [];
      if (payload.message) {
        nextMessages.push({
          id: `user-${Date.now()}`,
          role: "user",
          text: payload.message,
        });
      }
      if (typeof payload.feedback === "string") {
        nextMessages.push({
          id: `feedback-${Date.now()}`,
          role: "user",
          text:
            payload.feedback === "yes"
              ? "Yes, that’s what I meant."
              : "No, that’s not quite right.",
        });
      }
      if (data.assistantMessage) {
        nextMessages.push({
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: data.assistantMessage,
        });
      } else if (res.ok) {
        nextMessages.push({
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: "Got it — try again in a moment, or tell me something else you're into!",
        });
      }

      setMessages((prev) => [...prev, ...nextMessages]);
      setSessionState(data.state);
      setExamples(data.examples || []);

      if (data.completed && data.profile) {
        setCompletedProfile(data.profile);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "system",
          text: "Something went wrong talking to HelloCity. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading || !sessionId) return;
    const text = input.trim();
    setInput("");
    await sendToBackend({ message: text });
  }

  function handleFeedback(choice: "yes" | "no") {
    if (!sessionId || isLoading) return;
    // Keep current examples visible but send feedback to help the assistant progress.
    sendToBackend({ feedback: choice });
  }

  const headerSubtitle =
    sessionState && sessionState.interests.length > 0
      ? `${sessionState.interests.length} of 3 interests captured`
      : "Tell Hello what you love to do in Miami";

  return (
    <div className="hc-root">
      <div className="hc-shell">
        <header className="hc-header">
          <div className="hc-brand">
            <div className="hc-logo-icon" aria-hidden>
              <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="64" height="64" rx="14" fill="var(--hc-yellow)" />
                <path d="M 18 42 Q 32 54 46 42" stroke="#000" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="24" cy="30" r="5" fill="#000" />
                <polygon points="40,24 40,40 52,32" fill="#FFFFFF" />
              </svg>
            </div>
            <div>
              <div className="hc-logo-text">
                <span className="hc-logo-hello">Hello</span>
                <span className="hc-logo-city">City</span>
              </div>
              <div className="hc-logo-subtitle">{headerSubtitle}</div>
            </div>
          </div>
        </header>

        <main className="hc-main">
          <section className="hc-chat-window">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`hc-message-row hc-message-row-${m.role}`}
              >
                {m.role === "assistant" && (
                  <div className="hc-avatar">H</div>
                )}
                <div
                  className={`hc-bubble hc-bubble-${m.role}`}
                  dangerouslySetInnerHTML={{ __html: m.text }}
                />
              </div>
            ))}

            {examples.length > 0 && (
              <section className="hc-examples-section">
                <div className="hc-section-label">
                  Curated Miami ideas for this interest
                </div>
                <div className="hc-examples-grid">
                  {examples.map((card, idx) => (
                    <article className="hc-example-card" key={idx}>
                      {card.imageUrl && (
                        <div className="hc-example-image">
                          <img src={card.imageUrl} alt={card.name} />
                        </div>
                      )}
                      <div className="hc-example-body">
                        <h3 className="hc-example-title">{card.name}</h3>
                        <p className="hc-example-meta">
                          {[card.neighborhood, card.address]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {card.description && (
                          <p className="hc-example-description">
                            {card.description}
                          </p>
                        )}
                        {card.hours && (
                          <p className="hc-example-hours">
                            Hours: {card.hours}
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="hc-example-actions">
                  <button
                    type="button"
                    className="hc-button hc-button-primary"
                    onClick={() => handleFeedback("yes")}
                    disabled={isLoading}
                  >
                    Yes, that’s what I meant
                  </button>
                  <button
                    type="button"
                    className="hc-button hc-button-secondary"
                    onClick={() => handleFeedback("no")}
                    disabled={isLoading}
                  >
                    No
                  </button>
                </div>
              </section>
            )}

            {completedProfile && (
              <section className="hc-profile-section">
                <h2>Your Miami interests profile</h2>
                <div className="hc-profile-box">
                  <ul className="hc-profile-list">
                    {completedProfile.interests.map((interest) => (
                      <li key={interest}>{interest}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </section>
        </main>

        <form className="hc-input-bar" onSubmit={handleSend}>
          <input
            className="hc-input"
            placeholder={
              completedProfile
                ? "Onboarding complete. Refresh to start again."
                : "Tell Hello what you’re into…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || !!completedProfile}
          />
          {completedProfile ? (
            <button
              type="button"
              className="hc-restart-button"
              onClick={handleRestart}
              disabled={isLoading}
            >
              {isLoading ? "…" : "Restart"}
            </button>
          ) : (
          <button
            type="submit"
            className="hc-send-button"
            disabled={!input.trim() || isLoading || !!completedProfile}
            aria-label="Send"
          >
            {isLoading ? (
              "…"
            ) : (
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="hc-send-arrow">
                <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="#000000" />
              </svg>
            )}
          </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default App;
