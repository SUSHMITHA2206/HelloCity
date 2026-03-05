const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = require("cross-fetch");

// Load .env from server directory so it works when run from project root or server/
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

/**
 * LLM + deterministic logic (for evaluation):
 *
 * 1. FLOW: UI → Backend. Backend loads session message history, appends new user
 *    message, builds messages for the LLM. Backend calls LLM (with tools). If the
 *    LLM requests a tool (search_places), backend runs the tool, appends tool
 *    results to messages, and calls the LLM again. Backend saves messages to
 *    session and sends reply + examples to the UI.
 *
 * 2. TOOLS: search_places(interest) returns 3 Miami venues from the catalog.
 *    The LLM is instructed to call it when the user mentions a Miami interest.
 *
 * 3. CONVERSATIONAL RESPONSES: A real LLM (Groq or OpenAI) generates every
 *    assistant reply. When tools are not used, the legacy callLLM path still
 *    returns reply + interestCandidate (JSON); heuristics are used when the LLM
 *    is unavailable or returns no candidate.
 *
 * 4. DETERMINISTIC BACKEND: Session state, deduplication, catalog lookup
 *    (findExamplesForInterest), completion after 3 interests, and heuristic
 *    fallback are all deterministic.
 */

/**
 * In-memory session store. Shape:
 * { interests, completed, createdAt, lastAssistantMessage?, messages?: [{ role, content?, tool_calls?, ... }] }
 * messages: full history for LLM (user + assistant + tool results).
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
    categories: ["indian", "indian cuisine", "indian food", "indian restaurants"],
    name: "Bombay Darbar",
    neighborhood: "Coconut Grove",
    address: "2915 McFarlane Rd, Coconut Grove, FL 33133",
    description: "Upscale Indian restaurant with North and South Indian dishes, tandoori, and curries.",
    hours: "Daily 11:30am–10:30pm",
    imageUrl: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["indian", "indian cuisine", "indian food", "indian restaurants"],
    name: "Ghee Indian Kitchen",
    neighborhood: "Wynwood",
    address: "896 SW 2nd Ave, Miami, FL 33130",
    description: "Modern Indian kitchen with seasonal ingredients and a creative take on classic dishes.",
    hours: "Tue–Sun 5pm–10pm",
    imageUrl: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=400&q=80"
  },
  {
    categories: ["indian", "indian cuisine", "indian food", "indian restaurants"],
    name: "Ayesha's Kitchen",
    neighborhood: "Brickell",
    address: "901 Brickell Plaza, Miami, FL 33131",
    description: "Indian and Indo-Chinese favorites, biryanis, and vegetarian options in a casual setting.",
    hours: "Daily 11am–10pm",
    imageUrl: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=400&q=80"
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

  // Only return places that actually match. Do not show unrelated catalog entries
  // (e.g. do not show Mexican restaurants when the user asked for Japanese).
  if (matches.length === 0) {
    return [];
  }

  return matches.slice(0, 3);
}

/** Map our interest labels to Foursquare search queries (Miami). */
const INTEREST_TO_QUERY = {
  "Food & dining": "restaurant",
  "Beaches": "beach",
  "Shopping": "shopping",
  "Mexican restaurants": "mexican restaurant",
  "Indian restaurants": "indian restaurant",
  "Stand-up comedy": "comedy club",
  "Movies": "movie theater",
  "Water activities": "boat tour",
  "Art": "art museum",
  "Concerts": "concert venue",
  "Live jazz": "jazz club",
  "Rooftop bars": "rooftop bar",
  "Art galleries": "art gallery",
  "Farmers markets": "farmers market"
};

const MIAMI_NEAR = "Miami, FL";
const DEFAULT_PLACE_IMAGE = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=400&q=80";

/**
 * Fetch up to 3 places from Foursquare Places API.
 * searchQuery: free-form search from LLM (e.g. "indian restaurant", "sushi") or a category label.
 */
