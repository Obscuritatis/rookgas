(() => {
"use strict";

/* ---------- Begrippen ---------- */
const GAS_PARTS = [
  { key: "gasinstallatie", label: "Gasinstallatie", one: "gasinstallatie", more: "Nog een gasinstallatie" },
  { key: "ketels", label: "Ketels", one: "ketel", more: "Nog een ketel" },
  { key: "noodknop", label: "Noodknop", one: "noodknop", more: "Nog een noodknop" },
  { key: "gasklep", label: "Gasklep", one: "gasklep", more: "Nog een gasklep" },
  { key: "gasdetectie", label: "Gasdetectie", one: "gasdetectie", more: "Nog een gasdetectie" },
];
const BUCKET = "rookgas-fotos";
const T_ROOK = "rookkoepels", T_GAS = "gasinstallaties";

/* ---------- Hulpjes ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return ""; } };
const loc = (a, b) => [a, b].filter((x) => x && String(x).trim()).join(" · ");
const verd = (v) => (v && String(v).trim() ? "verdiep " + v : "");
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500); }
function banner(msg) { const b = $("#banner"); b.textContent = msg || ""; b.hidden = !msg; }
function errText(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e || "onbekende fout");
  if (/row-level security|violates row|permission denied|Unauthorized|403/i.test(m)) return "je e-mailadres heeft nog geen toegang. Vraag de beheerder om je toe te voegen.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "geen verbinding met de server. Probeer opnieuw zodra je netwerk hebt.";
  return m;
}

/* ---------- Supabase ---------- */
let sb = null;
let sessie = null;
let kanaal = null;

// Rij in de database <-> fiche in de app
function fromRook(r) {
  return { id: r.id, soort: "rookkoepel", gebouw: r.gebouw || "", code: r.code || "", opmerking: r.opmerking || "", aangemaakt: r.aangemaakt, gewijzigd: r.gewijzigd,
    koepel: { gang: r.koepel_gang || "", verdiep: r.koepel_verdiep || "", foto: r.koepel_foto || "" },
    bediening: { lokaal: r.bediening_lokaal || "", verdiep: r.bediening_verdiep || "", foto: r.bediening_foto || "" } };
}
function toRook(it) {
  return { id: it.id, gebouw: it.gebouw, code: it.code, opmerking: it.opmerking,
    koepel_gang: it.koepel.gang, koepel_verdiep: it.koepel.verdiep, koepel_foto: it.koepel.foto || null,
    bediening_lokaal: it.bediening.lokaal, bediening_verdiep: it.bediening.verdiep, bediening_foto: it.bediening.foto || null,
    gewijzigd: new Date().toISOString() };
}
function fromGas(r) {
  return { id: r.id, soort: "gas", gebouw: r.gebouw || "", code: r.code || "", opmerking: r.opmerking || "", aangemaakt: r.aangemaakt, gewijzigd: r.gewijzigd, onderdelen: r.onderdelen || {} };
}
function toGas(it) {
  return { id: it.id, gebouw: it.gebouw, code: it.code, opmerking: it.opmerking, onderdelen: it.onderdelen, gewijzigd: new Date().toISOString() };
}

const Store = {
  items: [], loaded: false,

  async loadAll() {
    const [a, b] = await Promise.all([sb.from(T_ROOK).select("*"), sb.from(T_GAS).select("*")]);
    if (a.error || b.error) { banner("Gegevens laden mislukt: " + errText(a.error || b.error)); return; }
    banner("");
    this.items = a.data.map(fromRook).concat(b.data.map(fromGas));
    this.loaded = true;
    renderSafe();
  },

  async save(it) {
    const isRook = it.soort === "rookkoepel";
    const { error } = await sb.from(isRook ? T_ROOK : T_GAS).upsert(isRook ? toRook(it) : toGas(it));
    if (error) throw error;
    await this.loadAll();
  },

  async remove(it) {
    const { error } = await sb.from(it.soort === "rookkoepel" ? T_ROOK : T_GAS).delete().eq("id", it.id);
    if (error) throw error;
    await this.loadAll();
  },

  async uploadPhoto(blob, map) {
    const pad = `${map}/${uid()}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(pad, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    fotoUrls.set(pad, URL.createObjectURL(blob));
    return pad;
  },

  async deletePhotos(paden) {
    paden = paden.filter(Boolean); if (!paden.length) return;
    paden.forEach((p) => fotoUrls.delete(p));
    try { await sb.storage.from(BUCKET).remove(paden); } catch (e) { console.warn("Foto's niet verwijderd", e); }
  },

  async photoBlob(pad) {
    const { data, error } = await sb.storage.from(BUCKET).download(pad);
    return error ? null : data;
  },
};

/* ---------- Foto-adressen (tijdelijk ondertekend) ---------- */
const fotoUrls = new Map();
let fillBusy = null;
async function fillPhotos() {
  const imgs = [...document.querySelectorAll("img[data-foto]")];
  const todo = [...new Set(imgs.map((i) => i.dataset.foto).filter((p) => !fotoUrls.has(p)))];
  if (todo.length) {
    try {
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(todo, 60 * 60 * 12);
      for (const d of data || []) if (d.signedUrl) fotoUrls.set(d.path, d.signedUrl);
    } catch (e) { console.warn(e); }
  }
  for (const img of document.querySelectorAll("img[data-foto]")) {
    const u = fotoUrls.get(img.dataset.foto);
    if (u && img.getAttribute("src") !== u) img.src = u;
  }
}
function photosLater() { clearTimeout(fillBusy); fillBusy = setTimeout(fillPhotos, 0); }

function photoRefs(it) {
  const out = [];
  if (it.soort === "rookkoepel") { if (it.koepel?.foto) out.push(it.koepel.foto); if (it.bediening?.foto) out.push(it.bediening.foto); }
  else if (it.soort === "gas") { for (const p of GAS_PARTS) for (const e of it.onderdelen?.[p.key] || []) if (e.foto) out.push(e.foto); }
  return out;
}

/* ---------- Foto's verkleinen ---------- */
async function shrink(file, max = 1600, q = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Dit bestand is geen leesbare foto.")); i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", q));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Toestand ---------- */
const state = { tab: "rook", q: "", gebouw: "" };
try { const t = localStorage.getItem("rookgas-tab"); if (t === "rook" || t === "gas") state.tab = t; } catch {}

function itemsOf(tab) { return Store.items.filter((i) => i.soort === (tab === "rook" ? "rookkoepel" : "gas")); }
function sortItems(a) { return a.slice().sort((x, y) => (x.gebouw || "").localeCompare(y.gebouw || "", "nl") || (x.code || "").localeCompare(y.code || "", "nl", { numeric: true })); }
function textOf(it) {
  const parts = [it.gebouw, it.code, it.opmerking];
  if (it.soort === "rookkoepel") parts.push(it.koepel?.gang, it.koepel?.verdiep, it.bediening?.lokaal, it.bediening?.verdiep);
  else for (const p of GAS_PARTS) for (const e of it.onderdelen?.[p.key] || []) parts.push(e.lokaal, e.verdiep, e.opmerking, p.label);
  return parts.filter(Boolean).join(" ").toLowerCase();
}
function distinct(fn) { const s = new Set(); for (const it of Store.items) for (const v of [].concat(fn(it))) if (v && String(v).trim()) s.add(String(v).trim()); return [...s].sort((a, b) => a.localeCompare(b, "nl", { numeric: true })); }
function allEntries(it) { const out = []; for (const p of GAS_PARTS) for (const e of it.onderdelen?.[p.key] || []) out.push(e); return out; }

function rookDone(it) { return !!(it.koepel?.foto && it.bediening?.foto && (it.koepel?.gang || it.koepel?.verdiep) && (it.bediening?.lokaal || it.bediening?.verdiep)); }
function partState(it, key) {
  const list = it.onderdelen?.[key] || [];
  if (!list.length) return "none";
  return list.every((e) => e.foto && (e.lokaal || e.verdiep)) ? "ok" : "half";
}
function gasDone(it) { return GAS_PARTS.every((p) => partState(it, p.key) === "ok"); }

/* ---------- Weergave ---------- */
function thumb(ref, alt) {
  if (!ref) return `<div class="thumb empty">Geen foto</div>`;
  const u = fotoUrls.get(ref);
  return `<img class="thumb" data-foto="${esc(ref)}" ${u ? `src="${esc(u)}"` : ""} alt="${esc(alt)}" loading="lazy">`;
}

function renderShell() {
  const on = !!sessie;
  $("#loginForm").hidden = on || !sb;
  $("#app").hidden = !on;
  $("#tabs").hidden = !on;
  $("#btnExport").hidden = !on;
  $("#who").hidden = !on;
  $("#whoMail").textContent = on ? sessie.user.email : "";
}

function render() {
  renderShell();
  if (!sessie) return;
  $("#n-rook").textContent = itemsOf("rook").length;
  $("#n-gas").textContent = itemsOf("gas").length;
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  $("#btnNewLbl").textContent = state.tab === "rook" ? "Nieuwe rookkoepel" : "Nieuwe gasinstallatie";

  const gebouwen = distinct((i) => i.gebouw);
  for (const sel of [$("#fGebouw"), $("#exGebouw")]) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">Alle gebouwen</option>` + gebouwen.map((g) => `<option>${esc(g)}</option>`).join("");
    sel.value = gebouwen.includes(cur) ? cur : "";
  }
  state.gebouw = $("#fGebouw").value;

  let list = itemsOf(state.tab);
  const total = list.length;
  if (state.gebouw) list = list.filter((i) => i.gebouw === state.gebouw);
  if (state.q) { const q = state.q.toLowerCase(); list = list.filter((i) => textOf(i).includes(q)); }
  list = sortItems(list);

  const done = list.filter((i) => (i.soort === "rookkoepel" ? rookDone(i) : gasDone(i))).length;
  $("#summary").innerHTML = total
    ? `<span><b>${list.length}</b> ${state.tab === "rook" ? "rookkoepels" : "gasinstallaties"} getoond</span><span><b>${done}</b> volledig</span><span><b>${list.length - done}</b> nog aan te vullen</span>`
    : "";

  const el = $("#list");
  if (!Store.loaded) { el.innerHTML = `<p class="loading">Gegevens laden…</p>`; return; }
  if (!total) {
    const rook = state.tab === "rook";
    el.innerHTML = `<div class="empty-state">
      <h2>${rook ? "Nog geen rookkoepels geregistreerd" : "Nog geen gasinstallaties geregistreerd"}</h2>
      <p>${rook ? "Per rookkoepel noteer je waar de koepel zit (gang en verdiep) en waar de bediening hangt (lokaal en verdiep), telkens met een foto." : "Per installatie noteer je de gasinstallatie, ketels, noodknop, gasklep en gasdetectie, telkens met lokaal, verdiep en foto."}</p>
      <button class="btn primary" type="button" data-new>${rook ? "Eerste rookkoepel toevoegen" : "Eerste gasinstallatie toevoegen"}</button></div>`;
    return;
  }
  if (!list.length) { el.innerHTML = `<div class="empty-state"><h2>Niets gevonden</h2><p>Geen resultaten voor deze zoekopdracht of dit gebouw.</p></div>`; return; }
  el.innerHTML = list.map((it) => (it.soort === "rookkoepel" ? rookCard(it) : gasCard(it))).join("");
  photosLater();
}

// Niet hertekenen terwijl iemand in de zoekbalk typt; dat zou de cursor verplaatsen.
function renderSafe() { render(); }

function rookCard(it) {
  const ok = rookDone(it);
  return `<button type="button" class="card rook" data-id="${esc(it.id)}">
    <div class="card-head"><h3>${esc(it.gebouw || "Gebouw onbekend")}</h3><span class="code">${esc(it.code || "—")}</span></div>
    <div class="pair">
      <div class="slot"><span class="lbl">Koepel</span>${thumb(it.koepel?.foto, "Foto koepel")}<span class="loc">${esc(loc(it.koepel?.gang, verd(it.koepel?.verdiep)) || "Locatie ontbreekt")}</span></div>
      <div class="slot"><span class="lbl">Bediening</span>${thumb(it.bediening?.foto, "Foto bediening")}<span class="loc">${esc(loc(it.bediening?.lokaal, verd(it.bediening?.verdiep)) || "Locatie ontbreekt")}</span></div>
    </div>
    <div class="foot"><span class="status ${ok ? "ok" : "todo"}">${ok ? "Volledig" : "Aan te vullen"}</span><span>Gewijzigd ${esc(fmtDate(it.gewijzigd))}</span></div>
  </button>`;
}

function gasCard(it) {
  const ok = gasDone(it);
  const chips = GAS_PARTS.map((p) => {
    const st = partState(it, p.key); const n = (it.onderdelen?.[p.key] || []).length;
    const mark = st === "ok" ? "✓" : st === "half" ? "…" : "–";
    return `<span class="chip ${st === "ok" ? "ok" : st === "half" ? "half" : ""}">${mark} ${esc(p.label)}${n > 1 ? " ×" + n : ""}</span>`;
  }).join("");
  const refs = allEntries(it).map((e) => e.foto).filter(Boolean);
  const strip = refs.slice(0, 6).map((r) => { const u = fotoUrls.get(r); return `<img data-foto="${esc(r)}" ${u ? `src="${esc(u)}"` : ""} alt="" loading="lazy">`; }).join("");
  return `<button type="button" class="card gas" data-id="${esc(it.id)}">
    <div class="card-head"><h3>${esc(it.gebouw || "Gebouw onbekend")}</h3><span class="code">${esc(it.code || "—")}</span></div>
    <div class="parts">${chips}</div>
    ${strip ? `<div class="strip">${strip}</div>` : ""}
    <div class="foot"><span class="status ${ok ? "ok" : "todo"}">${ok ? "Volledig" : "Aan te vullen"}</span><span>${refs.length} foto's · gewijzigd ${esc(fmtDate(it.gewijzigd))}</span></div>
  </button>`;
}

/* ---------- Bewerken ---------- */
let edit = null; // { item, isNew, originalRefs:Set, newRefs:Set, busy }

function nextCode(prefix, soort) {
  let max = 0;
  for (const it of Store.items) if (it.soort === soort) { const m = String(it.code || "").match(/(\d+)\s*$/); if (m) max = Math.max(max, +m[1]); }
  return prefix + String(max + 1).padStart(2, "0");
}
function blankGasEntry() { return { lokaal: "", verdiep: "", opmerking: "", foto: "" }; }

function openEditor(item) {
  const isNew = !item;
  if (isNew) {
    const g = state.gebouw || "";
    item = state.tab === "rook"
      ? { id: uid(), soort: "rookkoepel", gebouw: g, code: nextCode("RK-", "rookkoepel"), koepel: { gang: "", verdiep: "", foto: "" }, bediening: { lokaal: "", verdiep: "", foto: "" }, opmerking: "" }
      : { id: uid(), soort: "gas", gebouw: g, code: nextCode("GAS-", "gas"), onderdelen: Object.fromEntries(GAS_PARTS.map((p) => [p.key, [blankGasEntry()]])), opmerking: "" };
  } else item = JSON.parse(JSON.stringify(item));
  if (item.soort === "gas") { item.onderdelen = item.onderdelen || {}; for (const p of GAS_PARTS) if (!Array.isArray(item.onderdelen[p.key])) item.onderdelen[p.key] = []; }
  edit = { item, isNew, originalRefs: new Set(photoRefs(item)), newRefs: new Set(), busy: 0 };
  drawEditor();
  $("#editor").showModal();
}

function dl(id, values) { return `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`; }

function photoField(path, ref, label) {
  return `<div class="photo" data-path="${esc(path)}">
    ${ref ? thumb(ref, label).replace(' loading="lazy"', "") : `<div class="thumb empty">Geen foto</div>`}
    <div class="acts">
      <label class="btn small primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Foto nemen<input class="vh" type="file" accept="image/*" capture="environment" data-photo="${esc(path)}"></label>
      <label class="btn small">Kies bestand<input class="vh" type="file" accept="image/*" data-photo="${esc(path)}"></label>
      ${ref ? `<button class="btn small danger" type="button" data-clear-photo="${esc(path)}">Foto weg</button>` : ""}
    </div>
  </div>`;
}

function inp(path, label, value, list, ph = "") {
  const id = "f-" + path.replace(/[^a-z0-9]/gi, "-");
  return `<label class="f" for="${id}"><span>${esc(label)}</span><input type="text" id="${id}" data-path="${esc(path)}" value="${esc(value)}" ${list ? `list="${list}"` : ""} placeholder="${esc(ph)}" autocomplete="off"></label>`;
}

function drawEditor() {
  const it = edit.item;
  const form = $("#editForm");
  const scroll = form.querySelector(".sheet-body")?.scrollTop || 0;
  const lists = dl("dl-gebouw", distinct((i) => i.gebouw)) +
    dl("dl-verdiep", distinct((i) => i.soort === "rookkoepel" ? [i.koepel?.verdiep, i.bediening?.verdiep] : allEntries(i).map((e) => e.verdiep)).concat(["-1", "0", "1", "2", "3"]).filter((v, i, a) => a.indexOf(v) === i)) +
    dl("dl-gang", distinct((i) => i.koepel?.gang)) +
    dl("dl-lokaal", distinct((i) => i.soort === "rookkoepel" ? i.bediening?.lokaal : allEntries(i).map((e) => e.lokaal)));
  let body = `<fieldset><legend>Algemeen</legend><div class="row">
      ${inp("gebouw", "Gebouw / site", it.gebouw, "dl-gebouw", "bv. Hoofdgebouw")}
      ${inp("code", it.soort === "rookkoepel" ? "Nummer koepel" : "Naam installatie", it.code, null, it.soort === "rookkoepel" ? "RK-01" : "GAS-01")}
    </div></fieldset>`;
  if (it.soort === "rookkoepel") {
    body += `<fieldset class="rookf"><legend>Rookkoepel</legend><div class="row">
        ${inp("koepel.gang", "Gang", it.koepel.gang, "dl-gang", "bv. Gang B-vleugel")}
        ${inp("koepel.verdiep", "Verdiep", it.koepel.verdiep, "dl-verdiep", "bv. 2")}
      </div>${photoField("koepel.foto", it.koepel.foto, "Foto koepel")}</fieldset>
      <fieldset class="rookf"><legend>Bediening</legend><div class="row">
        ${inp("bediening.lokaal", "Lokaal", it.bediening.lokaal, "dl-lokaal", "bv. B.012")}
        ${inp("bediening.verdiep", "Verdiep", it.bediening.verdiep, "dl-verdiep", "bv. 0")}
      </div>${photoField("bediening.foto", it.bediening.foto, "Foto bediening")}</fieldset>`;
  } else {
    for (const p of GAS_PARTS) {
      const list = it.onderdelen[p.key];
      body += `<fieldset class="gasf"><legend>${esc(p.label)}</legend>`;
      if (!list.length) body += `<p class="hint">Niet aanwezig of nog niet geregistreerd.</p>`;
      list.forEach((e, i) => {
        const base = `onderdelen.${p.key}.${i}`;
        body += `<div class="entry">
          ${list.length > 1 || i > 0 ? `<div class="entry-head"><b>${esc(p.one[0].toUpperCase() + p.one.slice(1))} ${i + 1}</b><button class="btn small danger" type="button" data-remove-entry="${p.key}.${i}">Verwijder</button></div>` : ""}
          <div class="row">
            ${inp(base + ".lokaal", "Lokaal / plaats", e.lokaal, "dl-lokaal", "bv. Stookplaats")}
            ${inp(base + ".verdiep", "Verdiep", e.verdiep, "dl-verdiep", "bv. -1")}
          </div>
          ${inp(base + ".opmerking", "Opmerking", e.opmerking, null, p.key === "ketels" ? "bv. merk, type, vermogen" : "")}
          ${photoField(base + ".foto", e.foto, "Foto " + p.one)}
          ${list.length === 1 && i === 0 ? `<div><button class="btn small danger" type="button" data-remove-entry="${p.key}.${i}">Niet aanwezig</button></div>` : ""}
        </div>`;
      });
      body += `<div><button class="btn small" type="button" data-add-entry="${p.key}">+ ${esc(list.length ? p.more : "Toevoegen")}</button></div></fieldset>`;
    }
  }
  body += `<fieldset><legend>Opmerking</legend><label class="f" for="f-opmerking"><span class="vh">Opmerking</span><textarea id="f-opmerking" data-path="opmerking" placeholder="Bijzonderheden, staat, toegang…">${esc(it.opmerking)}</textarea></label></fieldset>`;

  form.innerHTML = `
    <div class="sheet-head"><h2>${edit.isNew ? (it.soort === "rookkoepel" ? "Nieuwe rookkoepel" : "Nieuwe gasinstallatie") : esc(it.code || "Bewerken")}</h2>
      <button class="btn small" type="button" data-cancel>Annuleren</button></div>
    <div class="sheet-body">${lists}${body}</div>
    <div class="sheet-foot">
      ${edit.isNew ? "" : `<button class="btn danger" type="button" data-delete>Verwijderen</button>`}
      <div class="right"><button class="btn primary" type="button" data-save>Opslaan</button></div>
    </div>`;
  form.querySelector(".sheet-body").scrollTop = scroll;
  photosLater();
}

function setPath(obj, path, v) { const ks = path.split("."); const last = ks.pop(); const t = ks.reduce((o, k) => o[k], obj); t[last] = v; }

function cleaned(item) {
  const it = JSON.parse(JSON.stringify(item));
  for (const k of ["gebouw", "code", "opmerking"]) it[k] = (it[k] || "").trim();
  if (it.soort === "rookkoepel") {
    for (const k of ["gang", "verdiep"]) it.koepel[k] = (it.koepel[k] || "").trim();
    for (const k of ["lokaal", "verdiep"]) it.bediening[k] = (it.bediening[k] || "").trim();
  } else {
    for (const p of GAS_PARTS) it.onderdelen[p.key] = it.onderdelen[p.key].map((e) => ({ lokaal: (e.lokaal || "").trim(), verdiep: (e.verdiep || "").trim(), opmerking: (e.opmerking || "").trim(), foto: e.foto || "" })).filter((e) => e.lokaal || e.verdiep || e.opmerking || e.foto);
  }
  return it;
}

async function saveEdit() {
  if (edit.busy) { toast("Even wachten tot de foto opgeladen is."); return; }
  const it = cleaned(edit.item);
  if (!it.gebouw && !it.code) { toast("Vul minstens een gebouw of nummer in."); $("#f-gebouw")?.focus(); return; }
  const btn = $("#editForm [data-save]"); btn.disabled = true; btn.textContent = "Opslaan…";
  try {
    await Store.save(it);
    const keep = new Set(photoRefs(it));
    await Store.deletePhotos([...new Set([...edit.originalRefs, ...edit.newRefs])].filter((r) => !keep.has(r)));
    edit = null; $("#editor").close(); toast("Opgeslagen");
  } catch (e) { console.error(e); toast("Opslaan mislukt: " + errText(e)); btn.disabled = false; btn.textContent = "Opslaan"; }
}

async function cancelEdit() {
  if (!edit) return;
  const orphans = [...edit.newRefs];
  edit = null; $("#editor").close();
  await Store.deletePhotos(orphans);
}

async function deleteItem(btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Klik nogmaals om te verwijderen"; setTimeout(() => { if (btn.isConnected) { btn.classList.remove("armed"); btn.textContent = "Verwijderen"; } }, 4000); return; }
  const it = edit.item; const refs = [...new Set([...edit.originalRefs, ...edit.newRefs])];
  try { await Store.remove(it); await Store.deletePhotos(refs); edit = null; $("#editor").close(); toast("Verwijderd"); }
  catch (e) { toast("Verwijderen mislukt: " + errText(e)); }
}

async function onPhoto(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const path = input.dataset.photo;
  const acts = input.closest(".photo").querySelector(".acts");
  const note = document.createElement("span"); note.className = "busy"; note.textContent = "Foto verwerken…"; acts.append(note);
  const session = edit;
  session.busy++;
  try {
    const blob = await shrink(file);
    note.textContent = "Foto opladen…";
    const map = (session.item.soort === "rookkoepel" ? "rookkoepels/" : "gasinstallaties/") + session.item.id;
    const ref = await Store.uploadPhoto(blob, map);
    if (edit !== session) { await Store.deletePhotos([ref]); return; }
    edit.newRefs.add(ref);
    setPath(edit.item, path, ref);
    drawEditor();
  } catch (e) {
    console.error(e); toast("Foto niet opgeslagen: " + errText(e));
  } finally { session.busy--; input.value = ""; note.remove(); }
}

/* ---------- Excel-export ---------- */
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/exceljs-4.4.0.min.js";
    s.onload = () => res(window.ExcelJS); s.onerror = () => rej(new Error("Excel-bibliotheek kon niet laden."));
    document.head.append(s);
  });
}

