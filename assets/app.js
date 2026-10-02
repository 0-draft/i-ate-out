import { t, genre, area, tag, setLang, getLang, GENRE_LABELS, AREA_LABELS } from "./i18n.js";

const REPO = "0-draft/i-ate-out";
const LS_RATINGS = "i-ate-out/ratings/v1";
const LS_LANG = "i-ate-out/lang/v1";

const GENRE_ORDER = Object.keys(GENRE_LABELS.en);
const AREA_ORDER = Object.keys(AREA_LABELS.ja);

// Pin colour per genre. Kept here rather than in CSS so the map and the
// genre chip can share one source.
const GENRE_HUE = {
  ramen: "#d6335b", teishoku: "#e8892b", chinese: "#c2185b", curry: "#f0b429",
  soba: "#4a8f7b", yoshoku: "#a15bb5", yakiniku: "#b4462a", yakitori: "#d97a1f",
  sushi: "#2f8fbf", ethnic: "#3fa2b4", korean: "#cf3f3f", kissa: "#8a6a4f",
  nomi: "#5f7f3f",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let shops = [];
let ratings = {};
let photos = new Set();
let map = null;
let editing = null;
const filter = { q: "", genres: new Set(), areas: new Set(), soloOnly: false };

/* ---------- scores ---------- */

const scoreOf = (id) => {
  const v = ratings[id]?.score;
  return typeof v === "number" ? v : null;
};

const fmt = (n) => n.toFixed(1);

/* ---------- persistence ---------- */

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback; }
  catch { return fallback; }
}

function writeLocal() {
  try { localStorage.setItem(LS_RATINGS, JSON.stringify(ratings)); }
  catch { /* private window or blocked storage: keep rendering anyway */ }
}

function mergeRatings(fromRepo, fromLocal) {
  const out = { ...fromRepo };
  for (const [id, local] of Object.entries(fromLocal)) {
    const repo = fromRepo[id];
    if (!repo || (local.updatedAt || "") >= (repo.updatedAt || "")) out[id] = local;
  }
  return out;
}

function touch(id) {
  ratings[id].updatedAt = new Date().toISOString().slice(0, 10);
  writeLocal();
  render();
}

/* ---------- outbound links ---------- */

