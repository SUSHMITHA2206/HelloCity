const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const fetch = require("cross-fetch");

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

/**
 * In-memory session store.
 * Shape:
 * {
 *   [sessionId]: {
 *     interests: string[],
 *     completed: boolean,
 *     createdAt: number
 *   }
 * }
 */
const sessions = {};

// Simple catalog of real Miami venues / experiences keyed by coarse category.
const miamiCatalog = [
  {
    categories: ["mexican", "tacos", "mexican food", "mexican restaurants"],
    name: "Coyo Taco Wynwood",
    neighborhood: "Wynwood",
    address: "2320 NW 2nd Ave, Miami, FL 33127",
    description: "Casual taqueria with late-night hours, a hidden bar, and a lively Wynwood vibe.",
    hours: "Most days 12pm–11pm (later on weekends)",
    imageUrl: "https://images.unsplash.com/photo-1608038509085-7bb9d5c0a4cc?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["mexican", "tacos", "mexican food", "mexican restaurants"],
    name: "Bakan Wynwood",
    neighborhood: "Wynwood",
    address: "2801 NW 2nd Ave, Miami, FL 33127",
    description: "Upscale Mexican spot with a huge mezcal list and open-air patio filled with cacti.",
    hours: "Daily 12pm–12am",
    imageUrl: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["mexican", "tacos", "mexican food", "mexican restaurants"],
    name: "Taquerias El Mexicano",
    neighborhood: "Little Havana",
    address: "521 SW 8th St, Miami, FL 33130",
    description: "Neighborhood classic in Little Havana serving Mexico City–style tacos and margaritas.",
    hours: "Daily 11am–11pm",
    imageUrl: "https://images.unsplash.com/photo-1543353071-873f17a7a088?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["live jazz", "jazz", "music", "live music"],
    name: "Lagniappe",
    neighborhood: "Edgewater",
    address: "3425 NE 2nd Ave, Miami, FL 33137",
    description: "Wine garden with nightly live jazz and a relaxed backyard feel.",
    hours: "Daily 7pm–2am",
    imageUrl: "https://images.unsplash.com/photo-1519677100203-a0e668c92439?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["live jazz", "jazz", "music", "live music"],
    name: "The Corner",
    neighborhood: "Downtown Miami",
    address: "1035 N Miami Ave, Miami, FL 33136",
    description: "Late-night cocktail bar that often hosts live jazz and experimental sets.",
    hours: "Evenings until very late",
    imageUrl: "https://images.unsplash.com/photo-1543008973-2ecaaedac10c?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["live jazz", "jazz", "music", "live music"],
    name: "Ball & Chain",
    neighborhood: "Little Havana",
    address: "1513 SW 8th St, Miami, FL 33135",
    description: "Historic Calle Ocho bar with live Latin and jazz music under a pineapple stage.",
    hours: "Most days afternoon–late night",
    imageUrl: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["rooftop", "rooftop bar", "bars", "skyline", "cocktails"],
    name: "Higher Ground at Arlo Wynwood",
    neighborhood: "Wynwood",
    address: "2217 NW Miami Ct, Miami, FL 33127",
    description: "Lush rooftop bar with craft cocktails and skyline views over Wynwood.",
    hours: "Afternoons–late night",
    imageUrl: "https://images.unsplash.com/photo-1504274066651-8d31a536b11a?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["rooftop", "rooftop bar", "bars", "skyline", "cocktails"],
    name: "Sugar at EAST Miami",
    neighborhood: "Brickell",
    address: "788 Brickell Plaza, Miami, FL 33131",
    description: "Iconic 40th‑floor rooftop with tropical garden vibes and panoramic Brickell views.",
    hours: "Evenings–late night",
    imageUrl: "https://images.unsplash.com/photo-1536964549204-655d2a431434?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["rooftop", "rooftop bar", "bars", "skyline", "cocktails"],
    name: "Serena Rooftop",
    neighborhood: "South Beach",
    address: "915 Collins Ct, Miami Beach, FL 33139",
    description: "Colorful rooftop restaurant and bar at the Moxy with Mexican‑inspired bites.",
    hours: "Afternoon–late night",
    imageUrl: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["art", "art galleries", "galleries", "museums"],
    name: "Pérez Art Museum Miami (PAMM)",
    neighborhood: "Downtown / Museum Park",
    address: "1103 Biscayne Blvd, Miami, FL 33132",
    description: "Waterfront contemporary art museum with hanging gardens and Biscayne Bay views.",
    hours: "Thu–Tue 11am–6pm (late Thu)",
    imageUrl: "https://images.unsplash.com/photo-1558981033-0f142c1c6bb9?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["art", "art galleries", "galleries", "street art"],
    name: "Wynwood Walls",
    neighborhood: "Wynwood",
    address: "2516 NW 2nd Ave, Miami, FL 33127",
    description: "Open‑air museum of large‑scale murals and rotating street art exhibits.",
    hours: "Daily 11am–7pm",
    imageUrl: "https://images.unsplash.com/photo-1508184964240-ee96bb9677a7?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["art", "art galleries", "galleries"],
    name: "Rubell Museum",
    neighborhood: "Allapattah",
    address: "1100 NW 23rd St, Miami, FL 33127",
    description: "One of the largest private contemporary art collections in North America.",
    hours: "Wed–Sun 10am–5:30pm",
    imageUrl: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["farmers market", "markets", "local food"],
    name: "Coconut Grove Saturday Organic Market",
    neighborhood: "Coconut Grove",
    address: "3300 Grand Ave, Miami, FL 33133",
    description: "Long‑running Saturday market with organic produce and prepared vegan foods.",
    hours: "Sat 10am–7pm",
    imageUrl: "https://images.unsplash.com/photo-1498601761256-1b0e929dcd34?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["farmers market", "markets", "local food"],
    name: "Legion Park Farmers Market",
    neighborhood: "Morningside",
    address: "6447 NE 7th Ave, Miami, FL 33138",
    description: "Waterfront farmers market with local vendors, pastries, and coffee.",
    hours: "Sat 9am–2pm",
    imageUrl: "https://images.unsplash.com/photo-1498601761256-1b0e929dcd34?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["beach", "beach activities", "outdoors"],
    name: "South Pointe Park Pier",
    neighborhood: "South Beach",
    address: "1 Washington Ave, Miami Beach, FL 33139",
    description: "Scenic pier and park at the southern tip of Miami Beach, perfect for sunset walks.",
    hours: "Daily 7am–10pm",
    imageUrl: "https://images.unsplash.com/photo-1469796466635-455ede028aca?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["beach", "beach activities", "outdoors"],
    name: "Lummus Park",
    neighborhood: "South Beach",
    address: "1130 Ocean Dr, Miami Beach, FL 33139",
    description: "Iconic stretch of beach and park along Ocean Drive with volleyball courts and paths.",
    hours: "Daily, open 24 hours",
    imageUrl: "https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["beach", "beach activities", "outdoors"],
    name: "Crandon Park Beach",
    neighborhood: "Key Biscayne",
    address: "6747 Crandon Blvd, Key Biscayne, FL 33149",
    description: "Family‑friendly beach with shallow water, cabanas, and nature trails.",
    hours: "Daily 8am–sunset",
    imageUrl: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=400&q=80"
  }
];