async function thumbB64(ref) {
  try {
    const blob = await Store.photoBlob(ref); if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const W = 320, H = 240; const c = document.createElement("canvas"); c.width = W; c.height = H;
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight); const w = img.naturalWidth * s, h = img.naturalHeight * s;
      c.getContext("2d").drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      return c.toDataURL("image/jpeg", 0.78);
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

function styleSheet(ws, color) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  head.alignment = { vertical: "middle" }; head.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

async function doExport() {
  const status = $("#exStatus"); const btn = $("#btnDoExport");
  const wantRook = $("#exRook").checked, wantGas = $("#exGas").checked, fotos = $("#exFotos").checked, geb = $("#exGebouw").value;
  if (!wantRook && !wantGas) { status.textContent = "Kies minstens één tabblad."; return; }
  btn.disabled = true;
  try {
    status.textContent = "Excel-bibliotheek laden…";
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook(); wb.creator = "Rookgas"; wb.created = new Date();
    const pick = (soort) => sortItems(Store.items.filter((i) => i.soort === soort && (!geb || i.gebouw === geb)));
    const PH = 95;
    let n = 0; const totalPhotos = (wantRook ? pick("rookkoepel").flatMap(photoRefs).length : 0) + (wantGas ? pick("gas").flatMap(photoRefs).length : 0);
    const put = async (ws, ref, col, row) => {
      if (!fotos || !ref) return;
      n++; status.textContent = `Foto's toevoegen… ${n} / ${totalPhotos}`;
      const b64 = await thumbB64(ref); if (!b64) return;
      const id = wb.addImage({ base64: b64, extension: "jpeg" });
      ws.addImage(id, { tl: { col: col - 1 + 0.08, row: row - 1 + 0.08 }, ext: { width: 160, height: 120 } });
    };
    const datum = (iso) => (iso ? new Date(iso) : null);

    if (wantRook) {
      const ws = wb.addWorksheet("Rookkoepels");
      ws.columns = [
        { header: "Gebouw", key: "gebouw", width: 22 }, { header: "Nummer", key: "code", width: 12 },
        { header: "Koepel – gang", key: "kg", width: 22 }, { header: "Koepel – verdiep", key: "kv", width: 14 }, { header: "Foto koepel", key: "kf", width: fotos ? 24 : 12 },
        { header: "Bediening – lokaal", key: "bl", width: 22 }, { header: "Bediening – verdiep", key: "bv", width: 16 }, { header: "Foto bediening", key: "bf", width: fotos ? 24 : 12 },
        { header: "Opmerking", key: "opm", width: 34 }, { header: "Status", key: "st", width: 14 }, { header: "Laatst gewijzigd", key: "gw", width: 16 },
      ];
      let r = 2;
      for (const it of pick("rookkoepel")) {
        const row = ws.addRow({ gebouw: it.gebouw, code: it.code, kg: it.koepel?.gang, kv: it.koepel?.verdiep, kf: it.koepel?.foto ? (fotos ? "" : "ja") : "geen", bl: it.bediening?.lokaal, bv: it.bediening?.verdiep, bf: it.bediening?.foto ? (fotos ? "" : "ja") : "geen", opm: it.opmerking, st: rookDone(it) ? "Volledig" : "Aan te vullen", gw: datum(it.gewijzigd) });
        row.alignment = { vertical: "top", wrapText: true };
        if (fotos) row.height = PH;
        await put(ws, it.koepel?.foto, 5, r); await put(ws, it.bediening?.foto, 8, r);
        r++;
      }
      ws.getColumn("gw").numFmt = "dd/mm/yyyy";
      styleSheet(ws, "FFC8321F");
    }
    if (wantGas) {
      const ws = wb.addWorksheet("Gasinstallaties");
      ws.columns = [
        { header: "Gebouw", key: "gebouw", width: 22 }, { header: "Installatie", key: "code", width: 14 }, { header: "Onderdeel", key: "ond", width: 16 }, { header: "Nr", key: "nr", width: 5 },
        { header: "Lokaal / plaats", key: "lok", width: 22 }, { header: "Verdiep", key: "ver", width: 10 }, { header: "Foto", key: "foto", width: fotos ? 24 : 10 },
        { header: "Opmerking", key: "opm", width: 34 }, { header: "Laatst gewijzigd", key: "gw", width: 16 },
      ];
      let r = 2;
      for (const it of pick("gas")) {
        for (const p of GAS_PARTS) {
          const list = it.onderdelen?.[p.key] || [];
          if (!list.length) { const row = ws.addRow({ gebouw: it.gebouw, code: it.code, ond: p.label, nr: "", lok: "niet geregistreerd", gw: datum(it.gewijzigd) }); row.font = { italic: true, color: { argb: "FF8A6200" } }; r++; continue; }
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            const row = ws.addRow({ gebouw: it.gebouw, code: it.code, ond: p.label, nr: i + 1, lok: e.lokaal, ver: e.verdiep, foto: e.foto ? (fotos ? "" : "ja") : "geen", opm: [e.opmerking, i === 0 && p.key === "gasinstallatie" ? it.opmerking : ""].filter(Boolean).join(" — "), gw: datum(it.gewijzigd) });
            row.alignment = { vertical: "top", wrapText: true };
            if (fotos && e.foto) row.height = PH;
            await put(ws, e.foto, 7, r);
            r++;
          }
        }
      }
      ws.getColumn("gw").numFmt = "dd/mm/yyyy";
      styleSheet(ws, "FFB57800");
    }

    status.textContent = "Bestand opbouwen…";
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const d = new Date(); const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const filename = `inventaris-rookkoepels-gas${geb ? "-" + geb.replace(/[^\w-]+/g, "_") : ""}-${stamp}.xlsx`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    status.textContent = "Klaar. Het Excel-bestand staat bij je downloads.";
  } catch (e) {
    console.error(e);
    status.textContent = "Export mislukt: " + errText(e);
  } finally { btn.disabled = false; }
}

