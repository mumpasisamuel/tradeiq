"""
╔══════════════════════════════════════════════════════════╗
║         TRADEIQ BACKEND — Flask API pour Railway         ║
╚══════════════════════════════════════════════════════════╝

Ce backend tourne sur Railway 24h/24 et :
- Reçoit les ordres depuis l'app Vercel
- Les transmet à Binance / Alpaca
- Lance le bot automatique en arrière-plan
- Expose une API REST pour l'app frontend

INSTALLATION LOCALE :
    pip install flask flask-cors python-binance requests

VARIABLES D'ENVIRONNEMENT (à configurer sur Railway) :
    BINANCE_API_KEY
    BINANCE_API_SECRET
    ALPACA_API_KEY
    ALPACA_API_SECRET
    BOT_ENABLED=true
    TRADING_SYMBOL=BTCUSDT
    TRADING_STYLE=day
    TRADING_QTY=0.001
    PAPER_TRADING=true
"""

import os
import time
import threading
import logging
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# ─────────────────────────────────────────────
#  CONFIG depuis variables d'environnement
# ─────────────────────────────────────────────
BINANCE_KEY    = os.getenv("BINANCE_API_KEY",    "")
BINANCE_SECRET = os.getenv("BINANCE_API_SECRET", "")
ALPACA_KEY     = os.getenv("ALPACA_API_KEY",     "")
ALPACA_SECRET  = os.getenv("ALPACA_API_SECRET",  "")
PAPER_TRADING  = os.getenv("PAPER_TRADING",      "true").lower() == "true"
BOT_ENABLED    = os.getenv("BOT_ENABLED",        "false").lower() == "true"
SYMBOL         = os.getenv("TRADING_SYMBOL",     "BTCUSDT")
STYLE          = os.getenv("TRADING_STYLE",      "day")
QTY            = float(os.getenv("TRADING_QTY",  "0.001"))

# ─────────────────────────────────────────────
#  APP FLASK
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins=["https://*.vercel.app", "http://localhost:3000"])

logging.basicConfig(level=logging.INFO, format="%(asctime)s │ %(levelname)s │ %(message)s")
log = logging.getLogger("TradeIQ")

# Stockage en mémoire (remplace par une DB pour la production)
orders_log  = []
bot_stats   = {"wins":0,"losses":0,"pnl":0.0,"running":False,"last_signal":"WAIT"}
bot_thread  = None

# ─────────────────────────────────────────────
#  BINANCE CLIENT
# ─────────────────────────────────────────────
def get_binance_client(testnet=True):
    try:
        from binance.client import Client
        return Client(BINANCE_KEY, BINANCE_SECRET, testnet=testnet)
    except Exception as e:
        log.warning(f"Binance non disponible : {e}")
        return None

# ─────────────────────────────────────────────
#  ALPACA CLIENT
# ─────────────────────────────────────────────
def alpaca_order(symbol, side, qty):
    import requests as req
    url  = "https://paper-api.alpaca.markets/v2/orders" if PAPER_TRADING else "https://api.alpaca.markets/v2/orders"
    headers = {
        "APCA-API-KEY-ID":     ALPACA_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET,
        "Content-Type": "application/json",
    }
    body = {"symbol":symbol,"qty":qty,"side":side.lower(),"type":"market","time_in_force":"gtc"}
    r = req.post(url, headers=headers, json=body, timeout=10)
    return r.json()

