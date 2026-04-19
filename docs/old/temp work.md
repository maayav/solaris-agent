Here's exactly what you need to do manually, in order:

---

## 1. Neo4j Aura
1. Go to [console.neo4j.io](https://console.neo4j.io)
2. Sign up → Create free AuraDB instance
3. **Immediately download/copy the credentials** — password is shown only once
4. Save: `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`

---

## 2. Qdrant Cloud
1. Go to [cloud.qdrant.io](https://cloud.qdrant.io)
2. Sign up → Create free cluster → pick region closest to your Railway deployment
3. Go to API Keys → Generate key
4. Save: `QDRANT_URL`, `QDRANT_API_KEY`

---

## 3. Upstash Redis
1. Go to [console.upstash.com](https://console.upstash.com)
2. Sign up → Create database → **enable TLS**
3. Copy the `rediss://` connection string (not the `redis://` one)
4. Save: `REDIS_URL`

---

## 4. Cloudflare Tunnel (Ollama)
1. Go to [cloudflare.com](https://cloudflare.com) → sign up free
2. In PowerShell:
```powershell
winget install Cloudflare.cloudflared
cloudflared login
cloudflared tunnel create vibecheck-ollama
```
3. If you have a domain on Cloudflare:
```powershell
cloudflared tunnel route dns vibecheck-ollama ollama.yourdomain.com
```
4. If no domain, use quick tunnel for now:
```powershell
cloudflared tunnel --url http://localhost:11434
```
5. Save: `OLLAMA_BASE_URL`

---

## 5. Railway
1. Go to [railway.app](https://railway.app) → sign up → connect GitHub
2. Add your $5 plan
3. Create new project → deploy from GitHub repo
4. Go to Variables → add all env vars from the plan
5. Save: nothing new, just paste everything you collected above

---

## 6. OpenRouter (for prod LLM fallback)
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up → Keys → Create key
3. Add some credits (pay as you go, no subscription)
4. Save: `OPENROUTER_API_KEY`

---

## Checklist

```
[ ] Neo4j Aura   — signed up, instance created, credentials saved
[ ] Qdrant Cloud — signed up, cluster created, API key saved
[ ] Upstash      — signed up, Redis created with TLS, URL saved
[ ] Cloudflare   — signed up, tunnel created, Ollama URL saved
[ ] Railway      — signed up, repo connected, all env vars added
[ ] OpenRouter   — signed up, API key saved, credits added
```

Once all 6 are checked off, hand the env vars to your agent and it can wire everything up.