async function fetchPlacesFromFoursquare(searchQuery) {
  const apiKey = process.env.FOURSQUARE_API_KEY;
  if (!apiKey) return [];

  const query = INTEREST_TO_QUERY[searchQuery] || String(searchQuery).toLowerCase() || "things to do";
  const params = new URLSearchParams({
    near: MIAMI_NEAR,
    query,
    limit: "3",
    fields: "name,location,description"
  });

  try {
    const res = await fetch(
      `https://api.foursquare.com/v3/places/search?${params}`,
      {
        method: "GET",
        headers: {
          Authorization: apiKey,
          Accept: "application/json"
        }
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[HelloCity] Foursquare API error:", res.status, data);
      return [];
    }
    const results = data.results || data.places || data.data || [];
    if (!Array.isArray(results)) return [];
    return results.slice(0, 3).map((p) => {
      const loc = p.location || {};
      const address = loc.formatted_address || [loc.address, loc.locality, loc.region]
        .filter(Boolean)
        .join(", ");
      return {
        name: p.name || "Unnamed place",
        neighborhood: loc.locality || loc.region || undefined,
        address: address || undefined,
        description: p.description || undefined,
        imageUrl: p.imageUrl || DEFAULT_PLACE_IMAGE
      };
    });
  } catch (err) {
    console.error("[HelloCity] Foursquare fetch error:", err.message);
    return [];
  }
}

/**
 * Fetch up to 3 places from Google Places API (New) — same source as Google search results.
 * textQuery: e.g. "padel Miami", "sushi restaurant Miami"
 */
async function fetchPlacesFromGoogle(textQuery) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const query = String(textQuery).trim() || "things to do";
  const textQueryWithLocation = query.toLowerCase().includes("miami") ? query : `${query} Miami`;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.regularOpeningHours"
      },
      body: JSON.stringify({ textQuery: textQueryWithLocation })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[HelloCity] Google Places API error:", res.status, data?.error?.message || data);
      return [];
    }
    const places = data.places || [];
    if (!Array.isArray(places)) return [];
    return places.slice(0, 3).map((p) => {
      const name = p.displayName?.text || p.displayName || p.name || "Unnamed place";
      const address = p.formattedAddress || p.formatted_address || undefined;
      const rating = p.rating != null ? `${p.rating}★` : undefined;
      const count = p.userRatingCount != null ? `(${p.userRatingCount} reviews)` : undefined;
      const desc = [rating, count].filter(Boolean).join(" ");
      return {
        name,
        address,
        description: desc || undefined,
        imageUrl: DEFAULT_PLACE_IMAGE
      };
    });
  } catch (err) {
    console.error("[HelloCity] Google Places fetch error:", err.message);
    return [];
  }
}