# ─────────────────────────────────────────────
#  ANALYSE TECHNIQUE
# ─────────────────────────────────────────────
def get_signal(symbol, style="day"):
    """Récupère les données Binance et calcule le signal."""
    import numpy as np
    try:
        client = get_binance_client(testnet=PAPER_TRADING)
        if not client:
            return {"signal":"WAIT","reason":"Binance non connecté"}

        interval = {"scalping":"1m","day":"5m","swing":"1h"}.get(style,"5m")
        klines = client.get_klines(symbol=symbol, interval=interval, limit=100)
        closes = [float(k[4]) for k in klines]
        p = closes

        # RSI
        gains  = [max(p[i]-p[i-1],0) for i in range(1,len(p))]
        losses = [max(p[i-1]-p[i],0) for i in range(1,len(p))]
        ag = sum(gains[-14:])/14; al = sum(losses[-14:])/14
        rsi = 100-100/(1+(ag/al if al else 100))

        # EMA
        def ema(period):
            k=2/(period+1); e=sum(p[:period])/period
            for v in p[period:]: e=v*k+e*(1-k)
            return e
        ema9=ema(9); ema20=ema(20); ema12=ema(12); ema26=ema(26)
        macd=ema12-ema26

        # Bollinger
        sma20=sum(p[-20:])/20
        std=( sum((v-sma20)**2 for v in p[-20:])/20 )**0.5
        upper=sma20+2*std; lower=sma20-2*std
        cur=p[-1]; bb_pos=(cur-lower)/(upper-lower) if upper!=lower else 0.5

        # Score
        score=0
        if rsi<30: score+=3
        elif rsi<45: score+=1
        if rsi>70: score-=3
        elif rsi>55: score-=1
        if ema9>ema20: score+=2
        else: score-=2
        if macd>0: score+=1
        else: score-=1
        if bb_pos<0.2: score+=2
        elif bb_pos>0.8: score-=2

        thr={"scalping":2,"day":3,"swing":4}.get(style,3)

        if score>=thr:   signal="BUY"
        elif score<=-thr: signal="SELL"
        else:              signal="WAIT"

        return {
            "signal":signal,"score":score,"price":cur,
            "rsi":round(rsi,2),"ema9":round(ema9,4),"ema20":round(ema20,4),
            "macd":round(macd,6),"bb_pos":round(bb_pos,3),
            "sl":round(cur*0.98 if signal=="BUY" else cur*1.02,4),
            "tp":round(cur*1.04 if signal=="BUY" else cur*0.96,4),
        }
    except Exception as e:
        log.error(f"Erreur analyse : {e}")
        return {"signal":"WAIT","reason":str(e)}

# ─────────────────────────────────────────────
#  BOT AUTOMATIQUE (thread)
# ─────────────────────────────────────────────
def run_bot():
    log.info(f"🤖 Bot démarré — {SYMBOL} — style:{STYLE} — qty:{QTY}")
    bot_stats["running"] = True
    position = None
    orders_today = 0

    while bot_stats["running"]:
        try:
            result = get_signal(SYMBOL, STYLE)
            bot_stats["last_signal"] = result.get("signal","WAIT")
            price = result.get("price",0)

            # Gérer position ouverte
            if position:
                cur = price
                hit_sl = (position["side"]=="BUY" and cur<=position["sl"]) or \
                         (position["side"]=="SELL" and cur>=position["sl"])
                hit_tp = (position["side"]=="BUY" and cur>=position["tp"]) or \
                         (position["side"]=="SELL" and cur<=position["tp"])

                if hit_tp or hit_sl:
                    pnl_pct = ((cur-position["price"])/position["price"]*100)
                    if position["side"]=="SELL": pnl_pct=-pnl_pct
                    bot_stats["pnl"] += pnl_pct
                    if pnl_pct>0: bot_stats["wins"]+=1
                    else: bot_stats["losses"]+=1
                    log.info(f"{'✅ TP' if hit_tp else '❌ SL'} fermé — PnL: {pnl_pct:+.2f}%")
                    position = None

            # Ouvrir nouvelle position
            elif result["signal"] in ("BUY","SELL") and orders_today < 5:
                client = get_binance_client(testnet=PAPER_TRADING)
                if client:
                    side = result["signal"]
                    try:
                        if side=="BUY":
                            order = client.order_market_buy(symbol=SYMBOL, quantity=QTY)
                        else:
                            order = client.order_market_sell(symbol=SYMBOL, quantity=QTY)
                        position = {"side":side,"price":price,"sl":result["sl"],"tp":result["tp"]}
                        orders_today+=1
                        orders_log.append({"side":side,"symbol":SYMBOL,"price":price,
                                           "time":datetime.now().isoformat(),"status":"FILLED","mode":"bot"})
                        log.info(f"🚀 {side} {SYMBOL} @ {price} | SL:{result['sl']} TP:{result['tp']}")
                    except Exception as e:
                        log.error(f"Erreur ordre bot : {e}")

            interval = {"scalping":30,"day":60,"swing":300}.get(STYLE,60)
            time.sleep(interval)

        except Exception as e:
            log.error(f"Erreur bot : {e}")
            time.sleep(30)

    log.info("⏹ Bot arrêté")

