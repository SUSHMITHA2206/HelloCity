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
 * LLM + deterministic logic (for evaluation):
 *
 * 1. CONVERSATIONAL RESPONSES: A real LLM (OpenAI) generates every assistant
 *    reply. The system prompt instructs it to respond naturally to each
 *    message (acknowledge, react, follow up). We pass the last assistant
 *    message as context so the LLM can handle "yes"/"no" and short replies.
 *
 * 2. STRUCTURED EXTRACTION: The LLM returns a single JSON object with
 *    "reply" (conversational text) and "interestCandidate" (one of our
 *    allowed categories or null). We parse and validate this; heuristics
 *    are used only when the LLM is unavailable or returns no candidate.
 *
 * 3. DETERMINISTIC BACKEND: Session state, deduplication, catalog lookup
 *    (findExamplesForInterest), completion after 3 interests, and
 *    heuristic fallback are all deterministic. The backend never invents
 *    interests—it only uses LLM output or keyword-based extraction.
 */

/**
 * In-memory session store. Shape: { [sessionId]: { interests, completed, createdAt, lastAssistantMessage? } }
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
    categories: ["art", "art galleries", "galleries", "museums", "contemporary art"],
    name: "Pérez Art Museum Miami (PAMM)",
    neighborhood: "Downtown / Museum Park",
    address: "1103 Biscayne Blvd, Miami, FL 33132",
    description: "Waterfront contemporary art museum with hanging gardens and Biscayne Bay views.",
    hours: "Thu–Tue 11am–6pm (late Thu)",
    imageUrl: "https://images.unsplash.com/photo-1558981033-0f142c1c6bb9?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["art", "art galleries", "galleries", "street art", "contemporary art", "murals"],
    name: "Wynwood Walls",
    neighborhood: "Wynwood",
    address: "2516 NW 2nd Ave, Miami, FL 33127",
    description: "Open‑air museum of large‑scale murals and rotating street art exhibits.",
    hours: "Daily 11am–7pm",
    imageUrl: "https://images.unsplash.com/photo-1508184964240-ee96bb9677a7?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["art", "art galleries", "galleries", "contemporary art"],
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
    categories: ["beach", "beaches", "beach activities", "outdoors"],
    name: "South Pointe Park Pier",
    neighborhood: "South Beach",
    address: "1 Washington Ave, Miami Beach, FL 33139",
    description: "Scenic pier and park at the southern tip of Miami Beach, perfect for sunset walks.",
    hours: "Daily 7am–10pm",
    imageUrl: "https://images.unsplash.com/photo-1469796466635-455ede028aca?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["beach", "beaches", "beach activities", "outdoors"],
    name: "Lummus Park",
    neighborhood: "South Beach",
    address: "1130 Ocean Dr, Miami Beach, FL 33139",
    description: "Iconic stretch of beach and park along Ocean Drive with volleyball courts and paths.",
    hours: "Daily, open 24 hours",
    imageUrl: "https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["beach", "beaches", "beach activities", "outdoors"],
    name: "Crandon Park Beach",
    neighborhood: "Key Biscayne",
    address: "6747 Crandon Blvd, Key Biscayne, FL 33149",
    description: "Family‑friendly beach with shallow water, cabanas, and nature trails.",
    hours: "Daily 8am–sunset",
    imageUrl: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["food", "dining", "restaurants", "seafood", "brunch"],
    name: "Glass & Vine",
    neighborhood: "Coconut Grove",
    address: "3390 Mary St, Coconut Grove, FL 33133",
    description: "Garden restaurant in Peacock Park with seafood, brunch, and bay views.",
    hours: "Daily 11am–10pm (brunch weekends)",
    imageUrl: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["food", "dining", "coffee", "cafes", "breakfast"],
    name: "All Day",
    neighborhood: "Downtown Miami",
    address: "1035 N Miami Ave, Miami, FL 33136",
    description: "Popular café and all-day restaurant with strong coffee and creative breakfast.",
    hours: "Daily 8am–4pm",
    imageUrl: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["shopping", "boutiques", "design district", "fashion"],
    name: "Miami Design District",
    neighborhood: "Design District",
    address: "140 NE 39th St, Miami, FL 33137",
    description: "Open-air district with luxury boutiques, art installations, and restaurants.",
    hours: "Varies by store, generally 10am–7pm",
    imageUrl: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["shopping", "shops", "outdoor mall", "Lincoln Road"],
    name: "Lincoln Road Mall",
    neighborhood: "South Beach",
    address: "Lincoln Rd, Miami Beach, FL 33139",
    description: "Pedestrian mall with shops, restaurants, and people-watching in the heart of South Beach.",
    hours: "Stores typically 10am–10pm",
    imageUrl: "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["shopping", "malls", "waterfront", "Bayside"],
    name: "Bayside Marketplace",
    neighborhood: "Downtown Miami",
    address: "401 Biscayne Blvd, Miami, FL 33132",
    description: "Waterfront marketplace with shops, eateries, and boat tours on Biscayne Bay.",
    hours: "Daily 10am–10pm",
    imageUrl: "https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["stand-up comedy", "comedy", "standup", "live comedy"],
    name: "Villain Theater",
    neighborhood: "Little Havana",
    address: "5865 SW 8th St, Miami, FL 33134",
    description: "Comedy theater with stand-up, improv, and sketch shows in a relaxed setting.",
    hours: "Shows Thu–Sun, check schedule",
    imageUrl: "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["stand-up comedy", "comedy", "standup", "live comedy"],
    name: "Miami Improv",
    neighborhood: "Coconut Grove",
    address: "3390 Mary St, Coconut Grove, FL 33133",
    description: "Comedy club hosting national and local stand-up acts in Coconut Grove.",
    hours: "Shows Wed–Sun",
    imageUrl: "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["movies", "cinema", "film", "theater"],
    name: "O Cinema South Beach",
    neighborhood: "South Beach",
    address: "1130 Washington Ave, Miami Beach, FL 33139",
    description: "Indie and arthouse cinema with curated films and special screenings.",
    hours: "Daily showtimes vary",
    imageUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["movies", "cinema", "film", "theater"],
    name: "Silverspot Cinema Brickell",
    neighborhood: "Brickell",
    address: "71 SW 12th St, Miami, FL 33130",
    description: "Upscale cinema with recliner seating, full bar, and current releases.",
    hours: "Daily, check showtimes",
    imageUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["water activities", "kayaking", "paddleboard", "paddleboarding", "boats", "Biscayne"],
    name: "Biscayne National Park Kayak & Eco Tours",
    neighborhood: "Homestead / Key Largo area",
    address: "9700 SW 328th St, Homestead, FL 33033",
    description: "Guided kayak and paddleboard tours in Biscayne Bay's mangrove and marine preserve.",
    hours: "Tours daily by reservation",
    imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["water activities", "boat tours", "cruises", "sightseeing", "Biscayne Bay"],
    name: "Island Queen Cruises",
    neighborhood: "Bayside",
    address: "401 Biscayne Blvd, Miami, FL 33132",
    description: "Sightseeing cruises on Biscayne Bay past Millionaires' Row and the skyline.",
    hours: "Multiple daily departures",
    imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["water activities", "cruises", "boat tours", "sailing", "sunset"],
    name: "Miami Sunset Cruises",
    neighborhood: "Miami Beach",
    address: "Various marinas",
    description: "Sunset and daytime sailing and cruise options from Miami Beach marinas.",
    hours: "Varies by operator",
    imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["concerts", "live music", "music venue", "shows"],
    name: "The Fillmore Miami Beach",
    neighborhood: "Miami Beach",
    address: "1700 Washington Ave, Miami Beach, FL 33139",
    description: "Historic concert venue hosting major touring acts, from rock to hip-hop to electronic.",
    hours: "Show nights only, check schedule",
    imageUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["concerts", "live music", "outdoor", "amphitheater"],
    name: "FPL Solar Amphitheater at Bayfront Park",
    neighborhood: "Downtown Miami",
    address: "301 N Biscayne Blvd, Miami, FL 33132",
    description: "Outdoor amphitheater on the bay for concerts and festivals.",
    hours: "Event-based",
    imageUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=400&q=80"
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
      label: "Food & dining",
      keywords: ["food", "restaurant", "restaurants", "dining", "eat", "eat out", "brunch", "breakfast", "lunch", "dinner", "seafood", "coffee", "cafe", "cafes"]
    },
    {
      label: "Mexican restaurants",
      keywords: ["mexican", "taco", "tacos", "mexican food"]
    },
    {
      label: "Beaches",
      keywords: ["beach", "beaches", "ocean", "swim", "sunbathe", "sand", "waterfront"]
    },
    {
      label: "Shopping",
      keywords: ["shopping", "shops", "boutiques", "mall", "malls", "design district", "lincoln road", "bayside", "fashion", "stores"]
    },
    {
      label: "Stand-up comedy",
      keywords: ["stand-up", "standup", "comedy", "comedian", "improv", "live comedy"]
    },
    {
      label: "Movies",
      keywords: ["movies", "movie", "cinema", "film", "films", "theater", "theatre", "watch a movie"]
    },
    {
      label: "Water activities",
      keywords: ["water activities", "water sports", "water games", "kayak", "kayaking", "paddleboard", "paddleboarding", "boat tour", "boat tours", "cruise", "cruises", "sailing", "sailboat", "fishing", "jet ski", "snorkel", "diving", "biscayne"]
    },
    {
      label: "Art",
      keywords: ["art", "galleries", "gallery", "museum", "museums", "street art", "contemporary art", "murals", "paintings", "sculpture"]
    },
    {
      label: "Live jazz",
      keywords: ["live jazz", "jazz", "live music"]
    },
    {
      label: "Concerts",
      keywords: ["concerts", "concert", "live music", "shows", "music venue", "amphitheater", "festival", "touring"]
    },
    {
      label: "Rooftop bars",
      keywords: ["rooftop", "rooftop bar", "rooftop bars"]
    },
    {
      label: "Art galleries",
      keywords: ["art gallery", "art galleries"]
    },
    {
      label: "Farmers markets",
      keywords: ["farmers market", "farmers markets", "market"]
    }
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => text.includes(kw))) {
      return pattern.label;
    }
  }

  return null;
}

/** Different reply phrases per interest so responses don't sound the same. */
const INTEREST_REPLIES = {
  "Food & dining": "Good call — Miami has amazing food. Here are some spots you might like.",
  "Mexican restaurants": "Love it — tacos and margaritas in Miami hit different. Here are some ideas.",
  "Beaches": "Can't go wrong with the beach here. Here are some Miami beach spots for you.",
  "Shopping": "Miami shopping is top-tier. Here are some places to check out.",
  "Stand-up comedy": "Comedy nights in Miami are a blast. Here are some venues to try.",
  "Movies": "Miami has some great cinemas — indie spots and big screens. Here are a few ideas.",
  "Water activities": "Water activities in Miami are unbeatable. Here are some options for you.",
  "Art": "Miami's art scene is huge — galleries, murals, museums. Here are some ideas.",
  "Live jazz": "Live music and jazz in Miami — here are some spots with great vibes.",
  "Concerts": "Miami's concert and live music scene is solid. Here are some venues.",
  "Rooftop bars": "Rooftop bars with views — very Miami. Here are some ideas.",
  "Art galleries": "Art galleries and museums here are worth a visit. Here are a few.",
  "Farmers markets": "Farmers markets in Miami are fun for a relaxed morning. Here are some."
};