function extractInterestHeuristically(message) {
  if (!message) return null;
  const text = message.toLowerCase();

  const patterns = [
    {
      label: "Indian restaurants",
      keywords: ["indian", "indian cuisine", "indian food", "curry", "curries", "biryani", "naan", "tandoori"]
    },
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

/** Derive a short place search query from the user message (e.g. "i love sushi" -> "sushi"). */
function deriveSearchQueryFromMessage(message) {
  if (!message || typeof message !== "string") return "";
  const stop = new Set(["i", "love", "like", "want", "find", "looking", "for", "in", "miami", "the", "a", "some", "me", "my", "to", "get", "have"]);
  const words = message.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1 && !stop.has(w));
  return words.length ? words.join(" ") : message.trim().toLowerCase().slice(0, 50);
}

/** True if the message is clearly just greeting/small talk — we should not search for places. */
function isGreetingOrSmallTalk(message) {
  if (!message || typeof message !== "string") return true;
  const t = message.toLowerCase().trim();
  const greetings = [
    "hello", "hi", "hey", "how are you", "how are u", "what's your name", "whats your name",
    "how's your day", "hows your day", "good morning", "good afternoon", "good evening",
    "nice to meet you", "who are you", "how do you do"
  ];
  if (greetings.some((g) => t === g || t.startsWith(g + " ") || t.includes(" " + g) || t.includes(g + " ") || t.includes(" " + g + " "))) return true;
  if (t.length <= 25 && !/\b(food|restaurant|beach|padel|sushi|indian|mexican|concert|art|shop|movie|comedy|water|jazz|rooftop|bar|cafe|cuisine|place|spot|things to do)\b/i.test(t)) return true;
  return false;
}

/** Different reply phrases per interest so responses don't sound the same. */
const INTEREST_REPLIES = {
  "Food & dining": "Good call — Miami has amazing food. Here are some spots you might like.",
  "Mexican restaurants": "Love it — tacos and margaritas in Miami hit different. Here are some ideas.",
  "Indian restaurants": "Indian food in Miami is great — here are some spots you might like.",
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
  // "What's your name?" / "Who are you?"
  if (/\b(what'?s|what is) your name\b/i.test(m) || /\bwho are you\b/i.test(m) || /\bwhat can you do\b/i.test(m)) {
    return "I'm Hello! 👋 I'm your AI assistant for HelloCity — I help you discover things to do in Miami, like food, beaches, concerts, and more. What would you like to explore?";
  }
  // "How old are you?"
  if (/\bhow old are you\b/i.test(m) || /\bwhen were you (made|created|born)\b/i.test(m)) {
    return "I don't have an age like humans — I'm Hello, your Miami guide, and I'm here whenever you need ideas! What do you like doing when you're out in the city?";
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
  // When we can't answer (no LLM): be honest and offer Miami as one option
  const offTopicPatterns = [
    /\bwhat('s| is) the (weather|time)\b/i,
    /\bwho (won|is|are)\b/i,
    /\btell me (a joke|about)\b/i,
    /\bhow (do i|can i)\s+(fix|make|get)\b/i,
    /\b(weather|sports scores?|news|politics|recipe)\b/i,
    /\bwhat do you think (about|of)\b/i,
    /\bdo you (know|like)\s+(about|that)\b/i
  ];
  const looksLikeGeneralQuestion = offTopicPatterns.some((p) => p.test(m));
  if (looksLikeGeneralQuestion) {
    return "I'd love to answer that — I'm having a quick hiccup right now. Try again in a moment and I'll respond like usual. Or ask me about things to do in Miami!";
  }
  // Default when we didn't match anything (fallback only — LLM would answer anything)
  return "I'm having a quick hiccup — try again in a moment, or tell me what you'd like to explore in Miami!";
}

/**
 * Call LLM (Groq or OpenAI) for:
 * 1. Conversational response to every user message.
 * 2. Structured extraction: interestCandidate or null.
 * Prefers Groq if GROQ_API_KEY is set; else OpenAI. Heuristics when neither is set.
 */
async function callLLM({ message, interests, lastAssistantMessage }) {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const provider = groqKey ? "groq" : openaiKey ? "openai" : null;
  if (!provider) {
    console.log("[HelloCity] No GROQ_API_KEY or OPENAI_API_KEY — using fallback");
    return {
      reply:
        "I’m having trouble reaching my AI right now. Tell me one thing you enjoy in Miami — like food, beaches, shopping, or live music — and I'll find some ideas for you.",
      interestCandidate: null
    };
  }

  const apiUrl = groqKey
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const apiKey = groqKey || openaiKey;
  const model = groqKey ? "llama-3.1-8b-instant" : "gpt-4.1-mini";

  const systemPrompt = `
You are Hello, a friendly AI assistant (like ChatGPT). You answer all kinds of questions — no limits. You are also the HelloCity guide for Miami: when the user talks about things to do in Miami, we use that to suggest real spots.

Answer every question the user asks:
- General knowledge, science, history, how things work — answer helpfully.
- "What's your name?", "How old are you?", "Who are you?" — answer naturally and warmly.
- Weather, sports, news, recipes, advice, coding, writing — answer as well as you can. If you don't know, say so briefly and offer to help with something else.
- When the question is about things to do in Miami (food, beaches, concerts, movies, etc.), acknowledge it and say you're finding ideas — and set interestCandidate to the matching category below. For any other message, set interestCandidate to null.
- Do NOT refuse to answer or redirect to Miami just because the question isn't about Miami. Answer the question first, fully. You may optionally add one short line at the end like "Want Miami ideas too? Just tell me what you're into!" only when it fits naturally.

Conversation style:
- Sound friendly, warm, and natural. Use contractions and everyday language.
- Reply length: as long as needed to answer well (a few sentences to a few paragraphs). For simple questions keep it short; for complex ones you can be more detailed.
- Use context (their interests, your last message) when they refer to "it", "that", etc.

Miami interests (only set interestCandidate when the user clearly mentions one of these):
Food & dining, Beaches, Shopping, Mexican restaurants, Indian restaurants, Stand-up comedy, Movies, Water activities, Art, Concerts, Live jazz, Rooftop bars, Art galleries, Farmers markets

Safety: Refuse harm, wrongdoing, or privacy invasion briefly; offer a safe alternative.

IMPORTANT: Always return a single JSON object, nothing else:
{
  "reply": "string, your full reply to the user",
  "interestCandidate": "string | null, one of the Miami categories above only if they mentioned it, else null"
}

Current collected interests: ${JSON.stringify(interests)}
${lastAssistantMessage ? `\nYour last message (for context): "${lastAssistantMessage}"` : ""}
`;

  const userPrompt = `User message: ${message}

Return ONLY the JSON object. No markdown, no code blocks, no extra text. Valid JSON only.`;

  async function callAPI(extraInstruction = "") {
    const finalUserPrompt = extraInstruction ? `${userPrompt}\n\n${extraInstruction}` : userPrompt;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserPrompt }
        ],
        temperature: 0.5
      })
    });
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return { response, data, content };
  }

  let result = await callAPI();
  let { response, data, content } = result;

  if (!response.ok) {
    console.error(`[HelloCity] ${provider} API error:`, response.status, data?.error?.message || data?.error || data);
    return {
      reply: getConversationalFallback(message),
      interestCandidate: null
    };
  }

  function parseReply(content) {
    let json = null;
    try {
      json = JSON.parse(content);
    } catch {
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
    return json && typeof json.reply === "string" ? json : null;
  }

  let json = parseReply(content);
  if (!json) {
    result = await callAPI("Important: Reply with ONLY a single JSON object, nothing else. No markdown fences.");
    if (result.response.ok) {
      content = result.content;
      json = parseReply(content);
    }
  }

  if (!json || typeof json.reply !== "string") {
    console.log("[HelloCity] API returned invalid/unparseable JSON — using fallback");
    return {
      reply: getConversationalFallback(message),
      interestCandidate: null
    };
  }

  console.log("[HelloCity] Response from: LLM (" + provider + ")");
  return {
    reply: json.reply,
    interestCandidate:
      typeof json.interestCandidate === "string" ? json.interestCandidate : null
  };
}

