"""
╔══════════════════════════════════════════════════════════╗
║         TRADEIQ BACKEND — Flask API pour Railway         ║
╚══════════════════════════════════════════════════════════╝
"""

import os, time, threading, logging, numpy as np
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# ─────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────
BINANCE_KEY    = os.getenv("BINANCE_API_KEY",    "")
BINANCE_SECRET = os.getenv("BINANCE_API_SECRET", "")
PAPER_TRADING  = os.getenv("PAPER_TRADING",      "true").lower() == "true"
BOT_ENABLED    = os.getenv("BOT_ENABLED",        "false").lower() == "true"
SYMBOL         = os.getenv("TRADING_SYMBOL",     "BTCUSDT")
STYLE          = os.getenv("TRADING_STYLE",      "day")
QTY            = float(os.getenv("TRADING_QTY",  "0.001"))

app = Flask(__name__)
CORS(app, origins=["https://*.vercel.app", "http://localhost:3000"])
logging.basicConfig(level=logging.INFO, format="%(asctime)s │ %(levelname)s │ %(message)s")
log = logging.getLogger("TradeIQ")

orders_log = []
bot_stats  = {"wins":0,"losses":0,"pnl":0.0,"running":False,"last_signal":"WAIT","trades_today":0}
bot_thread = None

# ─────────────────────────────────────────────
#  BINANCE CLIENT
# ─────────────────────────────────────────────
def get_binance_client():
    try:
        from binance.client import Client
        return Client(BINANCE_KEY, BINANCE_SECRET, testnet=PAPER_TRADING)
    except Exception as e:
        log.warning(f"Binance non disponible : {e}")
        return None

# ─────────────────────────────────────────────
#  ANALYSE TECHNIQUE AMÉLIORÉE
# ─────────────────────────────────────────────
def ema(prices, period):
    k = 2 / (period + 1)
    e = sum(prices[:period]) / period
    for v in prices[period:]:
        e = v * k + e * (1 - k)
    return e

def compute_rsi(prices, period=14):
    gains  = [max(prices[i]-prices[i-1], 0) for i in range(1, len(prices))]
    losses = [max(prices[i-1]-prices[i], 0) for i in range(1, len(prices))]
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    return 100 - 100 / (1 + (ag / al if al else 100))

def compute_atr(highs, lows, closes, period=14):
    trs = [max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
           for i in range(1, len(closes))]
    return sum(trs[-period:]) / period

