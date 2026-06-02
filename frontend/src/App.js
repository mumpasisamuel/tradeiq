import React, { useState, useEffect, useRef, useCallback } from "react";

const BACKEND_URL = "https://tradeiq-aqt8.onrender.com";
const BINANCE_WS  = "wss://stream.binance.com:9443/ws";

const STYLE_CONFIG = {
  scalping: { interval:"1m",  label:"1 min",  refreshMs:60000,   candles:100 },
  day:      { interval:"5m",  label:"5 min",  refreshMs:300000,  candles:100 },
  swing:    { interval:"1h",  label:"1 heure",refreshMs:3600000, candles:100 },
};

const DEMO_BALANCE = { USDT:10000, BTC:0.15, ETH:2.0, BNB:5.0, SOL:20.0 };

const ASSETS = {
  crypto: [
    { id:"BTCUSDT", symbol:"BTC/USDT", name:"Bitcoin",  icon:"₿"  },
    { id:"ETHUSDT", symbol:"ETH/USDT", name:"Ethereum", icon:"Ξ"  },
    { id:"SOLUSDT", symbol:"SOL/USDT", name:"Solana",   icon:"◎"  },
    { id:"BNBUSDT", symbol:"BNB/USDT", name:"BNB",      icon:"🔶" },
    { id:"XRPUSDT", symbol:"XRP/USDT", name:"Ripple",   icon:"✕"  },
    { id:"ADAUSDT", symbol:"ADA/USDT", name:"Cardano",  icon:"₳"  },
  ],
  forex: [
    { id:"EURUSD", symbol:"EUR/USD", name:"Euro/Dollar",  icon:"€" },
    { id:"GBPUSD", symbol:"GBP/USD", name:"Livre/Dollar", icon:"£" },
    { id:"USDJPY", symbol:"USD/JPY", name:"Dollar/Yen",   icon:"¥" },
  ],
  stocks: [
    { id:"AAPL", symbol:"AAPL", name:"Apple",     icon:"🍎" },
    { id:"TSLA", symbol:"TSLA", name:"Tesla",     icon:"⚡" },
    { id:"NVDA", symbol:"NVDA", name:"NVIDIA",    icon:"🟢" },
    { id:"MSFT", symbol:"MSFT", name:"Microsoft", icon:"🪟" },
  ],
  indices: [
    { id:"SPY", symbol:"S&P500", name:"S&P 500",    icon:"🇺🇸" },
    { id:"QQQ", symbol:"NASDAQ", name:"NASDAQ 100", icon:"💻" },
  ],
};

