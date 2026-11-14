// Fablestar Games: live studio client. Renders only real API data; before day 1 every panel shows a plain empty state.
(() => {
  const FS = window.FS, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const red = s => esc(s).replace(/\[key\]/g, '<span class="k">[key]</span>');
  const usd = n => (n == null || isNaN(n)) ? "-" : "$" + Number(n).toFixed(n < 10 ? 2 : 0);
  const HOURLY = 22; // rough $ per fable hour, shown on docs as an estimate until real sessions give the number
  const state = { live: false, events: [], files: new Map(), steps: [] };

  /* ist clock in the status bar */
  const clock = $("#clock");
  if (clock) { const tick = () => clock.textContent = new Date().toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }) + " Miami"; tick(); setInterval(tick, 1000); }

  /* ca pill + x link only when set */
  const ca = $("#ca");
  if (ca) {
    if (FS.ca) { ca.hidden = false; ca.textContent = "CA " + FS.ca.slice(0, 4) + "…" + FS.ca.slice(-4); ca.onclick = () => { navigator.clipboard?.writeText(FS.ca); ca.textContent = "Copied"; setTimeout(() => ca.textContent = "CA " + FS.ca.slice(0, 4) + "…" + FS.ca.slice(-4), 1400); }; }
  }
  const xl = $("#xlink"); if (xl && FS.x) { xl.hidden = false; xl.href = FS.x; }

  /* g + letter keyboard nav */
  let g = false;
  addEventListener("keydown", e => {
    if (e.target.closest("input,textarea")) return;
    if (e.key === "g") { g = true; setTimeout(() => g = false, 900); return; }
    if (!g) return; g = false;
    const to = { w: "watch.html", p: "index.html#play", c: "index.html#compute", d: "docs.html", h: "index.html" }[e.key];
    if (to) location.href = to;
  });

  /* day map */
  const days = $("#days");
  if (days) days.innerHTML = FS.roadmap.map((w, i) => `<div class="day" data-day="${i + 1}"><div class="n">${String(i + 1).padStart(2, "0")}</div><div><div class="w">${esc(w)}</div><div class="s">${dayDate(i)} · To do</div></div><i class="fill"></i></div>`).join("");
  function dayDate(i) { const d = new Date(FS.firstDay + "T12:00:00-05:00"); d.setDate(d.getDate() + i); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }); }

  /* transcript rendering in claude code's grammar */
  const tx = $("#tx"), follow = $("#follow");
  let pinned = true;
  if (tx) {
    tx.addEventListener("scroll", () => { pinned = tx.scrollTop + tx.clientHeight >= tx.scrollHeight - 30; follow?.classList.toggle("show", !pinned); }, { passive: true });
    follow?.addEventListener("click", () => { pinned = true; tx.scrollTop = tx.scrollHeight; follow.classList.remove("show"); });
  }
  function line(cls, html) { const d = document.createElement("div"); d.className = "l " + cls; d.innerHTML = html; return d; }
  function render(ev) {
    switch (ev.kind) {
      case "say": return line("say", red(ev.text));
      case "think": return line("think", red(ev.text));
      case "tool": return line("tool", `<b>${esc(ev.name || ev.tool || "Tool")}</b> ${red(ev.arg || ev.summary || "")}`);
      case "output": return line("out", red(String(ev.text || "").split("\n").slice(0, 8).join("\n")));
      case "commit": return line("commit", `commit ${esc((ev.hash || "").slice(0, 7))} ${red(ev.message)}`);
      case "status": return line("stat", red(ev.text || ev.status));
      case "frame": return line("stat", `screenshot: ${red((ev.frame && ev.frame.camera) || "unreal")}`);
      case "diff": {
        const rows = String(ev.diff || "").split("\n").slice(0, 60).map(r => `<div class="${r.startsWith("+") ? "a" : r.startsWith("-") ? "d" : "n"}">${red(r)}</div>`).join("");
        return line("diff", `<div class="f">${esc(ev.file)}</div>${rows}`);
      }
    }
    return null;
  }
  function push(ev) {
    state.events.push(ev);
    if (ev.kind === "meter") return meter(ev);
    if (ev.kind === "frame" && ev.frame) addFrame({ ...ev.frame, session: ev.session, ts: ev.ts });
    if (ev.kind === "diff" || (ev.kind === "tool" && ev.file)) touch(ev.file);
    if (ev.kind === "tool") step(ev);
    if (!tx) return;
    const el = render(ev); if (!el) return;
    tx.querySelector(".empty")?.remove();
    tx.appendChild(el);
    while (tx.children.length > 600) tx.firstChild.remove();
    if (pinned) tx.scrollTop = tx.scrollHeight;
    if (ev.kind === "say" && $("#task")) $("#task").textContent = String(ev.text).split("\n")[0].slice(0, 140);
  }

  /* watch page: unreal screenshots, newest big, earlier ones in a strip (owner 2026-11-12) */
  const frames = new Map(); let frPinned = null;
  const miami = t => { try { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " Miami"; } catch { return ""; } };
  function showFrame(f) {
    const img = $("#fr-img"); if (!img || !f) return;
    img.src = FS.api + f.url; img.alt = `Unreal Engine screenshot${f.camera ? ", " + f.camera : ""}`; img.hidden = false;
    const none = $("#fr-none"); if (none) none.hidden = true;
    const cap = $("#fr-cap"); if (cap) cap.textContent = [f.camera, f.note].filter(Boolean).join(": ");
    const when = $("#fr-when"); if (when) when.textContent = [f.session ? `Session ${f.session}` : "", miami(f.ts)].filter(Boolean).join(" · ");
    $$("#fr-strip button").forEach(b => b.setAttribute("aria-current", String(b.dataset.id === f.id)));
  }
  function addFrame(f) {
    const strip = $("#fr-strip");
    if (!f || !f.id || !f.url || frames.has(f.id) || !strip) return;
    frames.set(f.id, f);
    const b = document.createElement("button"); b.type = "button"; b.dataset.id = f.id; b.setAttribute("role", "listitem");
    b.setAttribute("aria-label", `Screenshot ${f.camera || ""} ${miami(f.ts)}`.trim());
    b.innerHTML = `<img loading="lazy" alt="" src="${esc(FS.api + f.url)}">`;
    b.addEventListener("click", () => { frPinned = f.id; showFrame(f); });
    strip.prepend(b);
    while (strip.children.length > 40) strip.lastElementChild.replaceWith();
    const n = $("#fr-count"); if (n) n.textContent = `${frames.size} frame${frames.size > 1 ? "s" : ""}`;
    if (!frPinned) showFrame([...frames.values()].sort((x, y) => String(x.ts).localeCompare(String(y.ts))).pop());
  }

  /* watch page: files touched + step list */
  function touch(f) { if (!f) return; state.files.set(f, (state.files.get(f) || 0) + 1); const box = $("#files"); if (!box) return; box.innerHTML = [...state.files].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v], i) => `<div class="${i < 3 ? "hot" : ""}"><span>${esc(k)}</span><span>${v}</span></div>`).join(""); }
  function step(ev) { const box = $("#steps"); if (!box) return; box.querySelector(".cur")?.classList.remove("cur"); const b = document.createElement("div"); b.className = "step cur"; b.innerHTML = `<b>${esc(ev.name || ev.tool || "Tool")}</b> ${red(ev.arg || ev.summary || "")}`; box.prepend(b); while (box.children.length > 200) box.lastChild.remove(); }

  /* meter */
  function meter(m) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.textContent = v; e.classList.remove("none"); } };
    if (!m || m.usage_usd == null) return;
    set("m-spent", usd(m.usage_usd)); set("m-left", m.limit_usd == null ? "-" : usd(Math.max(0, m.limit_usd - m.usage_usd)));
    set("m-hours", (m.usage_usd / HOURLY).toFixed(1));
    const frac = m.limit_usd ? Math.min(1, m.usage_usd / m.limit_usd) : 0, n = 16, full = Math.round(frac * n);
    $$(".mbar").forEach(b => b.textContent = "█".repeat(full) + "░".repeat(n - full));
    set("w-spent", usd(m.usage_usd)); set("w-left", "Shown when a batch lands"); // the key limit is not the balance
  }

  /* state: status, day, builds, ledger */
  async function loadState() {
    try {
      const r = await fetch(FS.api + "/state", { cache: "no-store" }); if (!r.ok) throw 0;
      const s = await r.json(); applyState(s); return s;
    } catch { setLive(false, "Stream offline · retrying"); if (tx && !state.events.length) empty({ status: "offline" }); if (!state.drawn) { builds([]); ledger([]); state.drawn = true; } return null; }
  }
  function setLive(on, text) { state.live = on; $$(".live").forEach(l => { l.classList.toggle("on", on); const t = l.querySelector("span"); if (t) t.textContent = text; }); }
  function applyState(s) {
    const st = s.status || "not_started";
    setLive(st === "working", { working: "Live · Fable is working", idle: "Idle · between sessions", out_of_compute: "Paused · out of compute", not_started: "Not started" }[st] || st);
    const day = s.day || 0; $$(".daynum").forEach(e => e.textContent = day ? `Day ${day}/9` : "Warm-up done");
    if (s.meter) meter(s.meter);
    else {
      const spent = (s.sessions || []).reduce((t, x) => t + (+x.cost_usd || 0), 0);
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      if (spent) set("w-spent", usd(spent));
      set("w-left", "Shown when a batch lands");
    }
    const shipped = new Set((s.builds || []).map(b => +b.day));
    $$(".day").forEach(d => { const n = +d.dataset.day; d.classList.toggle("ship", shipped.has(n)); d.classList.toggle("now", !shipped.has(n) && n === day); const lab = d.querySelector(".s"); if (lab) lab.textContent = dayDate(n - 1) + " · " + (shipped.has(n) ? "Playable" : n === day ? "Building" : "To do"); });
    $$("#strip i").forEach((c, i) => { c.classList.toggle("ship", shipped.has(i + 1)); c.classList.toggle("now", !shipped.has(i + 1) && i + 1 === day); });
    builds(s.builds || []); ledger(s.ledger || []); (s.frames || []).forEach(addFrame);
    if (tx && !state.events.length) empty(s);
  }
  function empty(s) {
    const st = s?.status || "not_started";
    tx.innerHTML = `<div class="empty"><div class="row"><span>Studio</span><span>Fablestar Games</span></div><div class="row"><span>Developer</span><span>Claude Fable 5.2</span></div><div class="row"><span>Status</span><span>${st === "offline" ? "Stream offline, retrying every 30 seconds" : st === "out_of_compute" ? "Paused, out of compute until the next batch" : st === "idle" ? "Between sessions" : "The first session starts when the first compute batch lands"}</span></div><div class="row"><span>Days built</span><span>${new Set((s?.sessions || []).filter(x => x.status === "ended" && +x.day > 0).map(x => x.day)).size || "None yet, day 1 starts after launch"}</span></div><br><div class="dim">$ ls /studio</div><div>ROADMAP.md  CHANGELOG.md</div><br><div class="dim">$ cat ROADMAP.md</div>${FS.roadmap.map((w, i) => `<div class="row"><span>Day ${i + 1}</span><span>${esc(w)}</span></div>`).join("")}<br><span class="cursor"></span></div>`;
  }
  function builds(list) {
    const box = $("#blist"), game = $("#game"); const sorted = [...list].sort((a, b) => b.day - a.day);
    if (box) box.innerHTML = sorted.length ? sorted.map(b => `<a class="brow" href="${esc(b.url)}" target="_blank" rel="noopener"><span class="d">Day ${b.day}</span><span>${esc(FS.roadmap[b.day - 1] || "")}<br><span class="dim">${esc(b.date || "")} · ${esc((b.commit || "").slice(0, 7))}</span></span><span class="play">Play →</span></a>`).join("") : `<div class="brow"><span class="d dim"></span><span class="dim">No build yet. Day 1's build ships at the end of its first session, and every build after it stays playable here.</span><span></span></div>`;
    if (game) {
      const latest = sorted[0];
      if (latest && !game.dataset.src) { game.dataset.src = latest.url; game.innerHTML = `<iframe title="The game, day ${latest.day} build" src="${esc(latest.url)}" loading="lazy" allow="fullscreen; gamepad"></iframe>`; }
      $$(".today .w").forEach(e => e.textContent = latest ? FS.roadmap[latest.day - 1] : FS.roadmap[0]);
      $$(".today .d").forEach(e => e.textContent = latest ? `Day ${latest.day}` : "Day 1");
    }
  }
  function ledger(rows) {
    const box = $("#ledger"); if (!box) return;
    const EXPL = { solana: "https://solscan.io/tx/", base: "https://basescan.org/tx/", ethereum: "https://etherscan.io/tx/", polygon: "https://polygonscan.com/tx/", arbitrum: "https://arbiscan.io/tx/", optimism: "https://optimistic.etherscan.io/tx/" };
    const txUrl = (t, chain) => (EXPL[chain] || (String(t).startsWith("0x") ? "https://blockscan.com/tx/" : EXPL.solana)) + encodeURIComponent(t);
    const rc = (t, n, chain) => t ? `<a href="${esc(txUrl(t, chain))}" target="_blank" rel="noopener">Receipt ${n}</a>` : "";
    box.innerHTML = `<div class="lrow h"><span>Date</span><span>Compute added</span><span>Receipts</span></div>` + (rows.length ? rows.map(r => `<div class="lrow"><span>${esc(r.date)}</span><span>${usd(r.openrouter_usd)}</span><span>${[rc(r.claim_tx, 1, "solana"), rc(r.swap_tx, 2, "solana"), rc(r.bridge_tx, 3, r.bridge_chain), rc(r.pay_tx, r.bridge_tx ? 4 : 3, r.pay_chain)].filter(Boolean).join(" · ") || "-"}</span></div>`).join("") : `<div class="lrow"><span class="dim" style="grid-column:1/-1">No batches yet. Each one lands here with its receipts.</span></div>`);
  }

  /* live stream */
  function connect() {
    if (!window.EventSource) return;
    let es; try { es = new EventSource(FS.api + "/events"); } catch { return; }
    es.onmessage = m => { try { const ev = JSON.parse(m.data); (Array.isArray(ev) ? ev : [ev]).forEach(push); } catch {} };
    const onNamed = m => { try { const ev = JSON.parse(m.data); (Array.isArray(ev) ? ev : [ev]).forEach(push); } catch {} };
    ["status", "say", "think", "tool", "output", "diff", "commit", "cost", "meter", "error", "result", "session_end", "frame"].forEach(k => es.addEventListener(k, onNamed));
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  }
  loadState().then(() => connect());
  setInterval(loadState, 30000);
})();