def get_signal(symbol, style="day"):
    try:
        client = get_binance_client()
        if not client:
            return {"signal":"WAIT","reason":"Binance non connecté"}

        interval = {"scalping":"1m","day":"5m","swing":"1h"}.get(style, "5m")
        klines = client.get_klines(symbol=symbol, interval=interval, limit=120)

        closes  = [float(k[4]) for k in klines]
        highs   = [float(k[2]) for k in klines]
        lows    = [float(k[3]) for k in klines]
        volumes = [float(k[5]) for k in klines]

        cur = closes[-1]

        # Indicateurs
        rsi    = compute_rsi(closes)
        ema9   = ema(closes, 9)
        ema20  = ema(closes, 20)
        ema50  = ema(closes, 50)
        ema12  = ema(closes, 12)
        ema26  = ema(closes, 26)
        macd   = ema12 - ema26
        atr    = compute_atr(highs, lows, closes)

        # Bollinger Bands
        sma20  = sum(closes[-20:]) / 20
        std    = (sum((v-sma20)**2 for v in closes[-20:]) / 20) ** 0.5
        upper  = sma20 + 2*std
        lower  = sma20 - 2*std
        bb_pos = (cur - lower) / (upper - lower) if upper != lower else 0.5

        # Volume (moyenne 20 bougies vs actuel)
        vol_avg = sum(volumes[-20:]) / 20
        vol_ratio = volumes[-1] / vol_avg if vol_avg else 1

        # Score de signal
        score = 0

        # RSI
        if rsi < 30:   score += 3
        elif rsi < 40: score += 2
        elif rsi < 50: score += 1
        if rsi > 70:   score -= 3
        elif rsi > 60: score -= 2
        elif rsi > 55: score -= 1

        # EMA trend
        if ema9 > ema20 > ema50: score += 3   # tendance haussière forte
        elif ema9 > ema20:       score += 1
        if ema9 < ema20 < ema50: score -= 3   # tendance baissière forte
        elif ema9 < ema20:       score -= 1

        # MACD
        if macd > 0:   score += 2
        else:          score -= 2

        # Bollinger
        if bb_pos < 0.15:  score += 3  # proche du bas — survente
        elif bb_pos < 0.3: score += 1
        if bb_pos > 0.85:  score -= 3  # proche du haut — surachat
        elif bb_pos > 0.7: score -= 1

        # Volume confirmation
        if vol_ratio > 1.5:   score += 1  # volume élevé = confirmation
        elif vol_ratio < 0.5: score -= 1  # volume faible = signal faible

        # Seuils selon style
        thr = {"scalping": 4, "day": 5, "swing": 6}.get(style, 5)

        if score >= thr:    signal = "BUY"
        elif score <= -thr: signal = "SELL"
        else:               signal = "WAIT"

        # SL/TP dynamiques basés sur ATR
        sl_mult = {"scalping": 1.5, "day": 2.0, "swing": 2.5}.get(style, 2.0)
        tp_mult = {"scalping": 2.0, "day": 3.0, "swing": 4.0}.get(style, 3.0)

        sl = round(cur - atr * sl_mult if signal == "BUY" else cur + atr * sl_mult, 4)
        tp = round(cur + atr * tp_mult if signal == "BUY" else cur - atr * tp_mult, 4)

        return {
            "signal": signal, "score": score, "price": cur,
            "rsi": round(rsi, 2), "ema9": round(ema9, 4),
            "ema20": round(ema20, 4), "ema50": round(ema50, 4),
            "macd": round(macd, 6), "bb_pos": round(bb_pos, 3),
            "atr": round(atr, 4), "vol_ratio": round(vol_ratio, 2),
            "sl": sl, "tp": tp,
        }
    except Exception as e:
        log.error(f"Erreur analyse : {e}")
        return {"signal":"WAIT","reason":str(e)}

# ─────────────────────────────────────────────
#  BOT AUTOMATIQUE
# ─────────────────────────────────────────────
def run_bot():
    log.info(f"🤖 Bot démarré — {SYMBOL} — style:{STYLE} — qty:{QTY}")
    bot_stats["running"] = True
    bot_stats["trades_today"] = 0
    position = None
    last_day = datetime.now().day

    while bot_stats["running"]:
        try:
            # Reset trades_today à minuit
            today = datetime.now().day
            if today != last_day:
                bot_stats["trades_today"] = 0
                last_day = today

            result = get_signal(SYMBOL, STYLE)
            bot_stats["last_signal"] = result.get("signal", "WAIT")
            price = result.get("price", 0)

            # Gérer position ouverte
            if position:
                hit_sl = (position["side"]=="BUY" and price<=position["sl"]) or \
                         (position["side"]=="SELL" and price>=position["sl"])
                hit_tp = (position["side"]=="BUY" and price>=position["tp"]) or \
                         (position["side"]=="SELL" and price<=position["tp"])

                if hit_tp or hit_sl:
                    pnl_pct = (price - position["price"]) / position["price"] * 100
                    if position["side"] == "SELL": pnl_pct = -pnl_pct
                    bot_stats["pnl"] += pnl_pct
                    if pnl_pct > 0: bot_stats["wins"] += 1
                    else:           bot_stats["losses"] += 1
                    log.info(f"{'✅ TP' if hit_tp else '❌ SL'} — PnL: {pnl_pct:+.2f}%")
                    position = None

            # Ouvrir nouvelle position (max 3 trades/jour)
            elif result["signal"] in ("BUY","SELL") and bot_stats["trades_today"] < 3:
                client = get_binance_client()
                if client:
                    side = result["signal"]
                    try:
                        if side == "BUY":
                            order = client.order_market_buy(symbol=SYMBOL, quantity=QTY)
                        else:
                            order = client.order_market_sell(symbol=SYMBOL, quantity=QTY)
                        position = {"side":side,"price":price,"sl":result["sl"],"tp":result["tp"]}
                        bot_stats["trades_today"] += 1
                        orders_log.append({
                            "side":side,"symbol":SYMBOL,"price":price,
                            "sl":result["sl"],"tp":result["tp"],
                            "time":datetime.now().isoformat(),"status":"FILLED","mode":"bot"
                        })
                        log.info(f"🚀 {side} {SYMBOL} @ {price} | SL:{result['sl']} TP:{result['tp']} | Score:{result.get('score')}")
                    except Exception as e:
                        log.error(f"Erreur ordre bot : {e}")

            interval = {"scalping":30,"day":60,"swing":300}.get(STYLE, 60)
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
    return jsonify({"service":"TradeIQ Backend","status":"running","paper":PAPER_TRADING,"bot":bot_stats["running"]})