// ── Prix temps réel ──────────────────────────────────────
function useLivePrice(asset, style) {
  const [price,      setPrice]      = useState(null);
  const [change,     setChange]     = useState(0);
  const [candles,    setCandles]    = useState([]); // OHLCV complet
  const [status,     setStatus]     = useState("connecting");
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef    = useRef(null);
  const timerRef = useRef(null);
  const cfg = STYLE_CONFIG[style] || STYLE_CONFIG.day;
  const isCrypto = Object.keys(ASSETS).find(k => ASSETS[k].some(a => a.id === asset?.id)) === "crypto";

  const loadCandles = useCallback(async () => {
    if (!asset || !isCrypto) return;
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset.id}&interval=${cfg.interval}&limit=${cfg.candles}`);
      const data = await r.json();
      if (!Array.isArray(data)) return;
      const pts = data.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
      }));
      setCandles(pts);
      setPrice(pts[pts.length-1]?.c);
      const f=pts[0]?.c, l=pts[pts.length-1]?.c;
      if (f&&l) setChange(((l-f)/f)*100);
      setLastUpdate(new Date());
      setStatus("live");
    } catch { setStatus("error"); }
  }, [asset?.id, cfg.interval, cfg.candles]);

  useEffect(() => {
    if (!asset) return;
    setPrice(null); setCandles([]); setStatus("connecting");
    if (isCrypto) {
      loadCandles();
      timerRef.current = setInterval(loadCandles, cfg.refreshMs);
      wsRef.current = new WebSocket(`${BINANCE_WS}/${asset.id.toLowerCase()}@miniTicker`);
      wsRef.current.onmessage = (e) => {
        const d = JSON.parse(e.data);
        setPrice(parseFloat(d.c));
        setChange(parseFloat(d.P));
      };
    } else {
      const base = {EURUSD:1.085,GBPUSD:1.27,USDJPY:154.5,AAPL:189,TSLA:175,NVDA:870,MSFT:420,SPY:530,QQQ:450}[asset.id]||100;
      let p = base; const pts = [];
      for (let i=99;i>=0;i--) {
        const o=p; p=p*(1+(Math.random()-0.495)*0.003);
        pts.push({t:Date.now()-i*cfg.refreshMs,o,h:Math.max(o,p)*1.001,l:Math.min(o,p)*0.999,c:p,v:Math.random()*1000000});
      }
      setCandles(pts); setPrice(pts[pts.length-1].c); setStatus("demo"); setLastUpdate(new Date());
      const pt = setInterval(() => setPrice(prev => prev ? parseFloat((prev*(1+(Math.random()-0.495)*0.002)).toFixed(5)) : prev), 3000);
      timerRef.current = setInterval(() => {
        setCandles(h => {
          const last=h[h.length-1];
          const np=parseFloat((last.c*(1+(Math.random()-0.495)*0.003)).toFixed(5));
          return [...h.slice(-99),{t:Date.now(),o:last.c,h:Math.max(last.c,np)*1.001,l:Math.min(last.c,np)*0.999,c:np,v:Math.random()*1000000}];
        });
        setLastUpdate(new Date());
      }, cfg.refreshMs);
      return () => { clearInterval(pt); clearInterval(timerRef.current); };
    }
    return () => { wsRef.current?.close(); clearInterval(timerRef.current); };
  }, [asset?.id, style]);

  return { price, change, candles, status, lastUpdate };
}

// ── ANALYSE TECHNIQUE AVANCÉE ────────────────────────────
function analyzeAdvanced(candles, style) {
  if (candles.length < 30) return null;

  const closes  = candles.map(c => c.c);
  const highs   = candles.map(c => c.h);
  const lows    = candles.map(c => c.l);
  const volumes = candles.map(c => c.v);
  const n = closes.length;

  // ── 1. RSI 14 ──────────────────────────────────────────
  const gains=[], losses=[];
  for (let i=1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1];
    gains.push(d>0?d:0); losses.push(d<0?-d:0);
  }
  const avgG=gains.slice(-14).reduce((a,b)=>a+b,0)/14;
  const avgL=losses.slice(-14).reduce((a,b)=>a+b,0)/14;
  const rsi=100-100/(1+(avgL===0?100:avgG/avgL));

  // ── 2. EMA ─────────────────────────────────────────────
  const ema=(arr,per)=>{ const k=2/(per+1); let e=arr.slice(0,per).reduce((a,b)=>a+b,0)/per; for(let i=per;i<arr.length;i++) e=arr[i]*k+e*(1-k); return e; };
  const ema9=ema(closes,9), ema20=ema(closes,20), ema50=ema(closes,50);
  const ema12=ema(closes,12), ema26=ema(closes,26);
  const macd=ema12-ema26;
  const macdSignal=ema([...Array(closes.length).keys()].map(i=>{
    const k=2/(13); let e2=closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
    for(let j=12;j<=i;j++) e2=closes[j]*k+e2*(1-k);
    const k2=2/(27); let e3=closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
    for(let j=26;j<=i;j++) e3=closes[j]*k2+e3*(1-k2);
    return e2-e3;
  }),9);
  const macdHist = macd - macdSignal;

  // ── 3. Bollinger Bands ─────────────────────────────────
  const sma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
  const std=Math.sqrt(closes.slice(-20).map(v=>(v-sma20)**2).reduce((a,b)=>a+b,0)/20);
  const bbUpper=sma20+2*std, bbLower=sma20-2*std;
  const bbPos=(closes[n-1]-bbLower)/(bbUpper-bbLower||1);
  const bbWidth=(bbUpper-bbLower)/sma20; // volatilité

  // ── 4. Volume ──────────────────────────────────────────
  const avgVol=volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
  const lastVol=volumes[n-1];
  const volRatio=lastVol/avgVol; // >1.5 = volume fort
  const volTrend=volumes.slice(-5).reduce((a,b)=>a+b,0)/5 > volumes.slice(-10,-5).reduce((a,b)=>a+b,0)/5;

  // ── 5. Support / Résistance ────────────────────────────
  const recent = closes.slice(-30);
  const recentHigh = Math.max(...highs.slice(-30));
  const recentLow  = Math.min(...lows.slice(-30));
  const cur = closes[n-1];
  const distToResistance = ((recentHigh - cur) / cur) * 100;
  const distToSupport    = ((cur - recentLow)  / cur) * 100;
  const nearResistance   = distToResistance < 0.5; // dans les 0.5% d'une résistance
  const nearSupport      = distToSupport    < 0.5;

  // ── 6. Tendance globale (sur 24 bougies) ──────────────
  const trend24 = (closes[n-1]-closes[n-25])/(closes[n-25]||1)*100;
  const trend5  = (closes[n-1]-closes[n-6])/(closes[n-6]||1)*100;
  const trendUp   = ema9 > ema20 && ema20 > ema50;
  const trendDown = ema9 < ema20 && ema20 < ema50;

  // ── 7. Stochastique RSI ────────────────────────────────
  const rsiValues=[];
  for(let i=14;i<closes.length;i++){
    const g2=gains.slice(i-14,i).reduce((a,b)=>a+b,0)/14;
    const l2=losses.slice(i-14,i).reduce((a,b)=>a+b,0)/14;
    rsiValues.push(100-100/(1+(l2===0?100:g2/l2)));
  }
  const rsiMin=Math.min(...rsiValues.slice(-14));
  const rsiMax=Math.max(...rsiValues.slice(-14));
  const stochRsi=(rsi-rsiMin)/(rsiMax-rsiMin||1)*100;

  // ── 8. ATR (volatilité) ────────────────────────────────
  const trueRanges=[];
  for(let i=1;i<candles.length;i++){
    trueRanges.push(Math.max(
      highs[i]-lows[i],
      Math.abs(highs[i]-closes[i-1]),
      Math.abs(lows[i]-closes[i-1])
    ));
  }
  const atr=trueRanges.slice(-14).reduce((a,b)=>a+b,0)/14;
  const atrPct=(atr/cur)*100;

  // ── SCORING AVANCÉ ─────────────────────────────────────
  let score=0;
  const reasons=[];

  // RSI
  if(rsi<25){score+=4;reasons.push("RSI très bas (survente forte)");}
  else if(rsi<35){score+=3;reasons.push("RSI bas (survente)");}
  else if(rsi<45){score+=1;reasons.push("RSI modérément bas");}
  else if(rsi>75){score-=4;reasons.push("RSI très haut (surachat fort)");}
  else if(rsi>65){score-=3;reasons.push("RSI haut (surachat)");}
  else if(rsi>55){score-=1;reasons.push("RSI modérément haut");}

  // EMA croisement
  if(trendUp){score+=3;reasons.push("Tendance haussière EMA9>20>50");}
  else if(ema9>ema20){score+=2;reasons.push("EMA9 > EMA20 (haussier)");}
  else if(trendDown){score-=3;reasons.push("Tendance baissière EMA9<20<50");}
  else{score-=2;reasons.push("EMA9 < EMA20 (baissier)");}

  // MACD
  if(macd>0&&macdHist>0){score+=2;reasons.push("MACD positif + histogramme haussier");}
  else if(macd>0){score+=1;reasons.push("MACD positif");}
  else if(macd<0&&macdHist<0){score-=2;reasons.push("MACD négatif + histogramme baissier");}
  else{score-=1;reasons.push("MACD négatif");}

  // Bollinger
  if(bbPos<0.1){score+=3;reasons.push("Prix sous la bande basse (fort signal BUY)");}
  else if(bbPos<0.25){score+=2;reasons.push("Prix en zone basse de Bollinger");}
  else if(bbPos>0.9){score-=3;reasons.push("Prix au-dessus de la bande haute (fort signal SELL)");}
  else if(bbPos>0.75){score-=2;reasons.push("Prix en zone haute de Bollinger");}

  // Volume
  if(volRatio>2&&volTrend){score+=2;reasons.push(`Volume très fort (${volRatio.toFixed(1)}x la moyenne)`);}
  else if(volRatio>1.5){score+=1;reasons.push(`Volume fort (${volRatio.toFixed(1)}x)`);}
  else if(volRatio<0.5){score-=1;reasons.push("Volume faible — signal moins fiable");}

  // Support/Résistance
  if(nearSupport&&score>0){score+=2;reasons.push("Prix proche d'un support — rebond probable");}
  if(nearResistance&&score>0){score-=2;reasons.push("Prix proche d'une résistance — attention");}

  // Stochastique RSI
  if(stochRsi<20){score+=2;reasons.push("Stoch RSI en survente");}
  else if(stochRsi>80){score-=2;reasons.push("Stoch RSI en surachat");}

  // Tendance globale
  if(trend24>2){score+=1;reasons.push(`Tendance 24 bougies haussière (+${trend24.toFixed(1)}%)`);}
  else if(trend24<-2){score-=1;reasons.push(`Tendance 24 bougies baissière (${trend24.toFixed(1)}%)`);}

  // Seuil selon style
  const thr={scalping:4,day:6,swing:8}[style]||6;
  const slPct={scalping:0.005,day:0.02,swing:0.04}[style]||0.02;
  const tpPct={scalping:0.01, day:0.04,swing:0.08}[style]||0.04;

  let signal="WAIT",color="#ffd600",advice="";
  let sl=0,tp=0,confidence=0;

  if(score>=thr){
    signal="BUY"; color="#00e676";
    sl=parseFloat((cur*(1-slPct)).toFixed(6));
    tp=parseFloat((cur*(1+tpPct)).toFixed(6));
    confidence=Math.min(score/12*100,100);
    advice=score>=10?"Signal TRÈS FORT d'achat — consensus de tous les indicateurs":score>=8?"Signal FORT d'achat — majorité des indicateurs alignés":"Signal d'achat — tendance haussière détectée";
  } else if(score<=-thr){
    signal="SELL"; color="#ff1744";
    sl=parseFloat((cur*(1+slPct)).toFixed(6));
    tp=parseFloat((cur*(1-tpPct)).toFixed(6));
    confidence=Math.min(-score/12*100,100);
    advice=score<=-10?"Signal TRÈS FORT de vente — consensus de tous les indicateurs":score<=-8?"Signal FORT de vente — majorité des indicateurs baissiers":"Signal de vente — tendance baissière détectée";
  } else {
    confidence=50-Math.abs(score)/thr*20;
    advice=Math.abs(score)>=thr-2?"Signal faible — attend une confirmation supplémentaire":"Marché indécis — aucun signal clair";
  }

  return {
    signal,color,advice,confidence,score,thr,
    rsi,stochRsi,ema9,ema20,ema50,macd,macdHist,
    bbPos,bbUpper,bbLower,bbWidth,
    volRatio,volTrend,
    distToResistance,distToSupport,nearResistance,nearSupport,
    trend24,trend5,trendUp,trendDown,
    atrPct,sl,tp,reasons,
  };
}

// ── Sparkline ────────────────────────────────────────────
function Sparkline({ candles, color }) {
  if (!candles||candles.length<2) return null;
  const vals=candles.map(c=>c.c);
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const W=300,H=60;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*W},${H-((v-min)/range)*(H-6)-3}`).join(" ");
  const last=pts.split(" ").pop().split(",");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}}>
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#g)"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color}/>
    </svg>
  );
}