// --- Tool: search_places (LLM passes whatever the user asked for as the search query)
const SEARCH_PLACES_TOOL = {
  type: "function",
  function: {
    name: "search_places",
    description: "Get 3 Miami place suggestions. Call this when the user says what they want to do or find in Miami (e.g. indian cuisine, sushi, vegan cafe, beach, jazz club). Pass a short search query that describes exactly what they want — use their words or a natural search phrase, not a fixed list.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Short search query for places in Miami, e.g. 'indian restaurant', 'sushi', 'vegan cafe', 'beach', 'jazz club', 'rooftop bar'. Use whatever the user asked for."
        }
      },
      required: ["query"]
    }
  }
};

function runSearchPlacesTool(query) {
  const q = (query || "").trim() || "things to do";
  const apiKeyFoursquare = process.env.FOURSQUARE_API_KEY;
  const apiKeyGoogle = process.env.GOOGLE_PLACES_API_KEY;

  if (apiKeyFoursquare) {
    return fetchPlacesFromFoursquare(q).then(async (places) => {
      if (places.length > 0) return places;
      if (apiKeyGoogle) {
        const googlePlaces = await fetchPlacesFromGoogle(q);
        if (googlePlaces.length > 0) return googlePlaces;
      }
      return findExamplesForInterest(q);
    });
  }
  if (apiKeyGoogle) {
    return fetchPlacesFromGoogle(q).then((places) => {
      if (places.length > 0) return places;
      return findExamplesForInterest(q);
    });
  }
  return Promise.resolve(findExamplesForInterest(q));
}