@app.route("/api/signal", methods=["GET"])
def signal():
    sym   = request.args.get("symbol", SYMBOL)
    style = request.args.get("style",  STYLE)
    return jsonify(get_signal(sym, style))

@app.route("/api/order", methods=["POST"])
def order():
    data   = request.json or {}
    symbol = data.get("symbol", SYMBOL)
    side   = data.get("side",   "BUY").upper()
    qty    = float(data.get("qty", QTY))

    log.info(f"📥 Ordre manuel : {side} {qty} {symbol}")
    try:
        client = get_binance_client()
        if not client:
            raise Exception("Binance non configuré")
        if side == "BUY":
            result = client.order_market_buy(symbol=symbol, quantity=qty)
        else:
            result = client.order_market_sell(symbol=symbol, quantity=qty)
        order_id = result.get("orderId", f"BNB-{int(time.time())}")
        status   = result.get("status", "FILLED")
        orders_log.append({"id":order_id,"side":side,"symbol":symbol,"qty":qty,
                           "time":datetime.now().isoformat(),"status":status,"mode":"manual"})
        return jsonify({"orderId":order_id,"status":status,"success":True})
    except Exception as e:
        log.error(f"Erreur ordre : {e}")
        sim_id = f"SIM-{int(time.time())}"
        return jsonify({"orderId":sim_id,"status":"SIMULATED","success":True,"note":str(e)})

@app.route("/api/orders", methods=["GET"])
def get_orders():
    return jsonify({"orders":orders_log[-50:],"total":len(orders_log)})

@app.route("/api/stats", methods=["GET"])
def stats():
    total = bot_stats["wins"] + bot_stats["losses"]
    return jsonify({**bot_stats,"win_rate":round(bot_stats["wins"]/total*100,1) if total>0 else 0,"total_trades":total})

@app.route("/api/bot/start", methods=["POST"])
def start_bot():
    global bot_thread
    if bot_stats["running"]:
        return jsonify({"message":"Bot déjà en cours","running":True})
    bot_thread = threading.Thread(target=run_bot, daemon=True)
    bot_thread.start()
    return jsonify({"message":"Bot démarré ✅","running":True})

@app.route("/api/bot/stop", methods=["POST"])
def stop_bot():
    bot_stats["running"] = False
    return jsonify({"message":"Bot arrêté","running":False})

@app.route("/api/balance", methods=["GET"])
def balance():
    try:
        client = get_binance_client()
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
    if BOT_ENABLED:
        bot_thread = threading.Thread(target=run_bot, daemon=True)
        bot_thread.start()
    app.run(host="0.0.0.0", port=port, debug=False)