// ── Compte à rebours ─────────────────────────────────────
function Countdown({ seconds, onEnd }) {
  const [remaining, setRemaining] = useState(seconds);
  const timerRef = useRef(null);
  const onEndRef = useRef(onEnd);
  useEffect(() => { onEndRef.current = onEnd; });
  useEffect(() => {
    setRemaining(seconds);
    timerRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setTimeout(() => { if (onEndRef.current) onEndRef.current(); }, 50);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [seconds]);
  const pct = ((seconds - remaining) / seconds) * 100;
  const m = Math.floor(remaining/60), s = remaining%60;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{position:"relative",width:44,height:44,flexShrink:0}}>
        <svg viewBox="0 0 44 44" style={{width:44,height:44,transform:"rotate(-90deg)"}}>
          <circle cx="22" cy="22" r="18" fill="none" stroke="#1e2a3a" strokeWidth="4"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke="#00b4d8" strokeWidth="4"
            strokeDasharray={`${2*Math.PI*18}`}
            strokeDashoffset={`${2*Math.PI*18*(1-pct/100)}`}
            strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:"#00b4d8"}}>
          {m>0?`${m}m`:""}{s}s
        </div>
      </div>
      <div style={{fontSize:11,color:"#8899aa"}}>
        Fermeture dans <span style={{color:"#00b4d8",fontWeight:700}}>{m>0?`${m}min `:""}{ s}s</span>
      </div>
    </div>
  );
}

// ── Barre de score ───────────────────────────────────────
function ScoreBar({ label, value, min=0, max=100, lowColor="#00e676", highColor="#ff1744", neutral=50 }) {
  const pct = Math.max(0,Math.min(100,((value-min)/(max-min))*100));
  const col = pct < 35 ? lowColor : pct > 65 ? highColor : "#ffd600";
  return (
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:10,color:"#8899aa"}}>{label}</span>
        <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:col,fontWeight:700}}>{typeof value==="number"?value.toFixed(1):value}</span>
      </div>
      <div style={{height:5,background:"#1e2a3a",borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:col,borderRadius:3,transition:"width .8s"}}/>
      </div>
    </div>
  );
}