/* ---------- App installeren ---------- */
let installPrompt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function showInstall() { $("#btnInstall").hidden = standalone() || !(installPrompt || isIos); }
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; showInstall(); });
addEventListener("appinstalled", () => { installPrompt = null; showInstall(); toast("App geïnstalleerd"); });
async function doInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch {}
    installPrompt = null; showInstall();
  } else if (isIos) $("#iosDlg").showModal();
}

/* ---------- Gebeurtenissen ---------- */
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, [data-id]"); if (!t) return;
  if (t.id === "btnInstall") { doInstall(); return; }
  if (t.id === "btnLogout") { sb.auth.signOut(); return; }
  if (t.matches(".tab")) { state.tab = t.dataset.tab; try { localStorage.setItem("rookgas-tab", state.tab); } catch {} render(); return; }
  if (t.id === "btnNew" || t.matches("[data-new]")) { openEditor(null); return; }
  if (t.id === "btnExport") { $("#exStatus").textContent = ""; $("#exportDlg").showModal(); return; }
  if (t.id === "btnDoExport") { doExport(); return; }
  if (t.matches(".card[data-id]")) { const it = Store.items.find((i) => i.id === t.dataset.id); if (it) openEditor(it); return; }
  if (!edit) return;
  if (t.matches("[data-cancel]")) { cancelEdit(); return; }
  if (t.matches("[data-save]")) { saveEdit(); return; }
  if (t.matches("[data-delete]")) { deleteItem(t); return; }
  if (t.matches("[data-clear-photo]")) { setPath(edit.item, t.dataset.clearPhoto, ""); drawEditor(); return; }
  if (t.matches("[data-add-entry]")) { edit.item.onderdelen[t.dataset.addEntry].push(blankGasEntry()); drawEditor(); return; }
  if (t.matches("[data-remove-entry]")) { const [k, i] = t.dataset.removeEntry.split("."); edit.item.onderdelen[k].splice(+i, 1); drawEditor(); return; }
});
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "q") { state.q = t.value.trim(); render(); return; }
  if (edit && t.dataset.path && t.closest("#editForm")) setPath(edit.item, t.dataset.path, t.value);
});
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.id === "fGebouw") { state.gebouw = t.value; render(); return; }
  if (t.matches("input[type=file][data-photo]")) onPhoto(t);
});
$("#editor").addEventListener("cancel", (ev) => { ev.preventDefault(); cancelEdit(); });
$("#loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target; const email = $("#loginMail").value.trim().toLowerCase();
  if (!email || !email.includes("@")) { $("#loginMail").focus(); toast("Vul een geldig e-mailadres in."); return; }
  const knop = f.querySelector("button[type=submit]"); knop.disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  knop.disabled = false;
  if (error) toast("Versturen mislukt: " + errText(error));
  else f.innerHTML = `<h2>Kijk in je mailbox</h2><p>We stuurden een aanmeldlink naar <strong>${esc(email)}</strong>. Open die link op dit toestel.</p>`;
});

/* ---------- Opstart ---------- */
function setSession(s) {
  const was = !!sessie;
  sessie = s;
  if (s && !was) {
    Store.loadAll();
    kanaal = sb.channel("rookgas-wijzigingen");
    [T_ROOK, T_GAS].forEach((table) => kanaal.on("postgres_changes", { event: "*", schema: "public", table }, () => Store.loadAll()));
    kanaal.subscribe();
  }
  if (!s) { Store.items = []; Store.loaded = false; if (kanaal) { sb.removeChannel(kanaal); kanaal = null; } }
  render();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
showInstall();
render();
(async () => {
  const cfg = window.ROOKGAS_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) { banner("De app kon niet starten: de koppeling met de database ontbreekt (config.js)."); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
  setSession((data && data.session) || null);
  sb.auth.onAuthStateChange((ev, s) => { if (!!s !== !!sessie) setSession(s); else sessie = s; });
  // Terug naar de app (gsm): gegevens verversen.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sessie) Store.loadAll(); });
})();
})();