const tabelogUrl = (s) => `https://tabelog.com/rstLst/?sw=${encodeURIComponent(`${s.name} 池袋`)}`;
const photosUrl = (s) => `https://duckduckgo.com/?q=${encodeURIComponent(`${s.name} 池袋`)}&iax=images&ia=images`;
const mapsUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.lat ? `${s.lat},${s.lng}` : `${s.name} 豊島区`)}`;

/* ---------- card ---------- */

function imageOf(shop) {
  if (photos.has(shop.id)) return `assets/shops/${shop.id}.jpg`;
  return shop.image || null;
}

function card(shop, place) {
  const score = scoreOf(shop.id);
  const src = imageOf(shop);
  const meta = [
    `<span class="card__tag card__tag--area">${area(shop.area)}</span>`,
    shop.price ? `<span class="card__tag">${shop.price}</span>` : "",
    shop.tabelog ? `<span class="card__tag card__tag--score">${t("card.tabelog", shop.tabelog.toFixed(2))}</span>` : "",
    shop.gnavi ? `<span class="card__tag card__tag--score">${t("card.gnavi", shop.gnavi.toFixed(1))}</span>` : "",
    shop.hotpepper ? `<span class="card__tag card__tag--score">${t("card.hotpepper", shop.hotpepper.toFixed(1))}</span>` : "",
    ...(shop.tags || []).slice(0, 3).map((x) => `<span class="card__tag">${tag(x)}</span>`),
  ].join("");

  return `
    <button type="button" class="card${score !== null ? " is-scored" : ""}" data-id="${shop.id}">
      <span class="card__shot${src ? "" : " card__shot--empty"}" style="--hue:${GENRE_HUE[shop.genre] || "#888"}">
        <span class="card__initial" aria-hidden="true">${shop.name.slice(0, 1)}</span>
        ${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
        <span class="card__genre">${genre(shop.genre)}</span>
        ${place ? `<span class="card__place" aria-hidden="true">${place}</span>` : ""}
        ${score !== null ? `<span class="card__score">${fmt(score)}</span>` : ""}
      </span>
      <span class="card__body">
        <span class="card__name">${shop.name}</span>
        <span class="card__meta">${meta}</span>
        ${shop.note ? `<span class="card__note">${shop.note}</span>` : ""}
      </span>
    </button>`;
}

const grid = (list, empty, ranked = false) => (list.length
  ? `<div class="grid">${list.map((s, i) => card(s, ranked ? i + 1 : null)).join("")}</div>`
  : `<p class="empty">${empty}</p>`);

/* ---------- filtering ---------- */

function passes(shop) {
  if (filter.soloOnly && !shop.solo) return false;
  if (filter.genres.size && !filter.genres.has(shop.genre)) return false;
  if (filter.areas.size && !filter.areas.has(shop.area)) return false;
  if (filter.q) {
    const hay = [shop.name, shop.area, area(shop.area), shop.note, shop.spot,
      ...(shop.tags || []), ...(shop.tags || []).map(tag)].join(" ").toLowerCase();
    if (!hay.includes(filter.q.toLowerCase())) return false;
  }
  return true;
}

function buildChips() {
  const counts = {};
  for (const s of shops) counts[s.genre] = (counts[s.genre] || 0) + 1;

  $("#chips-genre").innerHTML = GENRE_ORDER.filter((g) => counts[g]).map((g) =>
    `<button type="button" class="chip${filter.genres.has(g) ? " is-on" : ""}" data-genre="${g}" style="--hue:${GENRE_HUE[g]}">${genre(g)}<span class="chip__n">${counts[g]}</span></button>`
  ).join("");

  $("#chips-area").innerHTML = AREA_ORDER.filter((a) => shops.some((s) => s.area === a)).map((a) =>
    `<button type="button" class="chip${filter.areas.has(a) ? " is-on" : ""}" data-area="${a}">${area(a)}</button>`
  ).join("");
}

/* ---------- views ---------- */

function render() {
  const unscored = shops.filter((s) => scoreOf(s.id) === null);
  const shown = unscored.filter(passes);

  $("#view-candidates").innerHTML =
    `<div class="view__lead"><p>${unscored.length ? t("cand.lead", shown.length, unscored.length) : t("cand.allRated")}</p></div>`
    + grid(shown, t("cand.empty"));

  const ranked = shops
    .filter((s) => scoreOf(s.id) !== null && passes(s))
    .sort((a, b) => scoreOf(b.id) - scoreOf(a.id));

  $("#view-rank").innerHTML = `<div class="view__lead"><p>${t("rank.lead")}</p></div>`
    + grid(ranked, t("rank.empty"), true);

  $("#n-cand").textContent = unscored.length;
  $("#n-rank").textContent = shops.length - unscored.length || "";

  renderMapRest();
  if (map) drawMarkers();
  updateExport();
}

/* ---------- map ---------- */

function initMap() {
  if (map || typeof L === "undefined") return;
  map = L.map("map", { scrollWheelZoom: false, zoomControl: true });
  // Plain OSM tiles: CARTO's basemaps now watermark every tile with
  // "API KEY REQUIRED", and a key is not worth it for a map this small.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.markers = L.layerGroup().addTo(map);
  drawMarkers();
}

function drawMarkers() {
  map.markers.clearLayers();
  const plotted = shops.filter((s) => s.lat && passes(s));

  for (const s of plotted) {
    const score = scoreOf(s.id);
    const hue = GENRE_HUE[s.genre] || "#888";
    const html = score !== null
      ? `<span class="pin pin--scored" style="--hue:${hue}">${fmt(score)}</span>`
      : `<span class="pin" style="--hue:${hue}"></span>`;
    L.marker([s.lat, s.lng], {
      title: s.name,
      icon: L.divIcon({ className: "pin-wrap", html, iconSize: [30, 30], iconAnchor: [15, 15] }),
    })
      .addTo(map.markers)
      .bindPopup(`<b>${s.name}</b><br>${genre(s.genre)}　${area(s.area)}<br>${score !== null ? `${fmt(score)} / 10` : ""}`);
  }

  if (plotted.length) {
    map.fitBounds(L.latLngBounds(plotted.map((s) => [s.lat, s.lng])), { padding: [36, 36], maxZoom: 16 });
  } else {
    map.setView([35.7295, 139.7135], 15);
  }
}

function renderMapRest() {
  const placed = shops.filter((s) => s.lat);
  const rest = shops.filter((s) => !s.lat);
  $("#map-count").textContent = t("map.lead", placed.length, rest.length);
  $("#map-rest").innerHTML = rest.length
    ? `<p>${t("map.unlisted")}</p><ul>${rest.map((s) => `<li><a href="${mapsUrl(s)}" target="_blank" rel="noopener">${s.name}</a></li>`).join("")}</ul>`
    : "";
}

/* ---------- editor ---------- */

function openEditor(id) {
  const shop = shops.find((s) => s.id === id);
  if (!shop) return;
  editing = shop;
  const r = ratings[id] || {};
  const score = scoreOf(id);

  $("#ed-name").textContent = shop.name;
  $("#ed-meta").textContent = [genre(shop.genre), area(shop.area), shop.spot, shop.price, shop.hours].filter(Boolean).join("　");
  $("#ed-note").textContent = shop.note || "";

  const figure = $("#ed-figure");
  const src = imageOf(shop);
  if (src) {
    $("#ed-photo").src = src;
    $("#ed-photo").referrerPolicy = "no-referrer";
    $("#ed-credit").textContent = shop.imageCredit || "";
    figure.hidden = false;
  } else {
    figure.hidden = true;
  }

  $("#ed-score").textContent = score === null ? t("ed.unscored") : fmt(score);
  $("#ed-steps").innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
    `<button type="button" class="step${score !== null && score >= n ? " is-on" : ""}" data-score="${n}" aria-label="${t("score.aria", n)}">${n}</button>`
  ).join("");

  $("#ed-memo").value = r.memo || "";
  $("#ed-date").value = r.visitedAt || "";
  $("#ed-tabelog").href = tabelogUrl(shop);
  $("#ed-maps").href = mapsUrl(shop);
  $("#ed-photos").href = photosUrl(shop);
  updateIssueLink();

  const dialog = $("#editor");
  if (!dialog.open) dialog.showModal();
}

function updateIssueLink() {
  if (!editing) return;
  const r = ratings[editing.id] || {};
  const score = scoreOf(editing.id);
  const body = [
    `${editing.name} ${score === null ? "" : fmt(score)}${r.visitedAt ? ` ${r.visitedAt}` : ""}${r.memo ? ` memo=${r.memo}` : ""}`,
    "",
    "```json",
    JSON.stringify({ [editing.id]: r }, null, 2),
    "```",
  ].join("\n");

  $("#ed-issue").href = `https://github.com/${REPO}/issues/new?labels=rating`
    + `&title=${encodeURIComponent(`[visit] ${editing.name}`)}`
    + `&body=${encodeURIComponent(body)}`;
}

