import React, { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://ton-bot.railway.app";
const BINANCE_WS  = "wss://stream.binance.com:9443/ws";

const ASSETS = {
  crypto: [
    { id:"BTCUSDT",  symbol:"BTC/USDT", name:"Bitcoin",   icon:"₿"  },
    { id:"ETHUSDT",  symbol:"ETH/USDT", name:"Ethereum",  icon:"Ξ"  },
    { id:"SOLUSDT",  symbol:"SOL/USDT", name:"Solana",    icon:"◎"  },
    { id:"BNBUSDT",  symbol:"BNB/USDT", name:"BNB",       icon:"🔶" },
    { id:"XRPUSDT",  symbol:"XRP/USDT", name:"Ripple",    icon:"✕"  },
    { id:"ADAUSDT",  symbol:"ADA/USDT", name:"Cardano",   icon:"₳"  },
  ],
  forex: [
    { id:"EURUSD",  symbol:"EUR/USD", name:"Euro/Dollar",   icon:"€" },
    { id:"GBPUSD",  symbol:"GBP/USD", name:"Livre/Dollar",  icon:"£" },
    { id:"USDJPY",  symbol:"USD/JPY", name:"Dollar/Yen",    icon:"¥" },
    { id:"USDCHF",  symbol:"USD/CHF", name:"Dollar/CHF",    icon:"🇨🇭"},
  ],
  stocks: [
    { id:"AAPL",  symbol:"AAPL",  name:"Apple",     icon:"🍎" },
    { id:"TSLA",  symbol:"TSLA",  name:"Tesla",     icon:"⚡" },
    { id:"NVDA",  symbol:"NVDA",  name:"NVIDIA",    icon:"🟢" },
    { id:"MSFT",  symbol:"MSFT",  name:"Microsoft", icon:"🪟" },
  ],
  indices: [
    { id:"SPY",  symbol:"S&P500",  name:"S&P 500",   icon:"🇺🇸" },
    { id:"QQQ",  symbol:"NASDAQ",  name:"NASDAQ 100",icon:"💻" },
  ],
};

// ─────────────────────────────────────────────
//  BINANCE WEBSOCKET HOOK
// ─────────────────────────────────────────────
function useLivePrice(asset) {
  const [price,   setPrice]   = useState(null);
  const [change,  setChange]  = useState(0);
  const [history, setHistory] = useState([]);
  const [status,  setStatus]  = useState("connecting");
  const wsRef = useRef(null);

  useEffect(() => {
    if (!asset) return;
    setPrice(null); setHistory([]); setStatus("connecting");

    const isCrypto = ["crypto"].includes(
      Object.keys(ASSETS).find(k => ASSETS[k].some(a => a.id === asset.id))
    );

    if (isCrypto) {
      // Binance REST pour historique
      fetch(`https://api.binance.com/api/v3/klines?symbol=${asset.id}&interval=1m&limit=60`)
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) return;
          const pts = data.map(k => ({ t: k[0], v: parseFloat(k[4]) }));
          setHistory(pts);
          setPrice(pts[pts.length-1]?.v);
          const f = pts[0]?.v, l = pts[pts.length-1]?.v;
          if (f && l) setChange(((l-f)/f)*100);
          setStatus("live");
        }).catch(() => setStatus("error"));

      // WebSocket temps réel
      wsRef.current = new WebSocket(`${BINANCE_WS}/${asset.id.toLowerCase()}@aggTrade`);
      wsRef.current.onopen  = () => setStatus("live");
      wsRef.current.onclose = () => setStatus("disconnected");
      wsRef.current.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const p = parseFloat(d.p);
        setPrice(p);
        setHistory(h => {
          const upd = [...h.slice(-59), { t: d.T, v: p }];
          const f = upd[0]?.v;
          if (f) setChange(((p-f)/f)*100);
          return upd;
        });
      };
    } else {
      // Simulation pour forex/stocks (nécessite backend)
      const base = { EURUSD:1.085, GBPUSD:1.27, USDJPY:154.5, USDCHF:0.91,
                     AAPL:189, TSLA:175, NVDA:870, MSFT:420, SPY:530, QQQ:450 }[asset.id] || 100;
      let p = base;
      const hist = [];
      for (let i=59;i>=0;i--) {
        p = p*(1+(Math.random()-0.495)*0.003);
        hist.push({t:Date.now()-i*60000, v:parseFloat(p.toFixed(asset.id.includes("JPY")?3:5))});
      }
      setHistory(hist); setPrice(hist[hist.length-1].v); setStatus("demo");
      const iv = setInterval(() => {
        setPrice(prev => {
          if (!prev) return prev;
          const next = parseFloat((prev*(1+(Math.random()-0.495)*0.003)).toFixed(5));
          setHistory(h => {
            const upd = [...h.slice(-59),{t:Date.now(),v:next}];
            setChange(((upd[upd.length-1].v-upd[0].v)/upd[0].v)*100);
            return upd;
          });
          return next;
        });
      }, 3000);
      return () => clearInterval(iv);
    }

    return () => wsRef.current?.close();
  }, [asset?.id]);

  return { price, change, history, status };
}

