# Farcaster Rock-Paper-Scissors Frame

Minimal Frame server supporting Bot and PvP modes with placeholder wallet connect.

## Setup

1. Node 18+
2. Install deps:

```
npm install
```

3. Create `.env`:

```
PUBLIC_URL=http://localhost:3000
PORT=3000
NEYNAR_API_KEY=replace_me
BASE_CONNECT_URL=https://wallet.coinbase.com/
ARB_CONNECT_URL=https://portal.arbitrum.io/
```

4. Dev server:

```
npm run dev
```

Open the root URL in a Farcaster client (or test with `curl`).

## Notes
- Replace images in `public/images/` with PNGs matching names referenced in `src/index.ts`.
- Add signature verification using Neynar in the POST handlers before trusting `fid`.
- Use a persistent store (Redis/DB) for real matches.

## Deploy (Render)

1. Commit and push to GitHub.
2. Click "New +" → "Web Service" → Connect repo.
3. Settings:
   - Environment: Node
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Node runtime: 18+
   - Add env vars: `NEYNAR_API_KEY`, `PUBLIC_URL`, `BASE_CONNECT_URL`, `ARB_CONNECT_URL`
4. First deploy will give you `https://your-service.onrender.com`.
5. Set `PUBLIC_URL` to that URL, save, and redeploy.
6. Health check: `https://your-service.onrender.com/health`

One-click: this repo includes `render.yaml` and `Procfile`.

## Push to GitHub (quick)

```
git init
git add .
git commit -m "init rps frame"
# create new empty repo on GitHub first, then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```
