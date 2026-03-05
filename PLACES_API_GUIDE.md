# Step-by-step: Add live Miami places from an API

This guide walks you through using **Foursquare Places API** so HelloCity shows real Miami venues instead of static data.

---

## Step 1: Get a Foursquare API key (about 2 minutes)

1. Go to **https://foursquare.com/developer/** and sign in (or create a free account).
2. Click **Create a new project** (or open an existing project).
3. Open **Project settings** → **API keys**.
4. Click **Generate API Key** (or "Additional API Key"). Give it a name like "HelloCity".
5. **Copy the key** and store it somewhere safe. You won’t see it again in full.

---

## Step 2: Add the key to your backend

1. Open **server/.env** in your project.
2. Add this line (use your real key):

   ```
   FOURSQUARE_API_KEY=your-actual-key-here
   ```

3. Save the file.  
   If no `.env` exists, create it in the **server** folder with the line above.

---

## Step 3: How it works in the app

- When a user mentions a Miami interest (e.g. "tacos", "beaches"), the LLM calls the **search_places** tool.
- The backend calls **Foursquare Place Search** with a query derived from that interest (e.g. "mexican restaurant", "beach") and `near=Miami, FL`, `limit=3`.
- The 3 results are normalized to the same shape as before (name, address, description, image if available) and returned to the LLM, which then replies to the user. The UI shows these as the “Curated Miami ideas” cards.

If **FOURSQUARE_API_KEY** is not set, the app keeps using the built-in static catalog so nothing breaks.

---

## Step 4: Run and test

1. **Start the backend** (from project root or `server/`):

   ```bash
   cd server
   npm run dev
   ```

2. **Start the frontend** (in another terminal):

   ```bash
   cd client
   npm run dev
   ```

3. Open **http://localhost:5173** and say something like:
   - "I love tacos"
   - "Beaches"
   - "Live jazz"

4. You should see **3 real Miami places** from Foursquare in the cards (and the same flow if you use Yes/No).

---

## Step 5: Optional – try another provider

The same pattern works with other place APIs:

- **Google Places API (New)** — Same data as Google search (e.g. padel clubs, sushi). Enable **Places API (New)** in Google Cloud Console, create an API key, add `GOOGLE_PLACES_API_KEY=...` to **server/.env**. The app tries Foursquare first, then Google if Foursquare is missing or returns no results.

- **Google Places API (Text Search)**  
  - Get a key in Google Cloud Console, enable Places API.  
  - Call the Text Search endpoint with `query` + `location` (Miami).  
  - Map the response to `name`, `address`, `description`, `photo` (using the photo reference URL).

- **Yelp Fusion API**  
  - Get an app at https://www.yelp.com/developers.  
  - Use “Search” with `location=Miami, FL` and `term` from the interest.  
  - Map results to the same card fields.

You can add a second provider (e.g. `GOOGLE_PLACES_API_KEY`) and in code prefer one when its key is set, with a fallback to the other or to the static catalog.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Still seeing static places | Ensure `FOURSQUARE_API_KEY` is in **server/.env**, no typos, and restart the server. |
| "Places API error" in server logs | Confirm the key is valid and the Foursquare project has Places API access. |
| No images on cards | Foursquare may require a separate photo request; the code can use a default image when `imageUrl` is missing. |
| Rate limits | Foursquare free tier has limits; if you hit them, you’ll see errors in the server console. |

---

## Summary

1. Get a Foursquare API key and put it in **server/.env** as `FOURSQUARE_API_KEY=...`.  
2. Restart the server; the **search_places** tool will use Foursquare when the key is set.  
3. Test by mentioning Miami interests in the chat and confirm the 3 place cards come from the API.
