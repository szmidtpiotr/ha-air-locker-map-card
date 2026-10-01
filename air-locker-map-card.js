/*
 * Air Locker Map Card — karta Lovelace dla integracji Air Locker Map
 * (czujniki powietrza w paczkomatach InPost).
 * https://github.com/szmidtpiotr/ha-air-locker-map-card
 *
 * Jeden plik, bez budowania i bez zależności. Licencja MIT.
 */

const CARD_VERSION = "0.1.0";
const PLATFORM = "air_locker_map";
const DEFAULT_MAP_URL = "https://air-locker-map.studio-colorbox.com/";

// Progi indeksu jakości powietrza GIOŚ (µg/m³) i odpowiadające im etykiety/kolory.
const PM25_THRESHOLDS = [13, 35, 55, 75, 110];
const PM10_THRESHOLDS = [20, 50, 80, 110, 150];
const LEVELS = [
  { label: "bardzo dobry", color: "#2e9e44", text: "#ffffff" },
  { label: "dobry", color: "#9ccc3a", text: "#1b1b1b" },
  { label: "umiarkowany", color: "#f2c80f", text: "#1b1b1b" },
  { label: "dostateczny", color: "#ef8a17", text: "#1b1b1b" },
  { label: "zły", color: "#d7301f", text: "#ffffff" },
  { label: "bardzo zły", color: "#8c1d40", text: "#ffffff" },
];
// Normy dobowe WHO 2021 (µg/m³).
const WHO_PM25 = 15;
const WHO_PM10 = 45;

const UNAVAILABLE = ["unavailable", "unknown", "none", ""];

// --- pomocnicze -------------------------------------------------------------

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAvailable(stateObj) {
  return !!stateObj && !UNAVAILABLE.includes(String(stateObj.state).toLowerCase());
}