// ── APP ──────────────────────────────────────────────────
export default function App() {
  const [category,    setCategory]    = useState("crypto");
  const [asset,       setAsset]       = useState(ASSETS.crypto[0]);
  const [style,       setStyle]       = useState("day");
  const [tab,         setTab]         = useState("signal");
  const [qty,         setQty]         = useState("0.001");
  const [orders,      setOrders]      = useState([]);
  const [orderMsg,    setOrderMsg]    = useState(null);
  const [mode,        setMode]        = useState("demo");
  const [balance,     setBalance]     = useState(null);
  const [balLoading,  setBalLoading]  = useState(false);
  const [botRunning,  setBotRunning]  = useState(false);
  const [demoBalance, setDemoBalance] = useState({...DEMO_BALANCE});
  const [tradeDuration, setTradeDuration] = useState("5");
  const [activeTrade, setActiveTrade] = useState(null);
  const [showReasons, setShowReasons] = useState(false);

  const { price, change, candles, status, lastUpdate } = useLivePrice(asset, style);
  const analysis = candles.length >= 30 ? analyzeAdvanced(candles, style) : null;
  const isCrypto = category === "crypto";
  const cfg = STYLE_CONFIG[style];

  const fmt = v => {
    if (!v&&v!==0) return "---";
    if (isCrypto&&v>=1000) return v.toLocaleString("fr-FR",{maximumFractionDigits:2});
    if (isCrypto) return v.toFixed(2);
    return v.toFixed(5);
  };

  const fetchBalance = useCallback(async () => {
    setBalLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/balance`);
      const data = await res.json();
      if (data.balances) setBalance(data.balances); else setBalance(null);
    } catch { setBalance(null); }
    setBalLoading(false);
  }, []);

  useEffect(() => { if (mode==="reel") fetchBalance(); else setBalance(null); }, [mode]);

  // Surveiller SL/TP
  useEffect(() => {
    if (!activeTrade||!price) return;
    const { side, sl, tp } = activeTrade;
    if ((side==="BUY"&&price<=sl)||(side==="SELL"&&price>=sl)) closeTrade("STOP LOSS ❌","loss");
    if ((side==="BUY"&&price>=tp)||(side==="SELL"&&price<=tp)) closeTrade("TAKE PROFIT ✅","win");
  }, [price, activeTrade]);

  const placeOrder = async (side) => {
    if (activeTrade) return;
    setOrderMsg("loading");
    const durationSec = parseInt(tradeDuration||"5")*60;
    const sl = analysis?(side==="BUY"?analysis.sl:analysis.sl):side==="BUY"?price*0.98:price*1.02;
    const tp = analysis?(side==="BUY"?analysis.tp:analysis.tp):side==="BUY"?price*1.04:price*0.96;

    if (mode==="demo") {
      await new Promise(r=>setTimeout(r,600));
      const trade = {side,symbol:asset.symbol,qty,entryPrice:price,sl,tp,secondsLeft:durationSec,startTime:Date.now(),id:`TRD-${Date.now()}`};
      setActiveTrade(trade);
      setOrders(o=>[{...trade,time:new Date().toLocaleTimeString("fr-FR"),status:"OUVERT",mode:"demo"},...o.slice(0,29)]);
      setOrderMsg("simulated");
      setDemoBalance(prev=>{
        const next={...prev},base=asset.id.replace("USDT","");
        if(side==="BUY"&&next.USDT>=parseFloat(qty)*price){next.USDT-=parseFloat(qty)*price;next[base]=(next[base]||0)+parseFloat(qty);}
        return next;
      });
    } else {
      try {
        const res=await fetch(`${BACKEND_URL}/api/order`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:asset.id,side,qty:parseFloat(qty),broker:"binance"})});
        const data=await res.json();
        const trade={side,symbol:asset.symbol,qty,entryPrice:price,sl,tp,secondsLeft:durationSec,startTime:Date.now(),id:data.orderId||`TRD-${Date.now()}`};
        setActiveTrade(trade);
        setOrders(o=>[{...trade,time:new Date().toLocaleTimeString("fr-FR"),status:"OUVERT",mode:"reel"},...o.slice(0,29)]);
        setOrderMsg("success"); fetchBalance();
      } catch { setOrderMsg("error"); }
    }
    setTimeout(()=>setOrderMsg(null),3000);
  };

  const closeTrade = useCallback((reason="Manuel",outcome="neutral") => {
    if (!activeTrade) return;
    const pnl=activeTrade.side==="BUY"?((price-activeTrade.entryPrice)/activeTrade.entryPrice*100):((activeTrade.entryPrice-price)/activeTrade.entryPrice*100);
    setOrders(o=>o.map(ord=>ord.id===activeTrade.id?{...ord,status:`FERMÉ — ${reason}`,pnl:`${pnl>=0?"+":""}${pnl.toFixed(2)}%`,closePrice:price}:ord));
    if(mode==="demo"){
      setDemoBalance(prev=>{
        const next={...prev},base=activeTrade.symbol.replace("/USDT","");
        if(activeTrade.side==="BUY"&&next[base]>=parseFloat(activeTrade.qty)){next[base]-=parseFloat(activeTrade.qty);next.USDT+=parseFloat(activeTrade.qty)*price;}
        return next;
      });
    } else {
      const cs=activeTrade.side==="BUY"?"SELL":"BUY";
      fetch(`${BACKEND_URL}/api/order`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:asset.id,side:cs,qty:parseFloat(activeTrade.qty),broker:"binance"})}).then(()=>fetchBalance()).catch(()=>{});
    }
    setActiveTrade(null);
  },[activeTrade,price,mode]);

  const toggleBot = async () => {
    try { await fetch(`${BACKEND_URL}${botRunning?"/api/bot/stop":"/api/bot/start"}`,{method:"POST"}); } catch {}
    setBotRunning(!botRunning);
  };

  const CATS   = [{id:"crypto",icon:"₿",label:"Crypto"},{id:"forex",icon:"💱",label:"Forex"},{id:"stocks",icon:"📈",label:"Actions"},{id:"indices",icon:"🌐",label:"Indices"}];
  const STYLES = [{id:"scalping",icon:"⚡",label:"Scalping",desc:"1 min"},{id:"day",icon:"☀️",label:"Day",desc:"5 min"},{id:"swing",icon:"🌊",label:"Swing",desc:"1h"}];
  const SC={live:"#00e676",demo:"#ffd600",connecting:"#00b4d8",disconnected:"#ff1744",error:"#ff1744"};
  const SL2={live:"LIVE",demo:"DÉMO",connecting:"...",disconnected:"OFF",error:"ERR"};

  return (
    <div style={{minHeight:"100vh",background:"#060c13",fontFamily:"'DM Sans',sans-serif",color:"#cdd9e5",paddingBottom:40}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}button{cursor:pointer;font-family:inherit}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.fade{animation:fadeIn .3s ease}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1e2a3a;border-radius:2px}`}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0d1b2a,transparent)",padding:"16px",borderBottom:"1px solid #1a2636",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"linear-gradient(135deg,#00b4d8,#0077b6)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📈</div>
          <div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:16,fontWeight:700,color:"#e0f0ff",letterSpacing:1}}>TRADEIQ</div>
            <div style={{fontSize:9,color:"#4a6075",letterSpacing:2}}>ANALYSE AVANCÉE</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"#0d1b2a",border:`1px solid ${SC[status]}40`,borderRadius:20,padding:"4px 10px",fontSize:10,color:SC[status],fontFamily:"'Space Mono',monospace"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:SC[status],display:"inline-block",animation:status==="live"?"pulse 1.5s infinite":"none"}}/>
          {SL2[status]}
        </div>
      </div>

      <div style={{maxWidth:480,margin:"0 auto",padding:"0 12px"}}>

        {/* DEMO / RÉEL */}
        <div style={{display:"flex",gap:8,padding:"12px 0 8px"}}>
          <button onClick={()=>setMode("demo")} style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid #ffd600",fontWeight:700,fontSize:13,background:mode==="demo"?"#ffd600":"transparent",color:mode==="demo"?"#000":"#ffd600",transition:"all .2s"}}>🟡 DEMO</button>
          <button onClick={()=>setMode("reel")} style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid #00e676",fontWeight:700,fontSize:13,background:mode==="reel"?"#00e676":"transparent",color:mode==="reel"?"#000":"#00e676",transition:"all .2s"}}>🟢 RÉEL</button>
        </div>

        {/* Solde */}
        <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5"}}>💰 Solde {mode==="demo"?"Démo":"Réel Binance"}</div>
            {mode==="reel"&&<button onClick={fetchBalance} style={{background:"none",border:"1px solid #1e2a3a",borderRadius:6,color:"#00b4d8",fontSize:10,padding:"3px 8px"}}>{balLoading?<span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span>:"↻"}</button>}
          </div>
          {mode==="demo"?(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {Object.entries(demoBalance).map(([k,v])=>(
                <div key={k} style={{background:"#0d1b2a",borderRadius:8,padding:"5px 9px",minWidth:75}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:1}}>{k}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#ffd600",fontWeight:700}}>{parseFloat(v).toFixed(3)}</div>
                </div>
              ))}
            </div>
          ):balLoading?(
            <div style={{fontSize:11,color:"#4a6075",textAlign:"center",padding:"6px"}}><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> Chargement...</div>
          ):balance?(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {Object.entries(balance).slice(0,6).map(([k,v])=>(
                <div key={k} style={{background:"#0d1b2a",borderRadius:8,padding:"5px 9px",minWidth:75}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:1}}>{k}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#00e676",fontWeight:700}}>{parseFloat(v).toFixed(4)}</div>
                </div>
              ))}
            </div>
          ):(
            <div style={{fontSize:11,color:"#ff7777",padding:"8px",background:"#ff174415",borderRadius:8}}>❌ Backend hors ligne — clique ↻</div>
          )}
        </div>

        {/* Bot */}
        <div style={{background:"#0a1520",border:`1px solid ${botRunning?"#00e676":"#1e2a3a"}`,borderRadius:12,padding:"12px",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5"}}>🤖 Bot Automatique</div>
            <div style={{fontSize:10,color:botRunning?"#00e676":"#4a6075"}}>{botRunning?`Actif · ${cfg.label} · ${mode==="demo"?"Démo":"Réel"}`:"Inactif"}</div>
          </div>
          <button onClick={toggleBot} style={{padding:"8px 16px",borderRadius:8,border:"none",fontWeight:700,fontSize:12,background:botRunning?"#ff1744":"#00e676",color:botRunning?"#fff":"#000"}}>
            {botRunning?"⏹ STOP":"▶ START"}
          </button>
        </div>

        {/* Categories */}
        <div style={{display:"flex",gap:6,padding:"4px 0 8px",overflowX:"auto"}}>
          {CATS.map(c=>(
            <button key={c.id} onClick={()=>{setCategory(c.id);setAsset(ASSETS[c.id][0])}} style={{padding:"7px 12px",borderRadius:8,border:"1px solid",fontSize:12,fontWeight:500,whiteSpace:"nowrap",color:category===c.id?"#060c13":"#8899aa",background:category===c.id?"#00b4d8":"transparent",borderColor:category===c.id?"#00b4d8":"#1e2a3a",transition:"all .2s"}}>{c.icon} {c.label}</button>
          ))}
        </div>

        {/* Assets */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {ASSETS[category].map(a=>(
            <button key={a.id} onClick={()=>setAsset(a)} style={{padding:"10px 12px",borderRadius:11,border:"1px solid",textAlign:"left",background:asset?.id===a.id?"linear-gradient(135deg,#0d2340,#0d2a40)":"#0a1520",borderColor:asset?.id===a.id?"#00b4d8":"#1e2a3a",transition:"all .2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:18}}>{a.icon}</span>
                <div>
                  <div style={{fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace",color:asset?.id===a.id?"#00b4d8":"#cdd9e5"}}>{a.symbol}</div>
                  <div style={{fontSize:9,color:"#4a6075"}}>{a.name}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Prix */}
        <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:16,padding:"16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:9,color:"#4a6075",letterSpacing:2,marginBottom:3}}>PRIX · {cfg.label}</div>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:24,fontWeight:700,color:"#e0f0ff"}}>
                {price?fmt(price):<span style={{opacity:.3,fontSize:16}}>Chargement...</span>}
                {isCrypto&&<span style={{fontSize:11,color:"#4a6075",marginLeft:4}}>USD</span>}
              </div>
              {analysis&&<div style={{fontSize:9,color:"#4a6075",marginTop:2}}>ATR: {analysis.atrPct.toFixed(2)}% · Vol: {analysis.volRatio.toFixed(1)}x</div>}
            </div>
            <div style={{padding:"5px 10px",borderRadius:20,background:change>=0?"#00e67615":"#ff174415",color:change>=0?"#00e676":"#ff1744",fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700}}>{change>=0?"+":""}{typeof change==="number"?change.toFixed(2):"0.00"}%</div>
          </div>
          <Sparkline candles={candles} color={change>=0?"#00e676":"#ff1744"}/>
          <div style={{fontSize:9,color:"#2a3a4a",marginTop:4,display:"flex",justifyContent:"space-between"}}>
            <span>{status==="live"?"Binance WebSocket":"Mode démo"}</span>
            <span>MAJ: {lastUpdate?lastUpdate.toLocaleTimeString("fr-FR"):"---"}</span>
          </div>
        </div>

        {/* Style */}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {STYLES.map(s=>(
            <button key={s.id} onClick={()=>setStyle(s.id)} style={{flex:1,padding:"9px 4px",borderRadius:10,border:`2px solid ${style===s.id?"#ffd600":"#1e2a3a"}`,textAlign:"center",color:style===s.id?"#060c13":"#8899aa",background:style===s.id?"#ffd600":"transparent",transition:"all .2s"}}>
              <div style={{fontSize:15}}>{s.icon}</div>
              <div style={{fontSize:11,fontWeight:700,marginTop:1}}>{s.label}</div>
              <div style={{fontSize:9,opacity:.7}}>{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Signal principal */}
        {analysis?(
          <div className="fade" style={{background:`linear-gradient(135deg,${analysis.color}12,${analysis.color}04)`,border:`2px solid ${analysis.color}`,borderRadius:16,padding:"16px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
              <div style={{width:70,height:70,borderRadius:"50%",flexShrink:0,background:`${analysis.color}18`,border:`3px solid ${analysis.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Mono',monospace",fontSize:analysis.signal==="WAIT"?11:17,fontWeight:900,color:analysis.color,boxShadow:`0 0 28px ${analysis.color}35`}}>
                {analysis.signal==="BUY"?"BUY":analysis.signal==="SELL"?"SELL":"⏳"}
              </div>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:analysis.color,letterSpacing:2,marginBottom:3}}>
                  {analysis.signal==="BUY"?"SIGNAL D'ACHAT":analysis.signal==="SELL"?"SIGNAL DE VENTE":"ATTENDRE"}
                </div>
                <div style={{fontSize:12,color:"#cdd9e5",lineHeight:1.5,marginBottom:6}}>{analysis.advice}</div>
                {analysis.signal!=="WAIT"&&(
                  <div style={{display:"flex",gap:6,fontSize:10,flexWrap:"wrap"}}>
                    <span style={{padding:"2px 7px",background:"#ff174420",color:"#ff7777",borderRadius:4}}>SL {fmt(analysis.sl)}</span>
                    <span style={{padding:"2px 7px",background:"#00e67620",color:"#00e676",borderRadius:4}}>TP {fmt(analysis.tp)}</span>
                    <span style={{padding:"2px 7px",background:"#ffffff10",color:"#8899aa",borderRadius:4}}>Conf. {Math.round(analysis.confidence)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Barre de confiance */}
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:10,color:"#8899aa"}}>Score de confiance</span>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:analysis.color,fontWeight:700}}>{analysis.score>0?"+":""}{analysis.score} / {analysis.thr} requis</span>
              </div>
              <div style={{height:8,background:"#1e2a3a",borderRadius:4,overflow:"hidden"}}>
                <div style={{width:`${Math.min(Math.abs(analysis.score)/12*100,100)}%`,height:"100%",background:analysis.color,borderRadius:4,transition:"width .8s"}}/>
              </div>
            </div>

            {/* Timing */}
            {analysis.signal!=="WAIT"&&(
              <div style={{background:"#0d1b2a",borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${analysis.color}`,marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:"#cdd9e5",marginBottom:3}}>⏱️ Timing estimé</div>
                <div style={{fontSize:11,color:"#8899aa"}}>
                  {style==="scalping"&&`Cible dans ${analysis.confidence>70?"2-5":"5-15"} minutes`}
                  {style==="day"&&`Cible dans ${analysis.confidence>70?"15-45":"30-90"} minutes`}
                  {style==="swing"&&`Cible dans ${analysis.confidence>70?"2-6":"6-24"} heures`}
                </div>
              </div>
            )}

            {/* Raisons du signal */}
            <button onClick={()=>setShowReasons(!showReasons)} style={{width:"100%",background:"#0d1b2a",border:"1px solid #1e2a3a",borderRadius:8,padding:"8px",color:"#8899aa",fontSize:10,textAlign:"left"}}>
              {showReasons?"▲":"▼"} {analysis.reasons.length} raisons du signal
            </button>
            {showReasons&&(
              <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:4}}>
                {analysis.reasons.map((r,i)=>(
                  <div key={i} style={{fontSize:10,color:"#cdd9e5",padding:"5px 8px",background:"#0d1b2a",borderRadius:6,borderLeft:`2px solid ${analysis.color}`}}>
                    {r.includes("FORT")||r.includes("fort")||r.includes("très")?"🔥":"•"} {r}
                  </div>
                ))}
              </div>
            )}
          </div>
        ):(
          <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:16,padding:"16px",marginBottom:12,textAlign:"center",color:"#4a6075",fontSize:12}}>
            Chargement des données ({candles.length}/30 bougies)...
          </div>
        )}

        {/* Trade actif */}
        {activeTrade&&(
          <div style={{background:"linear-gradient(135deg,#00b4d820,#00b4d808)",border:"2px solid #00b4d8",borderRadius:16,padding:"14px",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,color:"#00b4d8",marginBottom:2}}>🔴 TRADE EN COURS — {activeTrade.side} {activeTrade.symbol}</div>
                <div style={{fontSize:10,color:"#8899aa"}}>Entrée: <span style={{color:"#e0f0ff"}}>{fmt(activeTrade.entryPrice)}</span> · Qté: <span style={{color:"#e0f0ff"}}>{activeTrade.qty}</span></div>
                <div style={{fontSize:10,color:"#8899aa",marginTop:2}}>SL: <span style={{color:"#ff7777"}}>{fmt(activeTrade.sl)}</span> · TP: <span style={{color:"#00e676"}}>{fmt(activeTrade.tp)}</span></div>
                {price&&<div style={{fontSize:12,fontWeight:700,marginTop:4,color:(activeTrade.side==="BUY"?(price-activeTrade.entryPrice):(activeTrade.entryPrice-price))>=0?"#00e676":"#ff1744"}}>
                  PnL: {((activeTrade.side==="BUY"?(price-activeTrade.entryPrice):(activeTrade.entryPrice-price))/activeTrade.entryPrice*100)>=0?"+":""}
                  {((activeTrade.side==="BUY"?(price-activeTrade.entryPrice):(activeTrade.entryPrice-price))/activeTrade.entryPrice*100).toFixed(2)}%
                </div>}
              </div>
              <button onClick={()=>closeTrade("Manuel 🛑","neutral")} style={{padding:"10px 14px",borderRadius:10,border:"none",background:"#ff1744",color:"#fff",fontWeight:700,fontSize:12,flexShrink:0}}>⏹ STOP</button>
            </div>
            <Countdown seconds={activeTrade.secondsLeft} onEnd={()=>closeTrade("Temps écoulé ⏰","neutral")}/>
          </div>
        )}

        {/* Panneau d'ordre */}
        <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:16,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:10}}>🎯 Nouveau trade {mode==="demo"?"(simulation)":"(RÉEL ⚠️)"}</div>
          {mode==="reel"&&<div style={{background:"#ff174415",border:"1px solid #ff174430",borderRadius:8,padding:"8px",marginBottom:8,fontSize:10,color:"#ff9999"}}>⚠️ RÉEL — ordres avec vrai argent Binance !</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,color:"#4a6075",marginBottom:4}}>Quantité</div>
              <input value={qty} onChange={e=>setQty(e.target.value)} style={{width:"100%",padding:"8px 10px",background:"#0d1b2a",border:"1px solid #1e2a3a",borderRadius:8,color:"#e0f0ff",fontSize:13,outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:9,color:"#4a6075",marginBottom:4}}>⏱️ Durée (min)</div>
              <input type="number" min="1" max="1440" value={tradeDuration} onChange={e=>setTradeDuration(e.target.value)} style={{width:"100%",padding:"8px 10px",background:"#0d1b2a",border:"1px solid #00b4d8",borderRadius:8,color:"#00b4d8",fontSize:13,outline:"none",fontFamily:"'Space Mono',monospace",fontWeight:700}}/>
            </div>
          </div>
          <div style={{background:"#0d1b2a",borderRadius:8,padding:"8px",marginBottom:10,fontSize:10,color:"#8899aa"}}>
            ⏱️ Fermeture auto dans <span style={{color:"#00b4d8",fontWeight:700}}>{tradeDuration||"5"} min</span> ou au SL/TP
          </div>
          {orderMsg==="loading"&&<div style={{textAlign:"center",color:"#00b4d8",fontSize:11,padding:"6px",marginBottom:8}}><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> Ouverture...</div>}
          {orderMsg==="success"&&<div style={{textAlign:"center",color:"#00e676",fontSize:11,padding:"6px",marginBottom:8,background:"#00e67610",borderRadius:8}}>✅ Trade ouvert !</div>}
          {orderMsg==="simulated"&&<div style={{textAlign:"center",color:"#ffd600",fontSize:11,padding:"6px",marginBottom:8,background:"#ffd60010",borderRadius:8}}>🟡 Trade démo ouvert !</div>}
          {orderMsg==="error"&&<div style={{textAlign:"center",color:"#ff1744",fontSize:11,padding:"6px",marginBottom:8,background:"#ff174415",borderRadius:8}}>❌ Erreur connexion</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>placeOrder("BUY")} disabled={!!activeTrade} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:activeTrade?"#1e2a3a":"linear-gradient(135deg,#00c853,#00e676)",color:activeTrade?"#4a6075":"#002200",fontSize:14,fontWeight:700,opacity:activeTrade?0.5:1}}>▲ BUY</button>
            <button onClick={()=>placeOrder("SELL")} disabled={!!activeTrade} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:activeTrade?"#1e2a3a":"linear-gradient(135deg,#d50000,#ff1744)",color:activeTrade?"#4a6075":"#fff",fontSize:14,fontWeight:700,opacity:activeTrade?0.5:1}}>▼ SELL</button>
          </div>
          {activeTrade&&<div style={{textAlign:"center",fontSize:10,color:"#4a6075",marginTop:6}}>⚠️ Arrête le trade actuel avant d'en ouvrir un nouveau</div>}
        </div>

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:"1px solid #1e2a3a",marginBottom:12}}>
          {[{id:"signal",label:"📊 Indicateurs"},{id:"orders",label:`📋 Trades (${orders.length})`}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"9px 4px",border:"none",background:"none",fontSize:11,fontWeight:500,color:tab===t.id?"#00b4d8":"#4a6075",borderBottom:tab===t.id?"2px solid #00b4d8":"2px solid transparent",transition:"all .2s"}}>{t.label}</button>
          ))}
        </div>

        {/* Indicateurs avancés */}
        {tab==="signal"&&analysis&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            {/* RSI + Stoch RSI */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>📈 Momentum</div>
              <ScoreBar label="RSI (14)" value={analysis.rsi} min={0} max={100}/>
              <ScoreBar label="Stochastique RSI" value={analysis.stochRsi} min={0} max={100}/>
            </div>

            {/* EMA */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>📉 Moyennes Mobiles</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                {[{l:"EMA 9",v:fmt(analysis.ema9),c:"#00b4d8"},{l:"EMA 20",v:fmt(analysis.ema20),c:"#ffd600"},{l:"EMA 50",v:fmt(analysis.ema50),c:"#e040fb"}].map(i=>(
                  <div key={i.l} style={{background:"#0d1b2a",borderRadius:8,padding:"7px",textAlign:"center"}}>
                    <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>{i.l}</div>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:i.c,fontWeight:700}}>{i.v}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:10,padding:"6px 8px",borderRadius:6,background:analysis.trendUp?"#00e67615":analysis.trendDown?"#ff174415":"#ffffff10",color:analysis.trendUp?"#00e676":analysis.trendDown?"#ff1744":"#8899aa"}}>
                {analysis.trendUp?"↑ Tendance HAUSSIÈRE (EMA9>20>50)":analysis.trendDown?"↓ Tendance BAISSIÈRE (EMA9<20<50)":"→ Tendance NEUTRE"}
              </div>
            </div>

            {/* MACD */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>⚡ MACD</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"#0d1b2a",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>MACD</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.macd>0?"#00e676":"#ff1744",fontWeight:700}}>{analysis.macd>0?"↑":"↓"} {Math.abs(analysis.macd).toFixed(4)}</div>
                </div>
                <div style={{background:"#0d1b2a",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>Histogramme</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.macdHist>0?"#00e676":"#ff1744",fontWeight:700}}>{analysis.macdHist>0?"↑":"↓"} {Math.abs(analysis.macdHist).toFixed(4)}</div>
                </div>
              </div>
            </div>

            {/* Bollinger */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>🎯 Bollinger Bands</div>
              <div style={{height:8,background:"#1e2a3a",borderRadius:4,position:"relative",marginBottom:4}}>
                <div style={{position:"absolute",left:`${Math.max(2,Math.min(98,analysis.bbPos*100))}%`,top:0,bottom:0,width:4,background:"#00b4d8",borderRadius:2,transform:"translateX(-50%)",transition:"left .8s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4a6075",marginBottom:6}}><span>Survente</span><span>Neutre</span><span>Surachat</span></div>
              <div style={{fontSize:10,color:"#8899aa"}}>Largeur: <span style={{color:analysis.bbWidth>0.05?"#ffd600":"#00b4d8"}}>{(analysis.bbWidth*100).toFixed(2)}%</span> {analysis.bbWidth>0.05?"(Haute volatilité)":"(Faible volatilité)"}</div>
            </div>

            {/* Volume */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>📊 Volume</div>
              <ScoreBar label={`Volume relatif (${analysis.volRatio.toFixed(1)}x la moyenne)`} value={Math.min(analysis.volRatio*50,100)} min={0} max={100} lowColor="#4a6075" highColor="#00e676"/>
              <div style={{fontSize:10,color:analysis.volRatio>1.5?"#00e676":analysis.volRatio<0.5?"#ff7777":"#8899aa"}}>
                {analysis.volRatio>2?"🔥 Volume très fort — signal fiable":analysis.volRatio>1.5?"✅ Volume fort — signal confirmé":analysis.volRatio<0.5?"⚠️ Volume faible — signal moins fiable":"Volume normal"}
              </div>
            </div>

            {/* Support / Résistance */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>🏗️ Support / Résistance</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:analysis.nearSupport?"#00e67615":"#0d1b2a",border:analysis.nearSupport?"1px solid #00e67640":"1px solid transparent",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>Support (distance)</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.nearSupport?"#00e676":"#8899aa",fontWeight:700}}>{analysis.distToSupport.toFixed(2)}%</div>
                  {analysis.nearSupport&&<div style={{fontSize:9,color:"#00e676"}}>⚡ Proche!</div>}
                </div>
                <div style={{background:analysis.nearResistance?"#ff174415":"#0d1b2a",border:analysis.nearResistance?"1px solid #ff174440":"1px solid transparent",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>Résistance (distance)</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.nearResistance?"#ff1744":"#8899aa",fontWeight:700}}>{analysis.distToResistance.toFixed(2)}%</div>
                  {analysis.nearResistance&&<div style={{fontSize:9,color:"#ff1744"}}>⚠️ Proche!</div>}
                </div>
              </div>
            </div>

            {/* Tendance */}
            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>🌊 Tendance</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"#0d1b2a",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>Court terme (5 bougies)</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.trend5>=0?"#00e676":"#ff1744",fontWeight:700}}>{analysis.trend5>=0?"+":""}{analysis.trend5.toFixed(2)}%</div>
                </div>
                <div style={{background:"#0d1b2a",borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>Moyen terme (24 bougies)</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:analysis.trend24>=0?"#00e676":"#ff1744",fontWeight:700}}>{analysis.trend24>=0?"+":""}{analysis.trend24.toFixed(2)}%</div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Historique des trades */}
        {tab==="orders"&&(
          <div>
            {orders.length===0?(
              <div style={{textAlign:"center",color:"#4a6075",padding:"30px 0",fontSize:12}}>Aucun trade encore.</div>
            ):orders.map(o=>(
              <div key={o.id} style={{background:"#0a1520",border:`1px solid ${o.side==="BUY"?"#00e67630":"#ff174430"}`,borderLeft:`3px solid ${o.side==="BUY"?"#00e676":"#ff1744"}`,borderRadius:12,padding:"10px 12px",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,color:o.side==="BUY"?"#00e676":"#ff1744"}}>{o.side}</span>
                      <span style={{fontSize:11,color:"#cdd9e5"}}>{o.symbol}</span>
                      <span style={{fontSize:9,color:o.mode==="demo"?"#ffd600":"#00e676",background:o.mode==="demo"?"#ffd60015":"#00e67615",padding:"1px 5px",borderRadius:3}}>{o.mode==="demo"?"DÉMO":"RÉEL"}</span>
                    </div>
                    <div style={{fontSize:10,color:"#4a6075"}}>{o.qty} · {o.time}</div>
                    <div style={{fontSize:10,color:"#8899aa",marginTop:2}}>{o.status}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:"#e0f0ff"}}>{fmt(o.entryPrice)}</div>
                    {o.pnl&&<div style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,color:o.pnl?.startsWith("+")||o.pnl==="0.00%"?"#00e676":"#ff1744"}}>{o.pnl}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{textAlign:"center",marginTop:20,fontSize:9,color:"#1e2a3a",lineHeight:1.7}}>⚠️ Application éducative · Pas de conseil financier · Trading = risque de perte</div>
      </div>
    </div>
  );
}