// ─────────────────────────────────────────────
//  ANALYSE TECHNIQUE
// ─────────────────────────────────────────────
function analyze(history, style) {
  if (history.length < 20) return null;
  const p = history.map(h => h.v);
  const n = p.length;

  const gains=[], losses=[];
  for (let i=1;i<p.length;i++) {
    const d=p[i]-p[i-1];
    gains.push(d>0?d:0); losses.push(d<0?-d:0);
  }
  const avgG=gains.slice(-14).reduce((a,b)=>a+b,0)/14;
  const avgL=losses.slice(-14).reduce((a,b)=>a+b,0)/14;
  const rsi=100-100/(1+(avgL===0?100:avgG/avgL));

  const ema=(period)=>{
    const k=2/(period+1);
    let e=p.slice(0,period).reduce((a,b)=>a+b,0)/period;
    for(let i=period;i<p.length;i++) e=p[i]*k+e*(1-k);
    return e;
  };
  const ema9=ema(9),ema20=ema(20),ema12=ema(12),ema26=ema(26);
  const macd=ema12-ema26;
  const sma20=p.slice(-20).reduce((a,b)=>a+b,0)/20;
  const std=Math.sqrt(p.slice(-20).map(v=>(v-sma20)**2).reduce((a,b)=>a+b,0)/20);
  const upper=sma20+2*std,lower=sma20-2*std;
  const bbPos=(p[n-1]-lower)/(upper-lower||1);

  let score=0;
  if(rsi<30)score+=3; else if(rsi<45)score+=1;
  if(rsi>70)score-=3; else if(rsi>55)score-=1;
  if(ema9>ema20)score+=2; else score-=2;
  if(macd>0)score+=1; else score-=1;
  if(bbPos<0.2)score+=2; else if(bbPos>0.8)score-=2;

  const thr={scalping:2,day:3,swing:4}[style]||3;
  const cur=p[n-1];
  let signal="WAIT",color="#ffd600",advice="",sl=0,tp=0;

  if(score>=thr){
    signal="BUY"; color="#00e676";
    sl=parseFloat((cur*0.98).toFixed(6));
    tp=parseFloat((cur*1.04).toFixed(6));
    advice=score>=6?"Signal FORT d'achat ✅":"Signal modéré d'achat";
  } else if(score<=-thr){
    signal="SELL"; color="#ff1744";
    sl=parseFloat((cur*1.02).toFixed(6));
    tp=parseFloat((cur*0.96).toFixed(6));
    advice=score<=-6?"Signal FORT de vente 🔴":"Signal modéré de vente";
  } else {
    advice="Marché indécis — attends une confirmation";
  }

  return { signal,color,advice,rsi,ema9,ema20,macd,bbPos,sl,tp,
           strength:Math.min(Math.abs(score)/8*100,100) };
}

