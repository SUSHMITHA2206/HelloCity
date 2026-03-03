HelloCity – AI-Powered Interest Onboarding

Mobile web onboarding flow that collects 3 interests about what the user likes to do in Miami, shows real venue examples for each, and outputs a structured profile. Built for the HelloCity Engineering Exercise.



Quick start (run locally)

1. Backend

cd server
npm install

Set your OpenAI API key (PowerShell):

$env:OPENAI_API_KEY="sk-your-key-here"

Start the server:

npm run dev

Backend runs at http://localhost:4000.
 Health check: http://localhost:4000/api/health

2. Frontend

In a second terminal:

cd client
npm install
npm run dev

Open http://localhost:5173 in a browser (use a phone-sized view or real device for best UX).

3. Try the flow

- Type interests like "live music", "rooftop bars", "beach" (or "food", "art galleries", "farmers market").
- After each detected interest you'll see 3 real Miami examples and Yes / No.
- After 3 interests, the Your Miami interests profile section appears with a line-by-line list.
- Use Restart to run the flow again without refreshing.



Stack

Backend  - Node.js, Express, in-memory session store
Frontend - React, TypeScript, Vite
LLM      - OpenAI API (gpt-4.1-mini) for conversation + interest extraction
Fallback - Keyword-based interest extraction when no API key or when LLM doesn't return an interest



LLM and reasoning vs backend logic

LLM (reasoning):
- Generates the assistant's reply.
- Returns at most one interest candidate per user message (e.g. "Live jazz", "Rooftop bars").
- No access to session state beyond what we send in the prompt; does not decide completion.

Backend (deterministic logic):
- Owns session state: interests[], completed.
- Adds an interest only if not already present (normalized).
- Marks complete when interests.length >= 3.
- Selects 3 Miami examples from a curated catalog per interest.
- Builds the final profile { interests: [...] } and returns it when complete.
- Returns the same 3 examples for a repeated interest so the UI keeps showing cards and Yes/No.

So: reasoning = "what did they mean?" and "what to say?"; backend = "how many interests?", "done yet?", "which examples?", "what's the profile?".



What's included

Backend:
- Session create + message endpoints.
- LLM integration (reply + interest extraction) with JSON parsing and fallback.
- Heuristic interest extraction (e.g. food, live music, beach, rooftop, art, farmers market).
- Curated Miami venue catalog with name, neighborhood, address, description, hours, image URL.
- Duplicate handling; examples still returned when user repeats an interest.

Frontend:
- Mobile-first chat UI with HelloCity-style header and progress (e.g. "1 of 3 interests captured").
- Assistant and user bubbles; example cards with images and Yes/No.
- Final profile shown as a line-by-line list inside "Your Miami interests profile".
- Restart button after onboarding (replaces Send); starts a new session without page refresh.
- Single warm theme (cream/peach/amber).

Config:
- Backend: PORT, OPENAI_API_KEY.
- Frontend: VITE_API_BASE_URL (default http://localhost:4000 for local dev).



 

Project layout

HelloCity/
├── server/          # Express API (sessions, LLM, examples, profile)
│   ├── index.js
│   └── package.json
├── client/          # React + Vite app (chat UI, cards, profile, Restart)
│   ├── src/
│   └── package.json
└── README.md



Deploying

- Backend: e.g. Render/Railway – root server, start node index.js, set OPENAI_API_KEY and PORT.
- Frontend: e.g. Vercel – root client, build npm run build, output dist, set VITE_API_BASE_URL to your backend URL.

After deploy, open the frontend URL; the app will call your backend for sessions and messages.
