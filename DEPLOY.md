# Deploy HelloCity

HelloCity has two parts: **backend** (Node/Express) and **frontend** (React/Vite). Deploy them separately, then connect the frontend to the backend URL.

---

## Option 1: Render (backend) + Vercel (frontend) — recommended

### 1. Deploy the backend on Render

1. Push your code to **GitHub** (if you haven’t already):
   ```bash
   git add .
   git commit -m "Ready for deploy"
   git push origin main
   ```

2. Go to **[render.com](https://render.com)** and sign in (or create an account).

3. **New** → **Web Service**.

4. Connect your GitHub repo and select the **HelloCity** repository.

5. **Configure the service:**
   - **Name:** `hellocity-api` (or any name).
   - **Root Directory:** leave empty (Render uses repo root).
   - **Runtime:** `Node`.
   - **Build Command:**  
     `cd server && npm install`
   - **Start Command:**  
     `cd server && node index.js`
   - **Instance type:** Free (or paid if you prefer).

6. **Environment variables** (under “Environment”):
   - `NODE_ENV` = `production`
   - `GROQ_API_KEY` = your Groq key (or `OPENAI_API_KEY` if you use OpenAI)
   - Optional: `FOURSQUARE_API_KEY`, `GOOGLE_PLACES_API_KEY` for live places
   - Do **not** upload your `.env` file; set each variable in the Render dashboard.

7. Click **Create Web Service**. Wait for the first deploy to finish.

8. Copy your backend URL, e.g. `https://hellocity-api.onrender.com` (no trailing slash).

---

### 2. Deploy the frontend on Vercel

1. Go to **[vercel.com](https://vercel.com)** and sign in (GitHub is easiest).

2. **Add New** → **Project** → import your **HelloCity** GitHub repo.

3. **Configure the project:**
   - **Root Directory:** click **Edit** and set to `client`.
   - **Framework Preset:** Vite (should be auto-detected).
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

4. **Environment variables:**
   - **Key:** `VITE_API_BASE_URL`  
   - **Value:** your backend URL from step 1, e.g. `https://hellocity-api.onrender.com`  
   - (No trailing slash. This is used at **build time** so the client talks to your API.)

5. Click **Deploy**. When it’s done, you’ll get a URL like `https://hellocity-xxx.vercel.app`.

6. Open that URL in your browser. The app will call your Render backend.

---

## Option 2: Railway (backend) + Vercel (frontend)

**Backend on Railway:**

1. Go to **[railway.app](https://railway.app)** and sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → select HelloCity.
3. In **Settings** for the service:
   - **Root Directory:** `server`
   - **Start Command:** `node index.js`
4. **Variables:** add `GROQ_API_KEY` (or `OPENAI_API_KEY`), and optionally `FOURSQUARE_API_KEY`, `GOOGLE_PLACES_API_KEY`.
5. Under **Settings** → **Networking**, create a **Public URL** and copy it.

**Frontend on Vercel:** Same as Option 1, but set `VITE_API_BASE_URL` to your Railway backend URL (e.g. `https://hellocity-api.up.railway.app`).

---

## Environment variables summary

| Variable | Where | Required |
|----------|--------|----------|
| `GROQ_API_KEY` or `OPENAI_API_KEY` | Backend (Render/Railway) | Yes (one of them) |
| `FOURSQUARE_API_KEY` | Backend | Optional (live places) |
| `GOOGLE_PLACES_API_KEY` | Backend | Optional (live places) |
| `VITE_API_BASE_URL` | Frontend (Vercel) | Yes — your backend URL |

---

## After deploy

- **Frontend URL:** Open it in the browser; use it as the main link to your app.
- **Backend URL:** Use only for `VITE_API_BASE_URL` and for debugging (e.g. `https://your-api.onrender.com/api/health`).
- **Sessions:** Stored in memory on the backend; they’re lost on restart. For production at scale, add Redis or a database later.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| "Failed to fetch" or network errors | Ensure `VITE_API_BASE_URL` is set on Vercel and points to your backend URL (no trailing slash). Redeploy the frontend after changing it. |
| Backend 500 or “Invalid session” | Check Render/Railway logs. Ensure `GROQ_API_KEY` or `OPENAI_API_KEY` is set correctly. |
| CORS errors | Backend already uses `cors()`; if your frontend domain is custom, you may need to restrict `origin` in `server/index.js`. |
| Render free tier sleeps | After ~15 min of no traffic, the free service sleeps. The first request after that can be slow (cold start). |