// ─────────────────────────────────────────────
//  COMPOSANTS
// ─────────────────────────────────────────────
function Sparkline({ history, color }) {
  if (!history||history.length<2) return null;
  const vals=history.map(h=>h.v);
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const W=300,H=70;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*W},${H-((v-min)/range)*(H-8)-4}`).join(" ");
  const last=pts.split(" ").pop().split(",");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}}>
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#grad)"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="4" fill={color} opacity="0.9"/>
    </svg>
  );
}

// ─────────────────────────────────────────────
//  APP
// ─────────────────────────────────────────────
export default function App() {
  const [category, setCategory] = useState("crypto");
  const [asset,    setAsset]    = useState(ASSETS.crypto[0]);
  const [style,    setStyle]    = useState("day");
  const [tab,      setTab]      = useState("signal");
  const [qty,      setQty]      = useState("0.001");
  const [orders,   setOrders]   = useState([]);
  const [orderMsg, setOrderMsg] = useState(null);

  const { price, change, history, status } = useLivePrice(asset);
  const analysis = price ? analyze(history, style) : null;

  const isCrypto = category === "crypto";
  const fmt = v => {
    if (!v) return "---";
    if (isCrypto && v>=1000) return v.toLocaleString("fr-FR",{maximumFractionDigits:2});
    if (isCrypto) return v.toFixed(2);
    return v.toFixed(5);
  };

  // Envoyer ordre au backend Railway
  const placeOrder = async (side) => {
    setOrderMsg("loading");
    try {
      const res = await fetch(`${BACKEND_URL}/api/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: asset.id, side, qty: parseFloat(qty), broker: isCrypto?"binance":"alpaca" }),
      });
      const data = await res.json();
      setOrders(o => [{
        id: data.orderId || `ORD-${Date.now()}`,
        side, symbol: asset.symbol, qty, price,
        time: new Date().toLocaleTimeString("fr-FR"),
        status: data.status || "FILLED",
      }, ...o.slice(0,19)]);
      setOrderMsg("success");
    } catch {
      // Fallback simulation si backend pas encore connecté
      setOrders(o => [{
        id:`SIM-${Date.now()}`, side, symbol:asset.symbol,
        qty, price, time:new Date().toLocaleTimeString("fr-FR"), status:"SIMULATED",
      }, ...o.slice(0,19)]);
      setOrderMsg("simulated");
    }
    setTimeout(() => setOrderMsg(null), 3000);
  };

  const STATUS_COLOR = { live:"#00e676", demo:"#ffd600", connecting:"#00b4d8", disconnected:"#ff1744", error:"#ff1744" };
  const STATUS_LABEL = { live:"LIVE", demo:"DÉMO", connecting:"...", disconnected:"OFF", error:"ERR" };

  const CATS   = [{id:"crypto",icon:"₿",label:"Crypto"},{id:"forex",icon:"💱",label:"Forex"},{id:"stocks",icon:"📈",label:"Actions"},{id:"indices",icon:"🌐",label:"Indices"}];
  const STYLES = [{id:"scalping",icon:"⚡",label:"Scalping",desc:"Min"},{id:"day",icon:"☀️",label:"Day",desc:"Jour"},{id:"swing",icon:"🌊",label:"Swing",desc:"Sem"}];

  return (
    <div style={{minHeight:"100vh",background:"#060c13",fontFamily:"'DM Sans',sans-serif",color:"#cdd9e5",paddingBottom:40}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        button{cursor:pointer;font-family:inherit}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .fade{animation:fadeIn .3s ease}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#1e2a3a;border-radius:2px}
      `}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0d1b2a,transparent)",padding:"18px 16px 12px",borderBottom:"1px solid #1a2636",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"linear-gradient(135deg,#00b4d8,#0077b6)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📈</div>
          <div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:16,fontWeight:700,color:"#e0f0ff",letterSpacing:1}}>TRADEIQ</div>
            <div style={{fontSize:9,color:"#4a6075",letterSpacing:2}}>LIVE TRADING</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"#0d1b2a",border:`1px solid ${STATUS_COLOR[status]}40`,borderRadius:20,padding:"4px 10px",fontSize:10,color:STATUS_COLOR[status],fontFamily:"'Space Mono',monospace"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:STATUS_COLOR[status],display:"inline-block",animation:status==="live"?"pulse 1.5s infinite":"none"}}/>
          {STATUS_LABEL[status]}
        </div>
      </div>

      <div style={{maxWidth:480,margin:"0 auto",padding:"0 12px"}}>

        {/* Categories */}
        <div style={{display:"flex",gap:6,padding:"12px 0 8px",overflowX:"auto"}}>
          {CATS.map(c=>(
            <button key={c.id} onClick={()=>{setCategory(c.id);setAsset(ASSETS[c.id][0])}} style={{
              padding:"7px 12px",borderRadius:8,border:"1px solid",fontSize:12,fontWeight:500,whiteSpace:"nowrap",background:"none",
              color:category===c.id?"#060c13":"#8899aa",
              background:category===c.id?"#00b4d8":"transparent",
              borderColor:category===c.id?"#00b4d8":"#1e2a3a",transition:"all .2s",
            }}>{c.icon} {c.label}</button>
          ))}
        </div>

        {/* Assets */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {ASSETS[category].map(a=>(
            <button key={a.id} onClick={()=>setAsset(a)} style={{
              padding:"10px 12px",borderRadius:11,border:"1px solid",textAlign:"left",background:"none",
              background:asset?.id===a.id?"linear-gradient(135deg,#0d2340,#0d2a40)":"#0a1520",
              borderColor:asset?.id===a.id?"#00b4d8":"#1e2a3a",transition:"all .2s",
            }}>
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

        {/* Price */}
        <div className="fade" key={asset?.id} style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:16,padding:"16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:9,color:"#4a6075",letterSpacing:2,marginBottom:3}}>PRIX {status==="live"?"EN DIRECT":"SIMULÉ"}</div>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:24,fontWeight:700,color:"#e0f0ff"}}>
                {price?fmt(price):<span style={{opacity:.3,fontSize:16}}>Chargement...</span>}
                {isCrypto&&<span style={{fontSize:11,color:"#4a6075",marginLeft:4}}>USD</span>}
              </div>
            </div>
            <div style={{padding:"5px 10px",borderRadius:20,background:change>=0?"#00e67615":"#ff174415",color:change>=0?"#00e676":"#ff1744",fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700}}>
              {change>=0?"+":""}{change.toFixed(2)}%
            </div>
          </div>
          <Sparkline history={history} color={change>=0?"#00e676":"#ff1744"}/>
          <div style={{fontSize:9,color:"#2a3a4a",marginTop:4}}>
            {status==="live"?"WebSocket Binance · temps réel":status==="demo"?"Mode démo":"Connexion..."}
          </div>
        </div>

        {/* Style */}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {STYLES.map(s=>(
            <button key={s.id} onClick={()=>setStyle(s.id)} style={{
              flex:1,padding:"9px 4px",borderRadius:10,border:"1px solid",textAlign:"center",background:"none",
              color:style===s.id?"#060c13":"#8899aa",
              background:style===s.id?"#ffd600":"transparent",
              borderColor:style===s.id?"#ffd600":"#1e2a3a",transition:"all .2s",
            }}>
              <div style={{fontSize:15}}>{s.icon}</div>
              <div style={{fontSize:11,fontWeight:700,marginTop:1}}>{s.label}</div>
              <div style={{fontSize:9,opacity:.6}}>{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Signal */}
        {analysis&&(
          <div className="fade" style={{
            background:`linear-gradient(135deg,${analysis.color}12,${analysis.color}04)`,
            border:`2px solid ${analysis.color}`,borderRadius:16,padding:"16px",marginBottom:12,
            display:"flex",alignItems:"center",gap:14,
          }}>
            <div style={{
              width:74,height:74,borderRadius:"50%",flexShrink:0,
              background:`${analysis.color}18`,border:`3px solid ${analysis.color}`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:"'Space Mono',monospace",fontSize:analysis.signal==="WAIT"?12:17,
              fontWeight:900,color:analysis.color,
              boxShadow:`0 0 28px ${analysis.color}35`,
            }}>
              {analysis.signal==="BUY"?"BUY":analysis.signal==="SELL"?"SELL":"⏳"}
            </div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:analysis.color,letterSpacing:2,marginBottom:3}}>
                {analysis.signal==="BUY"?"SIGNAL D'ACHAT":analysis.signal==="SELL"?"SIGNAL DE VENTE":"ATTENDRE"}
              </div>
              <div style={{fontSize:12,color:"#cdd9e5",lineHeight:1.5,marginBottom:6}}>{analysis.advice}</div>
              {analysis.signal!=="WAIT"&&(
                <div style={{display:"flex",gap:6,fontSize:10}}>
                  <span style={{padding:"2px 7px",background:"#ff174420",color:"#ff7777",borderRadius:4}}>SL {fmt(analysis.sl)}</span>
                  <span style={{padding:"2px 7px",background:"#00e67620",color:"#00e676",borderRadius:4}}>TP {fmt(analysis.tp)}</span>
                  <span style={{padding:"2px 7px",background:"#ffffff10",color:"#8899aa",borderRadius:4}}>Force {Math.round(analysis.strength)}%</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Order Panel */}
        <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:16,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:10}}>🎯 Passer un ordre</div>
          <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:9,color:"#4a6075",marginBottom:4}}>Quantité</div>
              <input value={qty} onChange={e=>setQty(e.target.value)} style={{width:"100%",padding:"8px 10px",background:"#0d1b2a",border:"1px solid #1e2a3a",borderRadius:8,color:"#e0f0ff",fontSize:13,outline:"none"}}/>
            </div>
            <div style={{fontSize:10,color:"#4a6075",paddingBottom:9}}>{asset?.symbol}</div>
          </div>

          {orderMsg==="loading"&&<div style={{textAlign:"center",color:"#00b4d8",fontSize:11,padding:"6px",marginBottom:8}}><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> Envoi...</div>}
          {orderMsg==="success"&&<div style={{textAlign:"center",color:"#00e676",fontSize:11,padding:"6px",marginBottom:8,background:"#00e67610",borderRadius:8}}>✅ Ordre envoyé au bot !</div>}
          {orderMsg==="simulated"&&<div style={{textAlign:"center",color:"#ffd600",fontSize:11,padding:"6px",marginBottom:8,background:"#ffd60010",borderRadius:8}}>🟡 Simulé — connecte le backend Railway</div>}

          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>placeOrder("BUY")} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#00c853,#00e676)",color:"#002200",fontSize:14,fontWeight:700}}>▲ BUY</button>
            <button onClick={()=>placeOrder("SELL")} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#d50000,#ff1744)",color:"#fff",fontSize:14,fontWeight:700}}>▼ SELL</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:"1px solid #1e2a3a",marginBottom:12}}>
          {[{id:"signal",label:"📊 Indicateurs"},{id:"orders",label:`📋 Ordres (${orders.length})`}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1,padding:"9px 4px",border:"none",background:"none",fontSize:11,fontWeight:500,
              color:tab===t.id?"#00b4d8":"#4a6075",
              borderBottom:tab===t.id?"2px solid #00b4d8":"2px solid transparent",transition:"all .2s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Indicateurs */}
        {tab==="signal"&&analysis&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              {label:"RSI (14)",val:analysis.rsi,min:0,max:100,lo:"Survente ✅",hi:"Surachat ❌"},
            ].map(i=>(
              <div key={i.label} style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:11,color:"#cdd9e5",fontWeight:700}}>{i.label}</span>
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:i.val<30?"#00e676":i.val>70?"#ff1744":"#ffd600"}}>{i.val.toFixed(1)}</span>
                </div>
                <div style={{height:6,background:"#1e2a3a",borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:`${i.val}%`,height:"100%",background:i.val<30?"#00e676":i.val>70?"#ff1744":"#ffd600",borderRadius:3,transition:"width .5s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4a6075",marginTop:3}}>
                  <span>{i.lo}</span><span>{i.hi}</span>
                </div>
              </div>
            ))}

            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>Moyennes Mobiles EMA</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[
                  {l:"EMA 9",v:fmt(analysis.ema9),c:"#00b4d8"},
                  {l:"EMA 20",v:fmt(analysis.ema20),c:"#ffd600"},
                  {l:"Signal",v:analysis.ema9>analysis.ema20?"↑ HAUSSE":"↓ BAISSE",c:analysis.ema9>analysis.ema20?"#00e676":"#ff1744"},
                ].map(i=>(
                  <div key={i.l} style={{background:"#0d1b2a",borderRadius:8,padding:"8px",textAlign:"center"}}>
                    <div style={{fontSize:9,color:"#4a6075",marginBottom:2}}>{i.l}</div>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:i.c,fontWeight:700}}>{i.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:"#0a1520",border:"1px solid #1e2a3a",borderRadius:12,padding:"12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#cdd9e5",marginBottom:8}}>Bandes de Bollinger</div>
              <div style={{height:8,background:"#1e2a3a",borderRadius:4,position:"relative"}}>
                <div style={{position:"absolute",left:`${Math.max(2,Math.min(98,analysis.bbPos*100))}%`,top:0,bottom:0,width:4,background:"#00b4d8",borderRadius:2,transform:"translateX(-50%)",transition:"left .5s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4a6075",marginTop:4}}>
                <span>Survente</span><span>Neutre</span><span>Surachat</span>
              </div>
            </div>
          </div>
        )}

        {/* Ordres */}
        {tab==="orders"&&(
          <div>
            {orders.length===0?(
              <div style={{textAlign:"center",color:"#4a6075",padding:"30px 0",fontSize:12}}>
                Aucun ordre encore.<br/>
                <span style={{fontSize:10}}>Clique BUY ou SELL pour commencer.</span>
              </div>
            ):orders.map(o=>(
              <div key={o.id} style={{
                background:"#0a1520",border:`1px solid ${o.side==="BUY"?"#00e67630":"#ff174430"}`,
                borderLeft:`3px solid ${o.side==="BUY"?"#00e676":"#ff1744"}`,
                borderRadius:12,padding:"10px 12px",marginBottom:8,
                display:"flex",justifyContent:"space-between",alignItems:"center",
              }}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,color:o.side==="BUY"?"#00e676":"#ff1744"}}>{o.side}</span>
                    <span style={{fontSize:11,color:"#cdd9e5"}}>{o.symbol}</span>
                    <span style={{fontSize:9,color:"#4a6075",background:"#1e2a3a",padding:"1px 5px",borderRadius:3}}>{o.status}</span>
                  </div>
                  <div style={{fontSize:10,color:"#4a6075"}}>{o.qty} · {o.time}</div>
                </div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:13,color:"#e0f0ff"}}>{fmt(o.price)}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{textAlign:"center",marginTop:20,fontSize:9,color:"#1e2a3a",lineHeight:1.7}}>
          ⚠️ Application éducative · Pas de conseil financier · Trading = risque de perte
        </div>
      </div>
    </div>
  );
}