# ─────────────────────────────────────────────
#  ROUTES API
# ─────────────────────────────────────────────

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "service": "TradeIQ Backend",
        "status":  "running",
        "paper":   PAPER_TRADING,
        "bot":     bot_stats["running"],
    })

@app.route("/api/signal", methods=["GET"])
def signal():
    """Retourne le signal actuel pour un symbole."""
    sym   = request.args.get("symbol", SYMBOL)
    style = request.args.get("style",  STYLE)
    return jsonify(get_signal(sym, style))

@app.route("/api/order", methods=["POST"])
def order():
    """Exécute un ordre manuel depuis l'app frontend."""
    data   = request.json or {}
    symbol = data.get("symbol", SYMBOL)
    side   = data.get("side",   "BUY").upper()
    qty    = float(data.get("qty", QTY))
    broker = data.get("broker", "binance")

    log.info(f"📥 Ordre reçu : {side} {qty} {symbol} via {broker}")

    try:
        if broker == "binance":
            client = get_binance_client(testnet=PAPER_TRADING)
            if not client:
                raise Exception("Binance non configuré")
            if side == "BUY":
                result = client.order_market_buy(symbol=symbol, quantity=qty)
            else:
                result = client.order_market_sell(symbol=symbol, quantity=qty)
            order_id = result.get("orderId", f"BNB-{int(time.time())}")
            status   = result.get("status", "FILLED")

        elif broker == "alpaca":
            result   = alpaca_order(symbol, side, qty)
            order_id = result.get("id", f"ALP-{int(time.time())}")
            status   = result.get("status", "filled")
        else:
            raise Exception(f"Broker inconnu : {broker}")

        orders_log.append({
            "id":     order_id,
            "side":   side,
            "symbol": symbol,
            "qty":    qty,
            "time":   datetime.now().isoformat(),
            "status": status,
            "broker": broker,
        })
        return jsonify({"orderId":order_id,"status":status,"success":True})

    except Exception as e:
        log.error(f"Erreur ordre : {e}")
        # Simulation si API non configurée
        sim_id = f"SIM-{int(time.time())}"
        return jsonify({"orderId":sim_id,"status":"SIMULATED","success":True,"note":str(e)})

@app.route("/api/orders", methods=["GET"])
def get_orders():
    """Retourne l'historique des ordres."""
    return jsonify({"orders": orders_log[-50:], "total": len(orders_log)})

@app.route("/api/stats", methods=["GET"])
def stats():
    """Statistiques du bot."""
    total = bot_stats["wins"] + bot_stats["losses"]
    return jsonify({
        **bot_stats,
        "win_rate": round(bot_stats["wins"]/total*100,1) if total>0 else 0,
        "total_trades": total,
    })

@app.route("/api/bot/start", methods=["POST"])
def start_bot():
    """Démarre le bot automatique."""
    global bot_thread
    if bot_stats["running"]:
        return jsonify({"message":"Bot déjà en cours","running":True})
    bot_thread = threading.Thread(target=run_bot, daemon=True)
    bot_thread.start()
    return jsonify({"message":"Bot démarré ✅","running":True})

@app.route("/api/bot/stop", methods=["POST"])
def stop_bot():
    """Arrête le bot automatique."""
    bot_stats["running"] = False
    return jsonify({"message":"Bot arrêté","running":False})

@app.route("/api/balance", methods=["GET"])
def balance():
    """Solde du compte Binance."""
    try:
        client = get_binance_client(testnet=PAPER_TRADING)
        if not client:
            return jsonify({"error":"Binance non configuré"})
        account = client.get_account()
        balances = {b["asset"]:float(b["free"]) for b in account["balances"] if float(b["free"])>0}
        return jsonify({"balances":balances,"paper":PAPER_TRADING})
    except Exception as e:
        return jsonify({"error":str(e)})

# ─────────────────────────────────────────────
#  DÉMARRAGE
# ─────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    log.info(f"🚀 TradeIQ Backend démarré sur port {port}")
    log.info(f"   Paper trading : {PAPER_TRADING}")
    log.info(f"   Binance clé   : {'✅' if BINANCE_KEY else '❌ Non configurée'}")
    log.info(f"   Alpaca clé    : {'✅' if ALPACA_KEY else '❌ Non configurée'}")

    if BOT_ENABLED:
        bot_thread = threading.Thread(target=run_bot, daemon=True)
        bot_thread.start()

    app.run(host="0.0.0.0", port=port, debug=False)