function normalizeInterest(raw) {
  if (!raw) return "";
  return raw.toLowerCase().trim();
}

function findExamplesForInterest(interestLabel) {
  const normalized = normalizeInterest(interestLabel);
  // Try direct category match.
  let matches = miamiCatalog.filter((item) =>
    item.categories.some((c) => normalized.includes(c))
  );

  // Fallback: fuzzy includes.
  if (matches.length === 0) {
    matches = miamiCatalog.filter((item) =>
      item.categories.some((c) => c.includes(normalized) || normalized.includes(c))
    );
  }

  // If still nothing, just pick three diverse examples.
  if (matches.length === 0) {
    matches = miamiCatalog.slice(0, 3);
  }

  return matches.slice(0, 3);
}

function extractInterestHeuristically(message) {
  if (!message) return null;
  const text = message.toLowerCase();

  const patterns = [
    {
      label: "Mexican restaurants",
      keywords: ["mexican", "taco", "tacos", "food", "restaurant", "restaurants", "eat", "dining"]
    },
    {
      label: "Live jazz",
      keywords: ["live jazz", "jazz", "live music"]
    },
    {
      label: "Rooftop bars",
      keywords: ["rooftop", "rooftop bar", "rooftop bars"]
    },
    {
      label: "Art galleries",
      keywords: ["art gallery", "art galleries", "gallery", "galleries", "museum"]
    },
    {
      label: "Farmers markets",
      keywords: ["farmers market", "farmers markets", "market"]
    },
    {
      label: "Beach activities",
      keywords: ["beach", "ocean", "swim", "sunbathe"]
    }
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => text.includes(kw))) {
      return pattern.label;
    }
  }

  return null;
}

/**
 * Call OpenAI to:
 * - Respond conversationally as a friendly HelloCity on-boarding assistant.
 * - Extract at most one structured interest from the latest user input.
 */