/**
 * Flow: load history → build messages → call LLM → if tool_calls then run tool →
 * add tool results → call LLM again → return reply + examples.
 * Uses OpenAI/Groq chat completions with tools. Returns { reply, interestCandidate, examples }.
 */
async function callLLMWithTools({ apiUrl, apiKey, model, systemPrompt, messages, interests }) {
  const maxToolRounds = 3;
  let currentMessages = [...messages];
  let lastInterestFromTool = null;
  let examplesFromTool = [];

  for (let round = 0; round < maxToolRounds; round++) {
    const body = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...currentMessages],
      temperature: 0.5,
      tools: [SEARCH_PLACES_TOOL],
      tool_choice: "auto"
    };
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("[HelloCity] LLM API error:", response.status, data?.error?.message || data?.error);
      return { reply: null, interestCandidate: null, examples: [], error: true };
    }

    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) {
      return { reply: null, interestCandidate: null, examples: [], error: true };
    }

    const content = msg.content || "";
    const toolCalls = msg.tool_calls;

    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      currentMessages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls
      });
      for (const tc of toolCalls) {
        const id = tc.id;
        const name = tc.function?.name;
        const args = (() => {
          try {
            return JSON.parse(tc.function?.arguments || "{}");
          } catch {
            return {};
          }
        })();
        if (name === "search_places") {
          const places = await runSearchPlacesTool(args.query);
          lastInterestFromTool = args.query || lastInterestFromTool;
          examplesFromTool = places;
          currentMessages.push({
            role: "tool",
            tool_call_id: id,
            content: JSON.stringify(places)
          });
        }
      }
      continue;
    }

    return {
      reply: content,
      interestCandidate: lastInterestFromTool,
      examples: examplesFromTool,
      error: false
    };
  }

  return {
    reply: currentMessages.length ? "Here are some Miami ideas for you." : null,
    interestCandidate: lastInterestFromTool,
    examples: examplesFromTool,
    error: false
  };
}

