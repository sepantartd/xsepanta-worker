import { connect } from "cloudflare:sockets";
const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

let _cfg = null, _cfgT = 0;
async function getCfg(env) {
  const now = Date.now();
  if (_cfg && now - _cfgT < 10000) return _cfg;
  let cfg = null;
  try { const s = await env.DB.get("cfg"); if (s) cfg = JSON.parse(s); } catch (e) {}
  if (!cfg) {
    cfg = { pass: "xsepanta", uuid: crypto.randomUUID(), wsPath: "/xs", fake: "https://www.ubuntu.com", cleanIps: "", name: "XSEPANTA" };
    await env.DB.put("cfg", JSON.stringify(cfg)).catch(() => {});
  }
  if (!cfg.uuid) { cfg.uuid = crypto.randomUUID(); await env.DB.put("cfg", JSON.stringify(cfg)).catch(() => {}); }
  _cfg = cfg; _cfgT = now;
  return cfg;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const cfg = await getCfg(env);
    if ((req.headers.get("Upgrade") || "").toLowerCase() === "websocket") return vless(req, cfg);
    if (p === "/sub") return new Response(buildSub(cfg, url.hostname), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    if (p === "/" || p === "/panel") return new Response(PANEL, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (p === "/api/login" && req.method === "POST") {
      const b = await req.json();
      return j(b.p === cfg.pass ? { ok: 1 } : { ok: 0 }, b.p === cfg.pass ? 200 : 401);
    }
    if (p === "/api/get") {
      if (url.searchParams.get("k") !== cfg.pass) return j({ ok: 0 }, 401);
      return j({ ok: 1, cfg: cfg });
    }
    if (p === "/api/set" && req.method === "POST") {
      const b = await req.json();
      if (b.k !== cfg.pass) return j({ ok: 0 }, 401);
      const next = Object.assign({}, cfg, b.cfg);
      await env.DB.put("cfg", JSON.stringify(next));
      _cfg = null;
      return j({ ok: 1 });
    }
    try {
      const t = new URL(cfg.fake); t.pathname = url.pathname; t.search = url.search;
      const h = new Headers(req.headers); h.set("Host", t.hostname);
      return await fetch(t, { method: req.method, headers: h, redirect: "follow" });
    } catch (e) { return new Response("404", { status: 404 }); }
  }
};

function vless(req, cfg) {
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  server.binaryType = "arraybuffer";
  let ready = null;
  server.addEventListener("message", (ev) => {
    if (!ready) { ready = openTunnel(ev.data, server, cfg); return; }
    ready.then((w) => { if (w) return w.write(new Uint8Array(ev.data)); }).catch(() => { try { server.close(); } catch (e) {} });
  });
  server.addEventListener("error", () => {});
  return new Response(null, { status: 101, webSocket: client });
}

async function openTunnel(data, server, cfg) {
  const buf = new Uint8Array(data);
  if (buf[0] !== 0) { server.close(); return null; }
  if (hex(buf.slice(1, 17)) !== cfg.uuid.replace(/-/g, "").toLowerCase()) { server.close(); return null; }
  let off = 18 + buf[17];
  const port = (buf[off + 1] << 8) | buf[off + 2];
  const at = buf[off + 3];
  let addr = "", len = 0;
  if (at === 1) { len = 4; addr = Array.from(buf.slice(off + 4, off + 8)).join("."); }
  else if (at === 2) { len = buf[off + 4]; addr = new TextDecoder().decode(buf.slice(off + 5, off + 5 + len)); }
  else if (at === 3) { len = 16; const dv = new DataView(data, off + 4, 16); addr = Array.from({ length: 8 }, (_, i) => dv.getUint16(i * 2).toString(16)).join(":"); }
  else { server.close(); return null; }
  const start = off + 4 + len;
  let sock;
  try { sock = connect({ hostname: addr, port: port }); await sock.opened; } catch (e) { server.close(); return null; }
  server.send(new Uint8Array([0, 0]));
  const writer = sock.writable.getWriter();
  if (start < buf.length) await writer.write(buf.slice(start));
  sock.readable.pipeTo(new WritableStream({
    write(c) { server.send(c); },
    close() { try { server.close(); } catch (e) {} },
    abort() { try { server.close(); } catch (e) {} }
  })).catch(() => {});
  return writer;
}

function buildSub(cfg, host) {
  const ips = (cfg.cleanIps || "").split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const params = ":443?encryption=none&security=tls&sni=" + host + "&type=ws&host=" + host + "&path=" + cfg.wsPath + "&alpn=http/1.1&fp=randomized";
  const out = ["vless://" + cfg.uuid + "@" + host + params + "#" + encodeURIComponent(cfg.name + " | AUTO")];
  ips.forEach((ip, i) => out.push("vless://" + cfg.uuid + "@" + ip + params + "#" + encodeURIComponent(cfg.name + " | IP" + (i + 1))));
  return out.join("\n");
}

const PANEL = '<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XSEPANTA</title><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Vazirmatn,system-ui,sans-serif}body{min-height:100vh;background:linear-gradient(135deg,#0f0c29,#302b63 55%,#24243e);color:#eef;padding:18px}.wrap{max-width:520px;margin:0 auto}.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(16px);border-radius:22px;padding:22px;margin-top:14px;box-shadow:0 12px 40px rgba(0,0,0,.35)}.logo{width:64px;height:64px;margin:0 auto 10px;border-radius:18px;background:linear-gradient(135deg,#7f5bf5,#2ac9de);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900;color:#fff;box-shadow:0 8px 24px rgba(127,91,245,.45)}h1{text-align:center;font-size:22px;letter-spacing:1px;background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}.sub{text-align:center;opacity:.6;font-size:12px;margin:6px 0 16px}input,textarea{width:100%;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:12px;color:#fff;padding:12px;font-size:14px;margin:6px 0;outline:none}input:focus,textarea:focus{border-color:#7f5bf5}label{font-size:12px;opacity:.7}button{width:100%;border:0;border-radius:12px;padding:12px;margin-top:8px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(90deg,#7f5bf5,#2ac9de);cursor:pointer}button.alt{background:rgba(255,255,255,.12)}.row{display:flex;gap:8px}.row input{flex:1}.row button{width:auto;margin:6px 0 0}.hide{display:none}.top{display:flex;align-items:center;gap:10px;margin-top:16px}.top .logo{width:38px;height:38px;font-size:20px;margin:0;border-radius:12px}.top button{width:auto;margin:0 0 0 auto;padding:8px 14px;background:rgba(255,255,255,.12)}.dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80}.tabs{display:flex;gap:8px;margin-top:14px}.tab{background:rgba(255,255,255,.08);color:#cfd}.tab.on{background:linear-gradient(90deg,#7f5bf5,#2ac9de);color:#fff}.hint{font-size:11px;opacity:.55;margin-top:10px}#qrbox{text-align:center}#qrbox img{border-radius:12px;margin-top:10px;background:#fff;padding:8px}#toast{position:fixed;bottom:24px;right:50%;transform:translateX(50%);background:#16a34a;color:#fff;padding:10px 22px;border-radius:999px;opacity:0;transition:.3s;pointer-events:none}#toast.show{opacity:1}</style></head><body><div class="wrap"><div id="login" class="card"><div class="logo">X</div><h1>XSEPANTA</h1><p class="sub">پنل مدیریت اتصال</p><input id="pw" type="password" placeholder="رمز عبور"><button onclick="login()">ورود</button></div><div id="app" class="hide"><div class="top"><div class="logo">X</div><b>XSEPANTA</b><span class="dot"></span><button onclick="logout()">خروج</button></div><div class="tabs"><button id="t1" class="tab on" onclick="tab(1)">🔗 اشتراک</button><button id="t2" class="tab" onclick="tab(2)">⚙️ تنظیمات</button></div><div id="p1" class="card"><label>لینک اشتراک</label><input id="sub" readonly><div class="row"><button onclick="copySub()">📋 کپی</button><button class="alt" onclick="qr()">📱 QR</button></div><div id="qrbox"></div><p class="hint">لینک را به‌صورت اشتراک در v2rayNG / Nekobox / Shadowrocket اضافه کنید.</p></div><div id="p2" class="card hide"><label>UUID</label><div class="row"><input id="uuid"><button class="alt" onclick="newUuid()">🎲</button></div><label>مسیر WebSocket</label><input id="wsp"><label>رمز پنل</label><input id="pass"><label>سایت استتار</label><input id="fake"><label>IP تمیز (هر خط یکی)</label><textarea id="ips" rows="3"></textarea><button onclick="save()">💾 ذخیره</button></div></div><div id="toast"></div></div><script>var K=localStorage.getItem("xk")||"",C=null;function el(i){return document.getElementById(i)}function toast(m){var t=el("toast");t.textContent=m;t.className="show";setTimeout(function(){t.className=""},2200)}if(K)boot();function login(){fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({p:el("pw").value})}).then(function(r){return r.json()}).then(function(d){if(d.ok){K=el("pw").value;localStorage.setItem("xk",K);boot()}else toast("رمز اشتباه ❌")})}function boot(){fetch("/api/get?k="+encodeURIComponent(K)).then(function(r){return r.json()}).then(function(d){if(!d.ok){localStorage.removeItem("xk");location.reload();return}C=d.cfg;el("login").className="card hide";el("app").className="";el("sub").value=location.origin+"/sub";el("uuid").value=C.uuid;el("wsp").value=C.wsPath;el("pass").value=C.pass;el("fake").value=C.fake;el("ips").value=C.cleanIps||""})}function tab(n){el("p1").className=n==1?"card":"card hide";el("p2").className=n==2?"card":"card hide";el("t1").className=n==1?"tab on":"tab";el("t2").className=n==2?"tab on":"tab"}function copySub(){el("sub").select();document.execCommand("copy");toast("کپی شد ✅")}function qr(){el("qrbox").innerHTML=\'<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=\'+encodeURIComponent(el("sub").value)+\'">\'}function newUuid(){el("uuid").value=crypto.randomUUID()}function save(){C.uuid=el("uuid").value;C.wsPath=el("wsp").value;C.pass=el("pass").value;C.fake=el("fake").value;C.cleanIps=el("ips").value;fetch("/api/set",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({k:K,cfg:C})}).then(function(r){return r.json()}).then(function(d){if(d.ok){K=C.pass;localStorage.setItem("xk",K);toast("ذخیره شد ✅")}else toast("خطا ❌")})}function logout(){localStorage.removeItem("xk");location.reload()}</script></body></html>';
