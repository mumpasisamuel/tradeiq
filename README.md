# 🚀 TradeIQ — Guide de Déploiement Complet

## Architecture
```
App React  →  Vercel  (interface utilisateur)
Bot Python →  Railway (ordres automatiques 24h/24)
               ↕
           Binance API (crypto)
           Alpaca API  (actions/forex)
```

---

## 📁 Structure du projet
```
tradeiq/
├── frontend/          → App React (Vercel)
│   ├── src/App.js
│   ├── public/index.html
│   └── package.json
├── backend/           → Bot Python (Railway)
│   ├── app.py
│   ├── requirements.txt
│   └── Procfile
└── vercel.json
```

---

## 🔧 ÉTAPE 1 — Préparer GitHub

1. Crée un compte sur https://github.com
2. Crée un nouveau repository "tradeiq"
3. Upload tous les fichiers dedans

---

## 🖥️ ÉTAPE 2 — Déployer le Backend sur Railway

1. Va sur https://railway.app
2. Crée un compte gratuit
3. Clique "New Project" → "Deploy from GitHub"
4. Sélectionne ton repo "tradeiq" → dossier "backend"
5. Ajoute les variables d'environnement :

```
BINANCE_API_KEY     = ta_clé_binance
BINANCE_API_SECRET  = ton_secret_binance
PAPER_TRADING       = true
BOT_ENABLED         = false
TRADING_SYMBOL      = BTCUSDT
TRADING_STYLE       = day
TRADING_QTY         = 0.001
```

6. Railway te donne une URL comme :
   https://tradeiq-production.up.railway.app

---

## 🌐 ÉTAPE 3 — Déployer le Frontend sur Vercel

1. Va sur https://vercel.com
2. Crée un compte gratuit
3. Clique "New Project" → importe ton repo GitHub
4. Sélectionne le dossier "frontend"
5. Ajoute la variable d'environnement :

```
REACT_APP_BACKEND_URL = https://ton-backend.railway.app
```

6. Clique "Deploy" → ton app est en ligne !

---

## 🔑 ÉTAPE 4 — Configurer les clés API

### Binance
1. Connecte-toi sur https://binance.com
2. Profil → Gestion API → Créer API
3. Nomme-la "TradeIQ Bot"
4. Copie API Key et Secret Key
5. Colle-les dans les variables Railway

### Alpaca (optionnel pour actions)
1. Connecte-toi sur https://app.alpaca.markets
2. Active le 2FA
3. Paper Trading → API Keys → Generate
4. Copie les clés dans Railway

---

## 🤖 ÉTAPE 5 — Activer le Bot Automatique

Une fois tout déployé, depuis l'app Vercel :
- Clique sur "Start Bot" pour lancer les trades automatiques
- Ou envoie une requête POST à ton backend :
  ```
  POST https://ton-backend.railway.app/api/bot/start
  ```

---

## ✅ Tester que tout fonctionne

```bash
# Tester le backend
curl https://ton-backend.railway.app/

# Voir le signal actuel
curl https://ton-backend.railway.app/api/signal?symbol=BTCUSDT

# Voir les stats du bot
curl https://ton-backend.railway.app/api/stats
```

---

## ⚠️ IMPORTANT

- Commence TOUJOURS avec PAPER_TRADING=true
- Ne mets jamais tes clés API dans le code source
- Utilise uniquement les variables d'environnement Railway
- Teste au moins 2-4 semaines en paper trading avant l'argent réel