function numeric(stateObj) {
  if (!isAvailable(stateObj)) return null;
  const n = parseFloat(stateObj.state);
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 1) {
  return n.toLocaleString("pl-PL", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function levelIndex(value, thresholds) {
  if (value === null) return -1;
  const i = thresholds.findIndex((t) => value <= t);
  return i === -1 ? thresholds.length : i;
}

function formatDistance(meters) {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${fmt(meters / 1000, meters < 10000 ? 1 : 0)} km`;
}

function formatAgo(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "odczyt przed chwilą";
  if (min < 60) return `odczyt ${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `odczyt ${h} godz. temu`;
  const d = Math.floor(h / 24);
  return `odczyt ${d} ${d === 1 ? "dzień" : "dni"} temu`;
}

// Ścieżki ikon MDI (żeby nie zależeć od ha-icon).
const ICON_ALERT =
  "M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z";
const ICON_MAP =
  "M15,19L9,16.89V5L15,7.11M20.5,3C20.44,3 20.39,3 20.34,3L15,5.1L9,3L3.36,4.9C3.15,4.97 3,5.15 3,5.38V20.5A0.5,0.5 0 0,0 3.5,21C3.55,21 3.61,21 3.66,20.97L9,18.9L15,21L20.64,19.1C20.85,19 21,18.85 21,18.62V3.5A0.5,0.5 0 0,0 20.5,3Z";
const svg = (path, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;

// --- wykrywanie encji -------------------------------------------------------

/**
 * Szuka encji tego samego urządzenia co wskazany czujnik PM2.5 (albo device_id).
 * Rozpoznaje je po translation_key z rejestru encji, a w drugiej kolejności
 * po device_class / atrybutach stanu — entity_id może być dowolnie zmienione.
 */
function discoverEntities(hass, config) {
  const reg = hass.entities || {};
  let deviceId = config.device_id;
  if (!deviceId && config.entity) deviceId = reg[config.entity]?.device_id;

  const found = {};
  if (config.entity) found.pm25 = config.entity;
  if (!deviceId) return { deviceId: null, ids: found };

  for (const entry of Object.values(reg)) {
    if (entry.device_id !== deviceId) continue;
    if (entry.platform && entry.platform !== PLATFORM) continue;
    const id = entry.entity_id;
    const domain = id.split(".")[0];
    const st = hass.states[id];
    const dc = st?.attributes?.device_class;
    const tk = entry.translation_key;

    if (domain === "binary_sensor") {
      if (tk === "suspect" || dc === "problem") found.problem ??= id;
      continue;
    }
    if (domain !== "sensor") continue;

    if (dc === "pm25") found.pm25 ??= id;
    else if (dc === "pm1") found.pm1 ??= id;
    else if (dc === "pm10") found.pm10 ??= id;
    else if (tk === "pm4") found.pm4 ??= id;
    else if (tk === "pressure_sl") found.pressure = id;
    else if (dc === "atmospheric_pressure" && tk !== "pressure_raw") found.pressure ??= id;
    else if (tk === "distance" || dc === "distance") found.distance ??= id;
    else if (tk === "updated" || dc === "timestamp") found.updated ??= id;
    else if (
      tk === "source" ||
      (st?.attributes && "latitude" in st.attributes && "address" in st.attributes)
    )
      found.source ??= id;
  }
  // jawne nadpisania z konfiguracji (opcjonalne)
  for (const key of ["pm1", "pm10", "pressure", "distance", "updated", "source", "problem"]) {
    if (config[`${key}_entity`]) found[key] = config[`${key}_entity`];
  }
  return { deviceId, ids: found };
}

// --- karta ------------------------------------------------------------------

class AirLockerMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._lastKey = null;
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest?.("[data-entity]")) {
        ev.preventDefault();
        this._onClick(ev);
      }
    });
  }

  static getConfigElement() {
    return document.createElement("air-locker-map-card-editor");
  }

  static getStubConfig(hass) {
    const reg = hass?.entities || {};
    const states = hass?.states || {};
    const candidates = Object.keys(states).filter(
      (id) => id.startsWith("sensor.") && states[id].attributes?.device_class === "pm25"
    );
    const own = candidates.find((id) => reg[id]?.platform === PLATFORM);
    return { entity: own || candidates[0] || "" };
  }

  setConfig(config) {
    if (!config || (!config.entity && !config.device_id)) {
      throw new Error("Podaj encję PM2.5 (entity) albo device_id urządzenia Air Locker Map.");
    }
    this._config = {
      show_pressure: true,
      show_details: true,
      map_url: DEFAULT_MAP_URL,
      ...config,
    };
    this._lastKey = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    // odświeżanie „X min temu”
    this._timer = setInterval(() => {
      this._lastKey = null;
      this._render();
    }, 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, min_rows: 3 };
  }

  _onClick(ev) {
    const el = ev.composedPath().find((n) => n instanceof HTMLElement && n.dataset?.entity);
    if (!el) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: el.dataset.entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this._config || !this._hass) return;
    const hass = this._hass;
    const { deviceId, ids } = discoverEntities(hass, this._config);
    const st = (k) => (ids[k] ? hass.states[ids[k]] : undefined);

    // Renderujemy ponownie tylko gdy zmienił się któryś z naszych stanów.
    const key = JSON.stringify(Object.values(ids).map((id) => hass.states[id]?.last_updated ?? id));
    if (key === this._lastKey) return;
    this._lastKey = key;

    const cfg = this._config;
    const pm25 = numeric(st("pm25"));
    const pm1 = numeric(st("pm1"));
    const pm10 = numeric(st("pm10"));
    const pressure = numeric(st("pressure"));
    const distance = numeric(st("distance"));
    const source = st("source");
    const problem = st("problem");
    const updatedSt = st("updated");

    const unit = st("pm25")?.attributes?.unit_of_measurement || "µg/m³";
    const lvl = levelIndex(pm25, PM25_THRESHOLDS);
    const level = lvl >= 0 ? LEVELS[lvl] : null;
    const lvl10 = levelIndex(pm10, PM10_THRESHOLDS);

    const device = deviceId ? hass.devices?.[deviceId] : null;
    const title = cfg.title ?? (device?.name_by_user || device?.name || "Jakość powietrza");

    // --- nagłówek i główna wartość
    const missing = !hass.states[ids.pm25];
    const mainValue =
      pm25 === null
        ? `<span class="nodata">brak danych</span>`
        : `<span class="value">${fmt(pm25)}</span><span class="unit">${esc(unit)}</span>`;
    const who25 = pm25 === null ? "" : `${Math.round((pm25 / WHO_PM25) * 100)}% normy WHO (24 h)`;

    const scale = LEVELS.map(
      (l, i) =>
        `<span class="seg${i === lvl ? " on" : ""}" style="--c:${l.color}" title="${esc(l.label)}"></span>`
    ).join("");

    // --- wiersz mniejszych wartości
    const tile = (k, label, value, digits, extra = "", dotColor = null) => {
      const s = st(k);
      const u = s?.attributes?.unit_of_measurement || (k === "pressure" ? "hPa" : "µg/m³");
      const body =
        value === null
          ? `<span class="nodata">brak danych</span>`
          : `<span class="tv">${dotColor ? `<i class="dot" style="background:${dotColor}"></i>` : ""}${fmt(
              value,
              digits
            )}</span> <span class="tu">${esc(u)}</span>`;
      const attrs = ids[k] ? ` data-entity="${esc(ids[k])}" role="button" tabindex="0"` : "";
      return `<div class="tile"${attrs}><div class="tl">${label}</div><div class="tb">${body}</div>${
        extra ? `<div class="tx">${extra}</div>` : ""
      }</div>`;
    };
    const tiles = [
      tile("pm1", "PM1", pm1, 1),
      tile(
        "pm10",
        "PM10",
        pm10,
        1,
        pm10 === null ? "" : `${LEVELS[lvl10].label}<br>${Math.round((pm10 / WHO_PM10) * 100)}% WHO`,
        pm10 === null ? null : LEVELS[lvl10].color
      ),
    ];
    if (cfg.show_pressure) tiles.push(tile("pressure", "Ciśnienie", pressure, 0, "n.p.m."));

    // --- ostrzeżenie o podejrzanym odczycie
    let warning = "";
    if (problem && problem.state === "on") {
      let reasons = problem.attributes?.reasons;
      if (Array.isArray(reasons)) reasons = reasons.join(", ");
      warning = `<div class="warning" data-entity="${esc(ids.problem)}" role="button" tabindex="0">${svg(
        ICON_ALERT,
        18
      )}<div><b>Podejrzany odczyt</b>${reasons ? `<span>${esc(reasons)}</span>` : ""}</div></div>`;
    }

    // --- stopka
    const lat = parseFloat(source?.attributes?.latitude);
    const lon = parseFloat(source?.attributes?.longitude);
    const base = String(cfg.map_url || DEFAULT_MAP_URL).split("#")[0];
    const mapHref =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? `${base}#lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&z=14`
        : base;

    let details = "";
    if (cfg.show_details) {
      const code = isAvailable(source) ? source.state : null;
      const address = source?.attributes?.address;
      const updated = isAvailable(updatedSt) ? new Date(updatedSt.state) : null;
      const meta = [formatDistance(distance), formatAgo(updated)].filter(Boolean).join(" · ");
      details = `
        <div class="src" ${ids.source ? `data-entity="${esc(ids.source)}" role="button" tabindex="0"` : ""}>
          <div class="code">${code ? esc(code) : `<span class="nodata">brak danych</span>`}</div>
          ${address ? `<div class="addr">${esc(address)}</div>` : ""}
          ${meta ? `<div class="meta">${esc(meta)}</div>` : ""}
        </div>`;
    }
    const footer = `
      <div class="footer">
        ${details || "<span></span>"}
        <a class="maplink" href="${esc(mapHref)}" target="_blank" rel="noopener noreferrer">${svg(
      ICON_MAP
    )}Zobacz na mapie</a>
      </div>`;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="card">
          <div class="head">
            <div class="title">${esc(title)}</div>
            ${problem && problem.state === "on" ? `<span class="badge">${svg(ICON_ALERT, 14)}podejrzany</span>` : ""}
          </div>
          ${missing ? `<div class="warning">${svg(ICON_ALERT, 18)}<div><b>Nie znaleziono encji</b><span>${esc(
        ids.pm25 || cfg.device_id
      )}</span></div></div>` : ""}
          <div class="main" style="--lvl:${level ? level.color : "var(--divider-color, #ccc)"}">
            <div class="big" ${ids.pm25 ? `data-entity="${esc(ids.pm25)}" role="button" tabindex="0"` : ""}>
              <div class="label">PM2.5</div>
              <div class="num">${mainValue}</div>
            </div>
            <div class="idx">
              ${
                level
                  ? `<span class="pill" style="background:${level.color};color:${level.text}">${level.label}</span>
                     <span class="who">${who25}</span>`
                  : `<span class="pill none">brak indeksu</span>`
              }
              <div class="scale">${scale}</div>
            </div>
          </div>
          <div class="tiles">${tiles.join("")}</div>
          ${warning}
          ${footer}
        </div>
      </ha-card>`;
  }
}

const STYLES = `
  :host { display: block; }
  ha-card { display: block; height: 100%; overflow: hidden; }
  .card {
    container-type: inline-size;
    padding: 16px;
    color: var(--primary-text-color, #212121);
    display: flex; flex-direction: column; gap: 14px;
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  [role="button"] { cursor: pointer; border-radius: 10px; }
  [role="button"]:hover { background: color-mix(in srgb, var(--primary-text-color, #000) 5%, transparent); }
  [role="button"]:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .title { font-size: 1.15rem; font-weight: 500; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
    padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
    background: var(--warning-color, #ffa600); color: #1b1b1b;
  }
  .main {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 16px;
    border-left: 6px solid var(--lvl); padding-left: 12px;
  }
  .big { padding: 2px 8px 2px 4px; margin-left: -4px; }
  .label { font-size: 0.85rem; color: var(--secondary-text-color, #727272); font-weight: 500; }
  .num { display: flex; align-items: baseline; gap: 6px; }
  .value { font-size: 3rem; font-weight: 600; line-height: 1.05; letter-spacing: -0.02em; }
  .unit { font-size: 1rem; color: var(--secondary-text-color, #727272); }
  .idx { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; min-width: 150px; flex: 1; }
  .pill { padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 0.95rem; white-space: nowrap; }
  .pill.none { background: var(--divider-color, #e0e0e0); color: var(--secondary-text-color, #727272); }
  .who { font-size: 0.8rem; color: var(--secondary-text-color, #727272); }
  .scale { display: flex; gap: 3px; width: 100%; max-width: 180px; }
  .seg { flex: 1; height: 6px; border-radius: 3px; background: var(--c); opacity: 0.3; }
  .seg.on { opacity: 1; transform: scaleY(1.6); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
  .tile {
    padding: 8px 10px; border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 10px; min-width: 0;
  }
  .tl { font-size: 0.75rem; color: var(--secondary-text-color, #727272); font-weight: 500; }
  .tb { white-space: nowrap; }
  .tv { font-size: 1.25rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
  .tu { font-size: 0.75rem; color: var(--secondary-text-color, #727272); }
  .tx { font-size: 0.7rem; color: var(--secondary-text-color, #727272); line-height: 1.3; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .nodata { color: var(--secondary-text-color, #727272); font-style: italic; font-size: 0.95rem; font-weight: 400; }
  .warning {
    display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px;
    border-radius: 10px; font-size: 0.85rem;
    background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning-color, #ffa600) 60%, transparent);
  }
  .warning svg { color: var(--warning-color, #ffa600); flex-shrink: 0; margin-top: 1px; }
  .warning div { display: flex; flex-direction: column; gap: 2px; }
  .warning span { color: var(--secondary-text-color, #727272); }
  .footer {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap;
    border-top: 1px solid var(--divider-color, #e0e0e0); padding-top: 10px; font-size: 0.85rem;
  }
  .src { min-width: 0; flex: 1 1 200px; padding: 2px 4px; margin: -2px -4px; }
  .code { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .addr { color: var(--secondary-text-color, #727272); margin-top: 1px; }
  .meta { color: var(--secondary-text-color, #727272); font-size: 0.8rem; margin-top: 2px; }
  @container (max-width: 330px) {
    .idx { align-items: flex-start; }
    .value { font-size: 2.6rem; }
  }
  .maplink {
    display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    color: var(--primary-color, #03a9f4); text-decoration: none; font-weight: 500;
  }
  .maplink:hover { text-decoration: underline; }
`;

// --- edytor wizualny ----------------------------------------------------------

const EDITOR_SCHEMA = [
  {
    name: "entity",
    required: true,
    selector: { entity: { filter: { domain: "sensor", device_class: "pm25", integration: PLATFORM } } },
  },
  { name: "title", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_pressure", selector: { boolean: {} } },
      { name: "show_details", selector: { boolean: {} } },
    ],
  },
  { name: "map_url", selector: { text: { type: "url" } } },
];

const EDITOR_LABELS = {
  entity: "Czujnik PM2.5 (Air Locker Map)",
  title: "Tytuł (puste = nazwa urządzenia)",
  show_pressure: "Pokazuj ciśnienie",
  show_details: "Pokazuj paczkomat i czas odczytu",
  map_url: "Adres mapy",
};

class AirLockerMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _update() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = EDITOR_SCHEMA;
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...ev.detail.value };
        for (const k of ["title", "map_url"]) if (config[k] === "") delete config[k];
        this._config = config;
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { show_pressure: true, show_details: true, ...this._config };
  }
}

if (!customElements.get("air-locker-map-card")) {
  customElements.define("air-locker-map-card", AirLockerMapCard);
}
if (!customElements.get("air-locker-map-card-editor")) {
  customElements.define("air-locker-map-card-editor", AirLockerMapCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "air-locker-map-card")) {
  window.customCards.push({
    type: "air-locker-map-card",
    name: "Air Locker Map",
    description: "Jakość powietrza z czujnika w paczkomacie InPost (integracja Air Locker Map).",
    preview: true,
    documentationURL: "https://github.com/szmidtpiotr/ha-air-locker-map-card",
  });
}

console.info(
  `%c AIR-LOCKER-MAP-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#2e9e44;font-weight:700",
  "color:#2e9e44;background:transparent"
);