async function callLLM({ message, interests }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback behavior if no key is configured.
    return {
      reply:
        "I’m having trouble reaching my AI brain right now, but based on what you said, tell me one thing you enjoy doing when you go out in the city.",
      interestCandidate: null
    };
  }

  const systemPrompt = `
You are Hello, an AI on-boarding assistant for HelloCity.

Your job:
- Have a short, friendly conversation about what the user likes to do when going out in the city (specifically Miami).
- Gently guide them to mention clear, concrete interests such as "Mexican restaurants", "live jazz", "rooftop bars", "art galleries", "farmers markets", or "beach activities".
- Keep responses short and mobile friendly (1–3 sentences).

IMPORTANT: You must always return a single JSON object (and nothing else) with this exact shape:
{
  "reply": "string, the message you say to the user",
  "interestCandidate": "string | null, a single concise interest category extracted from the user's latest message, or null if none is clear"
}

Rules for "interestCandidate":
- Base it on the MOST RECENT user message only.
- Keep it short and generic, e.g. "Mexican restaurants", "live jazz", "rooftop bars", "art galleries", "farmers markets", "beach activities".
- If the user mentions multiple ideas, pick the one that seems most actionable for going out in Miami.
- If the message is ambiguous, use null.

Current collected interests: ${JSON.stringify(interests)}
`;

  const userPrompt = `
User message:
${message}

Return ONLY the JSON object. No markdown, no explanation. Ensure valid JSON.
`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.5
    })
  });

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";

  let json = null;
  try {
    // Try to parse as pure JSON.
    json = JSON.parse(content);
  } catch {
    // Fallback: attempt to extract JSON substring.
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        json = JSON.parse(content.slice(start, end + 1));
      } catch {
        // ignore
      }
    }
  }

  if (!json || typeof json.reply !== "string") {
    return {
      reply:
        "Let’s keep this simple — tell me one thing you love doing when you go out in Miami, like rooftop bars or live music.",
      interestCandidate: null
    };
  }

  return {
    reply: json.reply,
    interestCandidate:
      typeof json.interestCandidate === "string" ? json.interestCandidate : null
  };
}

app.post("/api/session/start", (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = {
    interests: [],
    completed: false,
    createdAt: Date.now()
  };

  res.json({
    sessionId,
    state: sessions[sessionId],
    message:
      "Hi, I’m Hello 👋 I’ll help you discover great things to do in Miami. To start, tell me one thing you enjoy when you go out in the city."
  });
});

app.post("/api/session/:sessionId/message", async (req, res) => {
  const { sessionId } = req.params;
  const { message, feedback } = req.body || {};

  const session = sessions[sessionId];
  if (!session) {
    return res.status(400).json({ error: "Invalid session. Please refresh to start over." });
  }

  if (session.completed) {
    return res.json({
      sessionId,
      state: session,
      assistantMessage:
        "You’re all set! Here’s your Miami interests profile. If you’d like to restart, refresh the page.",
      examples: [],
      profile: {
        interests: session.interests
      },
      completed: true
    });
  }

  // If the user just clicked Yes/No, we still treat it as a turn but likely won't get a new interest.
  const userText = typeof message === "string" && message.trim().length > 0
    ? message.trim()
    : feedback
    ? `User feedback: ${feedback === "yes" ? "Yes, that matched what I meant." : "No, that wasn’t quite right."}`
    : "";

  const { reply, interestCandidate: llmInterest } = await callLLM({
    message: userText,
    interests: session.interests
  });

  // If the LLM couldn't give us a clear interest (or is unavailable),
  // fall back to simple keyword-based extraction so the flow still progresses.
  const interestCandidate =
    llmInterest || extractInterestHeuristically(userText);

  let newInterest = null;
  let examples = [];

  if (interestCandidate) {
    const normalizedCandidate = normalizeInterest(interestCandidate);
    const alreadyHas = session.interests.some(
      (i) => normalizeInterest(i) === normalizedCandidate
    );
    if (!alreadyHas) {
      session.interests.push(interestCandidate);
      newInterest = interestCandidate;
    }
    // Always return examples for this interest so the UI keeps showing the cards (and Yes/No).
    examples = findExamplesForInterest(interestCandidate);
  }

  if (session.interests.length >= 3) {
    session.completed = true;
  }

  const responsePayload = {
    sessionId,
    state: session,
    assistantMessage: reply,
    newInterest,
    examples,
    completed: session.completed
  };

  if (session.completed) {
    responsePayload.profile = { interests: session.interests };
  }

  res.json(responsePayload);
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`HelloCity backend listening on http://localhost:${port}`);
});