/** Conversational fallback when LLM is unavailable or returns invalid JSON. */
function getConversationalFallback(userMessage) {
  if (!userMessage) {
    return "Tell me one thing you love doing in Miami — like food, beaches, water sports, or concerts!";
  }
  const m = userMessage.toLowerCase().trim();
  // If the message clearly indicates an interest, use an interest-specific phrase
  const interest = extractInterestHeuristically(userMessage);
  if (interest && INTEREST_REPLIES[interest]) {
    return INTEREST_REPLIES[interest];
  }
  if (interest) {
    return "Love that — " + interest + " sounds great for Miami! Here are some ideas for you.";
  }
  // Short exact greetings
  if (/^(hi|hey|hello|hii|hiya|howdy|yo)\s*!*$/.test(m) || /^(good\s+)?(morning|afternoon|evening)\s*!*\.*$/i.test(m)) {
    return "Hi there! 👋 Good to meet you. I'm here to help you discover things to do in Miami — what's one thing you love doing when you're out in the city?";
  }
  // "How are you?" (exact or with punctuation) — reply by answering the question only
  if (/^how\s+are\s+you\??\s*$/i.test(m)) {
    return "I'm doing great, thanks for asking! 👋 What's one thing you love doing when you're out in Miami?";
  }
  if (/^how('re|\s+is)\s+it\s+going\??\s*$/i.test(m)) {
    return "Going well, thanks! What's one thing you love doing in Miami?";
  }
  // Only say "Nice to meet you too" when they actually said nice to meet you
  if (/\bnice\s+to\s+meet\s+you\b/i.test(m) || /\bgood\s+to\s+meet\s+you\b/i.test(m)) {
    return "I'm doing great, thanks! Nice to meet you too 👋 What's one thing you love doing when you're out in Miami?";
  }
  // "How are you" with other text (e.g. "hii, how are you?") — answer the question, don't say "nice to meet you"
  if (/\bhow\s+are\s+you\b/i.test(m) || /\bhow'?s\s+it\s+going\b/i.test(m)) {
    return "I'm doing great, thanks for asking! 👋 What's one thing you love doing when you're out in Miami?";
  }
  if (/^(yes|yeah|yep|sure|ok|okay)\s*\.*!*\s*$/i.test(m)) {
    return "Great! What else do you enjoy? Pick something like food, beaches, shopping, or live music.";
  }
  if (/^(no|nope|not really)\s*\.*!*\s*$/i.test(m)) {
    return "No worries! Tell me something else you're into — art, movies, comedy, water sports, anything that sounds fun.";
  }
  // Thank you / thanks — respond like a human
  if (/\b(thank you|thanks|thankyou|thx|ty)\b/i.test(m) && m.length < 35) {
    return "You're welcome! Happy to help. If you want more Miami ideas, just tell me another thing you're into — or we can keep going with what we have.";
  }
  // Bye / goodbye
  if (/^(bye|goodbye|good bye|see you|later|take care)\s*!*\.*$/i.test(m)) {
    return "Bye! Have a great time in Miami. Come back anytime you want more ideas.";
  }
  // User clicked "Yes, that's what I meant" or "No" on the example cards (feedback from frontend)
  if (/user feedback:\s*yes/i.test(m) || /\byes, that matched what i meant\b/i.test(m)) {
    return "Awesome! What else do you enjoy? Pick another thing — food, beaches, movies, concerts, anything you like.";
  }
  if (/user feedback:\s*no/i.test(m) || /\bno, that wasn't quite right\b/i.test(m)) {
    return "No problem — what else are you into? Tell me something different and I'll find better ideas.";
  }
  // Off-topic or unrelated: polite human-like response, then ask what they want to explore
  const offTopicPatterns = [
    /\bwhat('s| is) the (weather|time)\b/i,
    /\bwho (won|is|are)\b/i,
    /\btell me (a joke|about)\b/i,
    /\bhow (do i|can i)\s+(fix|make|get)\b/i,
    /\b(weather|sports scores?|news|politics|recipe)\b/i,
    /\bwhat do you think (about|of)\b/i,
    /\bdo you (know|like)\s+(about|that)\b/i
  ];
  const looksOffTopic = offTopicPatterns.some((p) => p.test(m));
  if (looksOffTopic) {
    return "Sorry, I don't know much about that — I'm here to help you discover things to do in Miami. What would you like to explore? Food, beaches, movies, concerts, or something else?";
  }
  // Default: polite redirect as if we didn't quite get it
  return "I'm not sure about that one — I'm really here to help with things to do in Miami. What would you like to explore? Food, beaches, movies, concerts, or water sports?";
}

/**
 * Call OpenAI to:
 * 1. Conversational response: natural reply to every user message.
 * 2. Structured extraction: one interest category (interestCandidate) or null.
 * Heuristics are used only when the LLM is unavailable.
 */
async function callLLM({ message, interests, lastAssistantMessage }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback behavior if no key is configured.
    return {
      reply:
        "I’m having trouble reaching my AI right now. Tell me one thing you enjoy in Miami — like food, beaches, shopping, or live music — and I'll find some ideas for you.",
      interestCandidate: null
    };
  }

  const systemPrompt = `
You are Hello, an AI on-boarding assistant for HelloCity.

Your job:
- Respond to every message — no matter what the user says (thanks, bye, a question, an interest, small talk). You must always give a natural, human-like reply. Never ignore or give a generic non-answer.
- Respond in a conversational way: acknowledge what they said, react briefly (e.g. "Nice!", "Love that", "You're welcome!"), then add a short follow-up. Keep replies to 1–3 sentences, mobile-friendly.
- Have a short, friendly conversation about what they like to do in Miami. We support these common activities (use as interestCandidate when the user mentions them):
  - Food & dining (search: food, restaurants, dining, brunch, seafood, coffee, cafes)
  - Beaches (search: beach, beaches, ocean, swim, waterfront)
  - Shopping (search: shopping, boutiques, malls, design district, Lincoln Road, Bayside)
  - Mexican restaurants (search: mexican, tacos)
  - Stand-up comedy (search: comedy, standup, improv, live comedy)
  - Movies (search: movies, cinema, film, theater)
  - Water activities (search: water sports, water games, kayaking, paddleboard, boat tours, cruises, sailing, fishing)
  - Art (search: art, galleries, museums, street art, contemporary art, murals)
  - Concerts (search: concerts, live music, shows, music venue, amphitheater)
  - Live jazz (search: jazz, live music)
  - Rooftop bars (search: rooftop, rooftop bar)
  - Art galleries (search: art, galleries, museums)
  - Farmers markets (search: farmers market, markets)
- Gently guide them to mention one clear interest from the list above, or something similar. Keep responses short and mobile friendly (1–3 sentences).
- When the user has already given 1 or 2 interests, you can briefly reference them to keep the conversation natural (e.g. "So we have beaches and movies so far — what's one more thing you're into?").

CRITICAL — Be conversational and varied:
- For greetings or small talk ("Hello", "hi", "how are you", "hey"): respond in a warm, natural way (e.g. "Hi there! 👋 Good to meet you. What do you like doing when you're out in Miami?" or "I'm great, thanks! Ready to find some cool stuff for you. What's one thing you enjoy in the city?"). Set interestCandidate to null. Never use the same generic line for every message.
- For clear interests: acknowledge specifically what they said, then say you're finding ideas or that you've noted it. Use different phrasing per interest (e.g. movies: "Miami has great cinemas — here are some ideas"; live music: "The music scene here is awesome — here are some spots"; beaches: "Can't beat the beach in Miami — here are a few spots"). Never use the same sentence for every interest.
- For "yes" or "no": respond in context of your last message (e.g. "Awesome!" or "No problem — what else do you like?"). Set interestCandidate appropriately or null.
- For off-topic or unrelated questions (e.g. weather, sports, general knowledge, something outside Miami activities): respond like a friendly human. Say politely that you don't know about that or can't help with it, then ask what they'd like to explore in Miami. Example: "Sorry, I don't know much about that — I'm here to help you discover things to do in Miami. What would you like to explore? Food, beaches, movies, concerts?" Set interestCandidate to null.
- For "thank you", "thanks", "bye", "goodbye": respond naturally (e.g. "You're welcome! Happy to help. Want more Miami ideas? Just tell me another thing you're into." or "Bye! Have a great time in Miami."). Set interestCandidate to null.
- Always tailor your reply to what the user actually said. Never reply with a single repeated phrase for every message.

IMPORTANT: You must always return a single JSON object (and nothing else) with this exact shape:
{
  "reply": "string, the message you say to the user",
  "interestCandidate": "string | null, a single concise interest category extracted from the user's latest message, or null if none is clear"
}

Rules for "interestCandidate":
- Base it on the MOST RECENT user message only.
- Use one of: "Food & dining", "Beaches", "Shopping", "Mexican restaurants", "Stand-up comedy", "Movies", "Water activities", "Art", "Concerts", "Live jazz", "Rooftop bars", "Art galleries", "Farmers markets" (or a close variant the user said).
- If the user mentions multiple ideas, pick the one that seems most actionable for going out in Miami.
- If the message is ambiguous, use null.

Current collected interests: ${JSON.stringify(interests)}
${lastAssistantMessage ? `\nYour last message to the user (for context when they say "yes", "no", or short replies): "${lastAssistantMessage}"` : ""}
`;

  const userPrompt = `User message: ${message}

Return ONLY the JSON object. No markdown, no explanation. Valid JSON only.`;

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
      reply: getConversationalFallback(message),
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
      "Hi, I’m Hello 👋 I’ll help you discover great things to do in Miami. Tell me what you're into — food, beaches, shopping, stand-up comedy, movies, water activities, art, concerts, live music, or anything else you love doing in the city."
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

  let reply;
  let llmInterest = null;
  try {
    const result = await callLLM({
      message: userText,
      interests: session.interests,
      lastAssistantMessage: session.lastAssistantMessage || null
    });
    reply = result.reply;
    llmInterest = result.interestCandidate;
  } catch (err) {
    console.error("HelloCity LLM error:", err);
    const fallbackInterest = extractInterestHeuristically(userText);
    if (fallbackInterest) {
      llmInterest = fallbackInterest;
      const fallbackExamples = findExamplesForInterest(fallbackInterest);
      reply = (INTEREST_REPLIES[fallbackInterest] && fallbackExamples.length > 0)
        ? INTEREST_REPLIES[fallbackInterest]
        : fallbackExamples.length > 0
          ? "Nice — " + fallbackInterest + " is a great pick for Miami. Here are some ideas. Do any of these match what you had in mind?"
          : "I'm having a quick hiccup, but I heard you're into " + fallbackInterest + ". Try again in a moment and I'll find some Miami ideas for you!";
    } else {
      reply = getConversationalFallback(userText);
    }
  }

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

  session.lastAssistantMessage = reply;

  res.json(responsePayload);
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`HelloCity backend listening on http://localhost:${port}`);
});