function updateExport() {
  const link = $("#export-link");
  if (link.dataset.url) URL.revokeObjectURL(link.dataset.url);
  const url = URL.createObjectURL(new Blob([JSON.stringify(ratings, null, 2)], { type: "application/json" }));
  link.href = url;
  link.dataset.url = url;
}

/* ---------- view switching ---------- */

function show(next) {
  $$(".tab").forEach((el) => {
    const on = el.dataset.view === next;
    el.classList.toggle("is-on", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $$(".view").forEach((v) => { v.hidden = v.id !== `view-${next}`; });
  if (next === "map") { initMap(); setTimeout(() => map && map.invalidateSize(), 0); }
}

/* ---------- language ---------- */

function applyLang() {
  document.title = t("doc.title");
  for (const el of $$("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of $$("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of $$("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of $$("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  buildChips();
  $("#chip-solo").classList.toggle("is-on", filter.soloOnly);
  render();
  if (editing) openEditor(editing.id);
}

function switchLang(next) {
  setLang(next);
  try { localStorage.setItem(LS_LANG, next); } catch { /* ignore */ }
  applyLang();
}

/* ---------- boot ---------- */

async function main() {
  const load = (path, fallback) => fetch(path).then((r) => r.json()).catch(() => fallback);
  const [shopData, ratingData, photoData] = await Promise.all([
    load("data/shops.json", []),
    load("data/ratings.json", {}),
    load("data/photos.json", []),
  ]);
  shops = shopData;
  ratings = mergeRatings(ratingData, readJson(LS_RATINGS, {}));
  photos = new Set(photoData);
  setLang(readJson(LS_LANG, null) || "en");

  applyLang();
  show("rank");
}

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  const tabEl = e.target.closest(".tab");
  if (tabEl) return show(tabEl.dataset.view);

  if (e.target.closest("#lang")) return switchLang(getLang() === "en" ? "ja" : "en");

  const cardEl = e.target.closest(".card");
  if (cardEl) return openEditor(cardEl.dataset.id);

  if (e.target.closest("#chip-solo")) {
    filter.soloOnly = !filter.soloOnly;
    $("#chip-solo").classList.toggle("is-on", filter.soloOnly);
    return render();
  }

  const chip = e.target.closest(".chip");
  if (chip) {
    const set = chip.dataset.genre ? filter.genres : filter.areas;
    const key = chip.dataset.genre || chip.dataset.area;
    if (set.has(key)) set.delete(key); else set.add(key);
    chip.classList.toggle("is-on");
    return render();
  }

  const step = e.target.closest(".step");
  if (step && editing) {
    const n = Number(step.dataset.score);
    const r = (ratings[editing.id] = ratings[editing.id] || {});
    r.score = r.score === n ? 0 : n;
    touch(editing.id);
    return openEditor(editing.id);
  }
});

document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG") return;
  const shot = img.closest(".card__shot");
  if (shot) { shot.classList.add("card__shot--empty"); img.remove(); return; }
  if (img.id === "ed-photo") $("#ed-figure").hidden = true;
}, true);

$("#q").addEventListener("input", (e) => { filter.q = e.target.value.trim(); render(); });

$("#ed-memo").addEventListener("input", (e) => {
  if (!editing) return;
  const r = (ratings[editing.id] = ratings[editing.id] || {});
  r.memo = e.target.value;
  writeLocal();
  updateIssueLink();
});

$("#ed-date").addEventListener("change", (e) => {
  if (!editing) return;
  const r = (ratings[editing.id] = ratings[editing.id] || {});
  r.visitedAt = e.target.value;
  touch(editing.id);
  updateIssueLink();
});

$("#ed-clear").addEventListener("click", () => {
  if (!editing) return;
  delete ratings[editing.id];
  writeLocal();
  render();
  $("#editor").close();
});

$("#editor").addEventListener("close", () => { editing = null; });

main();