app.post("/api/session/start", (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = {
    interests: [],
    completed: false,
    createdAt: Date.now(),
    messages: [
      { role: "assistant", content: "Hi, I'm Hello 👋 I'll help you discover great things to do in Miami. Tell me what you're into — food, beaches, shopping, stand-up comedy, movies, water activities, art, concerts, live music, or anything else you love doing in the city." }
    ]
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

  // Ensure message history exists (e.g. old sessions)
  if (!Array.isArray(session.messages)) {
    session.messages = [
      { role: "assistant", content: "Hi, I'm Hello 👋 I'll help you discover great things to do in Miami. Tell me what you're into — food, beaches, shopping, stand-up comedy, movies, water activities, art, concerts, live music, or anything else you love doing in the city." }
    ];
  }

  // Build messages for LLM: history + new user turn
  const apiMessages = [
    ...session.messages.map((m) => ({ role: m.role, content: m.content || "" })),
    { role: "user", content: userText }
  ];

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const provider = groqKey ? "groq" : openaiKey ? "openai" : null;
  const apiUrl = groqKey
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const apiKey = groqKey || openaiKey;
  const model = groqKey ? "llama-3.1-8b-instant" : "gpt-4.1-mini";

  const systemPromptWithTools = `You are Hello, a friendly AI assistant and HelloCity guide for Miami.
- Answer any question the user asks. Be warm and natural.
- When the user mentions something they want to do or find in Miami (e.g. padel, indian food, sushi, beach, jazz club), you MUST call the search_places tool with a short search query (e.g. "padel courts Miami", "indian restaurant", "sushi"). Do NOT write the query or any JSON in your message — only use the tool. The app will fetch places and show them as cards automatically. After the tool runs, reply with one short, friendly sentence (e.g. "Here are some spots in Miami!" or "Found a few ideas for you."). Never include {"query":"..."} or any technical text in your reply.
- If the tool returns no places, say briefly that you couldn't find any and suggest trying something else. Plain text only.
- For non-Miami or general chat, do not call the tool; just reply in plain text.
- Your reply to the user must always be plain text only: no JSON, no code, no {"query":...}, no diagnostic output.
Current collected interests: ${JSON.stringify(session.interests)}`;

  let reply;
  let llmInterest = null;
  let examples = [];
  let usedToolPath = false;

  if (provider) {
    const result = await callLLMWithTools({
      apiUrl,
      apiKey,
      model,
      systemPrompt: systemPromptWithTools,
      messages: apiMessages,
      interests: session.interests
    });
    if (!result.error && result.reply) {
      reply = result.reply;
      llmInterest = result.interestCandidate;
      examples = result.examples || [];
      usedToolPath = true;
      // If the LLM replied but didn't call the tool (or tool returned nothing), try fetching places from the user's message
      if (examples.length === 0 && userText.trim().length > 0 && !isGreetingOrSmallTalk(userText)) {
        const derivedQuery = deriveSearchQueryFromMessage(userText);
        if (derivedQuery) examples = await runSearchPlacesTool(derivedQuery);
      }
      // Remove any raw JSON leaked into the reply (e.g. {"query":"..."}) so the user never sees it
      reply = reply.replace(/\s*\{\s*"query"\s*:\s*"[^"]*"\s*\}\s*/g, "").trim();
      if (!reply) reply = "Here are some ideas for you.";
      // Save messages: append user turn + assistant reply
      session.messages.push({ role: "user", content: userText });
      session.messages.push({ role: "assistant", content: reply });
    }
  }

  if (reply == null) {
    try {
      const result = await callLLM({
        message: userText,
        interests: session.interests,
        lastAssistantMessage: session.lastAssistantMessage || null
      });
      reply = result.reply;
      llmInterest = result.interestCandidate;
      if (llmInterest) examples = findExamplesForInterest(llmInterest);
      session.messages.push({ role: "user", content: userText });
      session.messages.push({ role: "assistant", content: reply });
    } catch (err) {
      console.error("[HelloCity] LLM call threw:", err.message || err);
      const fallbackInterest = extractInterestHeuristically(userText);
      if (fallbackInterest) {
        llmInterest = fallbackInterest;
        examples = findExamplesForInterest(fallbackInterest);
        reply = (INTEREST_REPLIES[fallbackInterest] && examples.length > 0)
          ? INTEREST_REPLIES[fallbackInterest]
          : examples.length > 0
            ? "Nice — " + fallbackInterest + " is a great pick for Miami. Here are some ideas. Do any of these match what you had in mind?"
            : "I'm having a quick hiccup, but I heard you're into " + fallbackInterest + ". Try again in a moment and I'll find some Miami ideas for you!";
      } else {
        reply = getConversationalFallback(userText);
      }
      session.messages.push({ role: "user", content: userText });
      session.messages.push({ role: "assistant", content: reply });
    }
  }

  const interestCandidate =
    llmInterest || extractInterestHeuristically(userText);

  let newInterest = null;

  if (interestCandidate) {
    const normalizedCandidate = normalizeInterest(interestCandidate);
    const alreadyHas = session.interests.some(
      (i) => normalizeInterest(i) === normalizedCandidate
    );
    if (!alreadyHas) {
      session.interests.push(interestCandidate);
      newInterest = interestCandidate;
    }
    // Only fill cards from catalog when we did NOT use the tool path (e.g. no API key).
    // When the LLM was used with tools, cards come only from the tool — never from backend JSON/catalog.
    if (!usedToolPath && examples.length === 0) {
      examples = findExamplesForInterest(interestCandidate);
    }
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
  res.json({
    ok: true,
    llmConfigured: !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY),
    provider: process.env.GROQ_API_KEY ? "groq" : process.env.OPENAI_API_KEY ? "openai" : null
  });
});

app.listen(port, () => {
  const groq = !!process.env.GROQ_API_KEY;
  const openai = !!process.env.OPENAI_API_KEY;
  console.log(`HelloCity backend listening on http://localhost:${port}`);
  console.log(`LLM: ${groq ? "Groq" : openai ? "OpenAI" : "none (set GROQ_API_KEY or OPENAI_API_KEY in server/.env)"}`);
});

