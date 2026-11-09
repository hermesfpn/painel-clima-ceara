/* Atmos Ceará — Painel do Clima
 * Fontes públicas (todas consultadas direto do navegador, sem chave):
 *   IBGE (malhas e localidades) · Open-Meteo (previsão, qualidade do ar, marinho)
 *   INMET (estações, avisos, previsão oficial) · INPE (focos de queimadas) · RainViewer (radar)
 */
(() => {
  'use strict';

  const { TZ, BOUNDS, HOURS, REFRESH_MS, VARS, COAST, URLS, ACUDE_SCALE, PROXY } = window.CFG;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const SMALL = new Set(['de', 'do', 'da', 'dos', 'das', 'e']);
  const titleCase = (s) => s.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  async function j(url, { text = false, timeout = 30000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (r.status === 204) return null;
      return text ? r.text() : r.json();
    } finally { clearTimeout(t); }
  }

  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3500);
  }

  // ------------------------------------------------------------ Cores
  const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const k in VARS) VARS[k].rgb = VARS[k].scale.map(([v, c]) => [v, hex2rgb(c)]);
  const ACUDE_RGB = { rgb: ACUDE_SCALE.map(([v, c]) => [v, hex2rgb(c)]) };
  function colorRGB(k, v) {
    const s = (k === '_acude' ? ACUDE_RGB : VARS[k]).rgb;
    if (v <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        const [v0, c0] = s[i - 1], [v1, c1] = s[i], t = (v - v0) / (v1 - v0);
        return [0, 1, 2].map((n) => c0[n] + (c1[n] - c0[n]) * t);
      }
    }
    return s[s.length - 1][1];
  }
  const color = (k, v) => { const c = colorRGB(k, v); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; };
  // Contraste relativo: estica a escala entre o mínimo e o máximo atuais do estado.
  let RANGE = null;
  function computeRange() {
    const vals = MUNS.map((m) => value(m)).filter((v) => v != null);
    RANGE = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }
  function shade(v) {
    if (!state.rel || !RANGE || RANGE.max === RANGE.min) return color(state.v, v);
    const s = VARS[state.v].scale, lo = s[0][0], hi = s[s.length - 1][0];
    return color(state.v, lo + ((v - RANGE.min) / (RANGE.max - RANGE.min)) * (hi - lo));
  }
  const fmt = (k, v, full = false) => (v == null || Number.isNaN(v) ? '—'
    : (VARS[k].dec ? v.toFixed(VARS[k].dec) : Math.round(v)) + (full ? VARS[k].full : VARS[k].unit));

  // ------------------------------------------------------------ Geometria
  const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  function ringArea(r) { let a = 0; for (let i = 0, n = r.length, k = n - 1; i < n; k = i++) a += (r[k][0] + r[i][0]) * (r[k][1] - r[i][1]); return a / 2; }
  function ringCentroid(r) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, n = r.length, k = n - 1; i < n; k = i++) {
      const f = r[k][0] * r[i][1] - r[i][0] * r[k][1];
      a += f; x += (r[k][0] + r[i][0]) * f; y += (r[k][1] + r[i][1]) * f;
    }
    a *= 0.5;
    return a ? [x / (6 * a), y / (6 * a)] : r[0];
  }
  function inRing(x, y, r) {
    let ins = false;
    for (let i = 0, n = r.length, k = n - 1; i < n; k = i++) {
      const xi = r[i][0], yi = r[i][1], xk = r[k][0], yk = r[k][1];
      if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function inPolys(x, y, polys) {
    for (const p of polys) {
      if (!inRing(x, y, p[0])) continue;
      let hole = false;
      for (let h = 1; h < p.length; h++) if (inRing(x, y, p[h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function bboxOf(polys) {
    const b = [180, 90, -180, -90];
    for (const p of polys) for (const [x, y] of p[0]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    return b;
  }
  function labelPoint(polys, bbox) {
    const big = polys.reduce((b, p) => (Math.abs(ringArea(p[0])) > Math.abs(ringArea(b[0])) ? p : b));
    const [cx, cy] = ringCentroid(big[0]);
    if (inPolys(cx, cy, [big])) return [cx, cy];
    let best = null, bd = Infinity;
    for (let i = 1; i < 16; i++) for (let k = 1; k < 16; k++) {
      const px = bbox[0] + (bbox[2] - bbox[0]) * i / 16, py = bbox[1] + (bbox[3] - bbox[1]) * k / 16;
      if (inPolys(px, py, [big])) { const d = (px - cx) ** 2 + (py - cy) ** 2; if (d < bd) { bd = d; best = [px, py]; } }
    }
    return best || big[0][0];
  }
  const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  const km = (lat1, lon1, lat2, lon2) => {
    const cl = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const dx = (lon2 - lon1) * 111.32 * cl, dy = (lat2 - lat1) * 110.57;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // ------------------------------------------------------------ Estado
  const state = {
    v: 'temp', hour: 0, playing: false, ready: false, selected: null, meso: null, updatedAt: null, rel: false,
    layers: { choro: true, wind: true, acudes: true, stations: true, fires: true, alerts: true, coast: true, radar: false, fBairros: true, fCalor: true, fAgua: true },
    janela: '24h',
  };
  let MUNS = [], STATE_POLYS = [], STATE_BBOX = null;
  const BYCODE = new Map();
  let STATIONS = [], FIRES = [], ALERTS = [], ACUDES = [], PLUV = [];
  // Pontos de extensão para módulos opcionais (js/fortaleza.js)
  const HOOKS = { refresh: [], detail: [], mesos: [] };
  const EXTRA_GROUPS = {};
  const ALERT_BY_MUN = new Map(), FIRE_BY_MUN = new Map();

  const SOURCES = {
    ibge: { org: 'IBGE', what: 'Malha e municípios', href: 'https://servicodados.ibge.gov.br/api/docs' },
    meteo: { org: 'Open-Meteo', what: 'Previsão por município', href: 'https://open-meteo.com' },
    acudes: { org: 'FUNCEME / COGERH', what: 'Volume dos açudes (via proxy)', href: 'http://www.hidro.ce.gov.br' },
    fortaleza: { org: 'Observatório de Fortaleza', what: 'Calor UTCI, canais e lagoas (via proxy)', href: 'https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/painel-de-calor' },
    bairros: { org: 'Prefeitura de Fortaleza', what: 'Bairros, IDH e população (dados abertos)', href: 'https://dados.fortaleza.ce.gov.br' },
    pluv: { org: 'CEMADEN', what: 'Pluviômetros (via proxy)', href: 'https://www.gov.br/cemaden' },
    inmetEst: { org: 'INMET', what: 'Estações meteorológicas', href: 'https://portal.inmet.gov.br' },
    inmetAv: { org: 'INMET', what: 'Avisos meteorológicos', href: 'https://alertas2.inmet.gov.br' },
    inmetPrev: { org: 'INMET', what: 'Previsão oficial (ao abrir município)', href: 'https://portal.inmet.gov.br' },
    inpe: { org: 'INPE', what: 'Focos de queimadas', href: 'https://terrabrasilis.dpi.inpe.br/queimadas/portal/' },
    marine: { org: 'Open-Meteo Marine', what: 'Ondas e mar no litoral', href: 'https://open-meteo.com/en/docs/marine-weather-api' },
    aq: { org: 'Open-Meteo / CAMS', what: 'Qualidade do ar (sob demanda)', href: 'https://open-meteo.com/en/docs/air-quality-api' },
    radar: { org: 'RainViewer', what: 'Radar de chuva (sob demanda)', href: 'https://www.rainviewer.com/api.html' },
  };
  function setSource(k, st, info = '') { SOURCES[k].st = st; SOURCES[k].info = info; renderSources(); }
  function renderSources() {
    $('#sources').innerHTML = Object.values(SOURCES).map((s) =>
      `<li><span class="sdot ${s.st || ''}"></span><div><a href="${s.href}" target="_blank" rel="noopener">${s.org}</a> · ${s.what}<small>${
        s.st === 'loading' ? 'carregando…' : s.st === 'err' ? 'indisponível agora' : esc(s.info || (s.st ? '' : 'aguardando'))}</small></div></li>`).join('');
  }

  // ------------------------------------------------------------ Valores
  function value(m, k = state.v, h = state.hour) {
    if (VARS[k].src === 'obs') return m.obs ? m.obs[state.janela] : null; // medido: não depende da hora da previsão
    const src = VARS[k].src === 'aq' ? m.aq : m.h;
    if (!src) return null;
    const cur = VARS[k].src === 'aq' ? m.aqc : m.c;
    if (h === 0 && cur && VARS[k].current && cur[VARS[k].current] != null) return cur[VARS[k].current];
    const v = src[k] && src[k][h];
    return v == null ? null : v;
  }
  function windAt(m, h = state.hour) {
    if (!m.h) return null;
    const ws = h === 0 ? m.c.wind_speed_10m : m.h.wind[h];
    const wd = h === 0 ? m.c.wind_direction_10m : m.h.wd[h];
    if (ws == null || wd == null) return null;
    const r = wd * Math.PI / 180;
    return { ws, wd, u: -ws * Math.sin(r), v: -ws * Math.cos(r) };
  }
  const WMO = {
    0: ['Céu limpo', '☀️', '🌙'], 1: ['Predominantemente limpo', '🌤️', '🌙'], 2: ['Parcialmente nublado', '⛅', '☁️'], 3: ['Nublado', '☁️'],
    45: ['Nevoeiro', '🌫️'], 48: ['Nevoeiro', '🌫️'], 51: ['Garoa fraca', '🌦️'], 53: ['Garoa', '🌦️'], 55: ['Garoa intensa', '🌧️'],
    61: ['Chuva fraca', '🌦️'], 63: ['Chuva moderada', '🌧️'], 65: ['Chuva forte', '🌧️'],
    80: ['Pancadas de chuva', '🌦️'], 81: ['Pancadas de chuva', '🌧️'], 82: ['Pancadas fortes', '⛈️'],
    95: ['Trovoadas', '⛈️'], 96: ['Trovoadas com granizo', '⛈️'], 99: ['Trovoadas com granizo', '⛈️'],
  };
  const wmo = (code, isDay = 1) => { const w = WMO[code] || ['—', '🌡️']; return { text: w[0], icon: !isDay && w[2] ? w[2] : w[1] }; };
  const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const cardinal = (deg) => CARD[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // ------------------------------------------------------------ Mapa
  const map = L.map('map', {
    zoomControl: false, minZoom: 6, maxZoom: 13, zoomSnap: 0.25,
    maxBounds: L.latLngBounds(BOUNDS).pad(0.7), maxBoundsViscosity: 0.7,
  }).setView([-5.2, -39.3], 7);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const PANES = { choro: 380, radar: 385, mask: 390, alerts: 395, windfx: 405, labels: 420, fires: 590, acudes: 595 };
  for (const [p, z] of Object.entries(PANES)) {
    map.createPane(p).style.zIndex = z;
    if (!['choro', 'fires', 'acudes'].includes(p)) map.getPane(p).style.pointerEvents = 'none';
  }
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
  // Após um "voo" de zoom o Leaflet às vezes mantém tiles do nível anterior por baixo;
  // em camadas de rótulos transparentes isso duplica os textos. Remove o nível antigo ao terminar de carregar.
  const dropStaleLevels = (layer) => layer.on('load', () => {
    for (const key in layer._tiles) if (layer._tiles[key].coords.z !== layer._tileZoom) layer._removeTile(key);
  });
  dropStaleLevels(L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxNativeZoom: 16,
    attribution: 'Base © Esri · Malhas IBGE · Dados Open-Meteo, INMET, INPE, RainViewer',
  }).addTo(map));
  dropStaleLevels(L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, pane: 'labels', opacity: 0.9 }).addTo(map));

  const fitPad = () => (innerWidth > 860
    ? { paddingTopLeft: [330, 90], paddingBottomRight: [state.selected ? 420 : 30, 100] }
    : { paddingTopLeft: [10, 70], paddingBottomRight: [10, 90] });
  const fitCeara = (animate = false) => { map.invalidateSize(); map.fitBounds(BOUNDS, { ...fitPad(), animate }); };

  // ------------------------------------------------------------ Camadas base
  let choroLayer = null;
  function buildBaseLayers(ufGeo) {
    const holes = STATE_POLYS.map((p) => p[0].map(([x, y]) => [y, x]));
    L.polygon([[[-89, -179], [-89, 179], [89, 179], [89, -179]], ...holes], {
      pane: 'mask', stroke: false, fillColor: '#070b17', fillOpacity: 0.62, interactive: false,
    }).addTo(map);
    L.geoJSON(ufGeo, { pane: 'mask', interactive: false, style: { color: '#5eead4', weight: 7, opacity: 0.14, fill: false } }).addTo(map);
    L.geoJSON(ufGeo, { pane: 'mask', interactive: false, style: { color: '#5eead4', weight: 1.6, opacity: 0.9, fill: false } }).addTo(map);

    choroLayer = L.geoJSON({ type: 'FeatureCollection', features: MUNS.map((m) => m.feature) }, {
      pane: 'choro',
      style: (f) => styleFor(BYCODE.get(f.properties.codarea)),
      onEachFeature: (f, layer) => {
        const m = BYCODE.get(f.properties.codarea);
        m.layer = layer; layer._mun = m;
        layer.bindTooltip(() => tipHtml(m), { sticky: true, direction: 'top', offset: [0, -8], opacity: 1 });
        layer.on('mouseover', () => { layer.setStyle({ weight: 2, color: '#ffffff' }); layer.bringToFront(); });
        layer.on('mouseout', () => layer.setStyle(styleFor(m)));
        layer.on('click', () => openDetail(munPlace(m)));
      },
    }).addTo(map);
  }
  function styleFor(m) {
    const v = state.ready ? value(m) : null;
    const sel = state.selected && state.selected.code === m.code;
    const dim = state.meso && m.meso !== state.meso;
    const base = state.layers.choro ? (state.layers.radar ? 0.32 : 0.74) : 0;
    return {
      fillColor: v == null ? '#2a3350' : shade(v),
      fillOpacity: base * (dim ? 0.3 : 1),
      color: sel ? '#ffffff' : 'rgba(11,16,32,0.85)',
      weight: sel ? 2.6 : 0.6,
    };
  }
  function restyle() {
    if (!choroLayer) return;
    choroLayer.eachLayer((l) => l.setStyle(styleFor(l._mun)));
    const sel = state.selected && state.selected.code && BYCODE.get(state.selected.code);
    if (sel && sel.layer) sel.layer.bringToFront();
  }
  function tipHtml(m) {
    const v = state.ready ? value(m) : null;
    const nA = (ALERT_BY_MUN.get(m.code) || []).length, nF = FIRE_BY_MUN.get(m.code) || 0;
    return `<b>${esc(m.name)}</b> <small>${esc(m.meso)}</small><br>
      <span style="color:${v == null ? '#fff' : shade(v)};font-weight:700;font-size:15px">${fmt(state.v, v, true)}</span> <small>${VARS[state.v].label}</small>
      ${nA ? `<br><small>⚠️ ${nA} aviso(s) do INMET</small>` : ''}${nF ? `<br><small>🔥 ${nF} foco(s) de calor (48h)</small>` : ''}`;
  }

  // ------------------------------------------------------------ IBGE
  async function loadBase() {
    setSource('ibge', 'loading');
    const [uf, mun, nomes] = await Promise.all([j(URLS.ibgeUF), j(URLS.ibgeMun), j(URLS.ibgeNomes)]);
    const info = new Map(nomes.map((n) => [String(n.id), n]));
    STATE_POLYS = uf.features.flatMap((f) => polysOf(f.geometry));
    STATE_BBOX = bboxOf(STATE_POLYS);
    MUNS = mun.features.map((f) => {
      const code = String(f.properties.codarea);
      const n = info.get(code);
      const polys = polysOf(f.geometry);
      const bbox = bboxOf(polys);
      const [lon, lat] = labelPoint(polys, bbox);
      const meso = n?.microrregiao?.mesorregiao?.nome || n?.['regiao-imediata']?.['regiao-intermediaria']?.nome || '—';
      const micro = n?.microrregiao?.nome || n?.['regiao-imediata']?.nome || '';
      return { code, name: n?.nome || code, meso, micro, feature: f, polys, bbox, lat, lon };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    MUNS.forEach((m) => BYCODE.set(m.code, m));
    setSource('ibge', 'ok', `${MUNS.length} municípios`);
    return uf;
  }
  const munAt = (lat, lon) => MUNS.find((m) => inBox(m.bbox, lon, lat) && inPolys(lon, lat, m.polys)) || null;
  const munPlace = (m) => ({ kind: 'mun', code: m.code, name: m.name, sub: `${m.meso} · ${m.micro}`, lat: m.lat, lon: m.lon });

  // ------------------------------------------------------------ Open-Meteo (municípios)
  function multiParams(extra) {
    return new URLSearchParams({
      latitude: MUNS.map((m) => m.lat.toFixed(4)).join(','),
      longitude: MUNS.map((m) => m.lon.toFixed(4)).join(','),
      timezone: TZ, forecast_days: '3', ...extra,
    });
  }
  // A previsão dos 184 municípios conta como 184 chamadas na cota gratuita da Open-Meteo.
  // Guardar o resultado por 15 min no navegador evita gastar a cota a cada recarga da página.
  const CACHE_METEO = 'atmos-meteo-v1', CACHE_MS = 15 * 60 * 1000;
  function lerCacheMeteo(chave) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_METEO) || 'null');
      if (c && c.chave === chave && Date.now() - c.t < CACHE_MS && c.muns.length === MUNS.length) return c;
    } catch { /* armazenamento indisponível */ }
    return null;
  }
  function gravarCacheMeteo(chave) {
    try {
      localStorage.setItem(CACHE_METEO, JSON.stringify({ chave, t: Date.now(), muns: MUNS.map((m) => ({ c: m.c, h: m.h })) }));
    } catch { /* cota cheia ou armazenamento bloqueado: segue sem cache */ }
  }
  async function loadMeteo(forcar = false) {
    setSource('meteo', 'loading');
    const keys = Object.entries(VARS).filter(([, v]) => v.src === 'meteo');
    const hourly = [...new Set([...keys.map(([, v]) => v.hourly), 'wind_direction_10m', 'weather_code'])];
    const chave = hourly.join(',');
    const cache = !forcar && lerCacheMeteo(chave);
    if (cache) {
      cache.muns.forEach((x, i) => { MUNS[i].c = x.c; MUNS[i].h = x.h; });
      state.updatedAt = new Date(cache.t);
      setSource('meteo', 'ok', `${MUNS.length} pontos · ${hhmm(state.updatedAt)} (cache local)`);
      return;
    }
    let data = await j(`${URLS.meteo}?${multiParams({
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      hourly: hourly.join(','),
    })}`);
    if (!Array.isArray(data)) data = [data];
    data.forEach((d, i) => {
      const m = MUNS[i], H = d.hourly;
      let idx = H.time.findIndex((t) => t.slice(0, 13) === d.current.time.slice(0, 13));
      if (idx < 0) idx = 0;
      const sl = (a) => a.slice(idx, idx + HOURS);
      m.c = d.current;
      m.h = { time: sl(H.time), wd: sl(H.wind_direction_10m), code: sl(H.weather_code) };
      for (const [k, v] of keys) m.h[k] = sl(H[v.hourly]);
    });
    state.updatedAt = new Date();
    gravarCacheMeteo(chave);
    setSource('meteo', 'ok', `${data.length} pontos · ${hhmm(state.updatedAt)}`);
  }
  let aqPromise = null;
  function ensureAQ() {
    if (aqPromise) return aqPromise;
    setSource('aq', 'loading');
    aqPromise = j(`${URLS.aq}?${multiParams({ hourly: 'pm2_5', current: 'pm2_5' })}`)
      .then((data) => {
        if (!Array.isArray(data)) data = [data];
        data.forEach((d, i) => {
          const m = MUNS[i];
          let idx = d.hourly.time.indexOf(m.h ? m.h.time[0] : '');
          if (idx < 0) idx = d.hourly.time.findIndex((t) => t.slice(0, 13) === d.current.time.slice(0, 13));
          m.aqc = d.current;
          m.aq = { pm25: d.hourly.pm2_5.slice(Math.max(idx, 0), Math.max(idx, 0) + HOURS) };
        });
        setSource('aq', 'ok', `${data.length} municípios`);
      })
      .catch((e) => { aqPromise = null; setSource('aq', 'err'); throw e; });
    return aqPromise;
  }

  // ------------------------------------------------------------ INMET: estações
  const stationLayer = L.layerGroup();
  async function loadStations() {
    setSource('inmetEst', 'loading');
    const res = await Promise.allSettled([j(URLS.inmetEst + 'T'), j(URLS.inmetEst + 'M')]);
    const all = res.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value || []);
    if (!all.length) throw new Error('INMET sem resposta');
    STATIONS = all.filter((e) => e.SG_ESTADO === 'CE').map((e) => ({
      code: e.CD_ESTACAO, name: titleCase(e.DC_NOME), type: e.TP_ESTACAO, status: e.CD_SITUACAO,
      lat: +e.VL_LATITUDE, lon: +e.VL_LONGITUDE, alt: +e.VL_ALTITUDE, since: (e.DT_INICIO_OPERACAO || '').slice(0, 10),
    }));
    stationLayer.clearLayers();
    for (const s of STATIONS) {
      const ok = s.status === 'Operante';
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: '', html: `<div class="st ${ok ? 'ok' : 'off'} ${s.type === 'Automatica' ? '' : 'conv'}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
        riseOnHover: true,
      })
        .bindTooltip(`<b>${esc(s.name)}</b> <small>${s.code}</small><br><small>Estação ${s.type === 'Automatica' ? 'automática' : 'convencional'} · ${esc(s.status)}</small>`, { direction: 'top', offset: [0, -8] })
        .on('click', () => openDetail({ kind: 'station', station: s, name: `Estação ${s.name}`, sub: `INMET ${s.code}`, lat: s.lat, lon: s.lon }))
        .addTo(stationLayer);
    }
    if (state.layers.stations) stationLayer.addTo(map);
    const op = STATIONS.filter((s) => s.status === 'Operante').length;
    setSource('inmetEst', 'ok', `${STATIONS.length} no CE · ${op} operantes`);
  }

  // ------------------------------------------------------------ INMET: avisos
  const alertLayer = L.layerGroup();
  const SEV = { 'Perigo Potencial': 1, 'Perigo': 2, 'Grande Perigo': 3 };
  async function loadAlerts() {
    setSource('inmetAv', 'loading');
    const d = await j(URLS.inmetAvisos);
    const seen = new Set();
    const tag = (list, future) => (list || []).map((a) => ({ ...a, _future: future }));
    ALERTS = [...tag(d?.hoje, false), ...tag(d?.futuro, true)]
      .filter((a) => {
        const key = a.id_aviso + '-' + a.id_sequencia;
        if (seen.has(key)) return false;
        seen.add(key);
        return (a.geocodes || '').split(',').some((g) => g.startsWith('23'));
      })
      .map((a) => ({
        id: a.id, desc: a.descricao, sev: a.severidade, cor: a.aviso_cor || '#FFFE00', ini: a.inicio, fim: a.fim,
        riscos: a.riscos, instr: a.instrucoes, future: a._future,
        codes: a.geocodes.split(',').map((g) => g.trim()).filter((g) => g.startsWith('23') && BYCODE.has(g)),
      }))
      .sort((a, b) => (SEV[b.sev] || 0) - (SEV[a.sev] || 0));
    ALERT_BY_MUN.clear();
    for (const a of ALERTS) for (const c of a.codes) { if (!ALERT_BY_MUN.has(c)) ALERT_BY_MUN.set(c, []); ALERT_BY_MUN.get(c).push(a); }
    alertLayer.clearLayers();
    for (const [code, list] of ALERT_BY_MUN) {
      const top = list[0];
      L.geoJSON(BYCODE.get(code).feature, {
        pane: 'alerts', interactive: false,
        style: { color: top.cor, weight: 2, dashArray: '5 4', fillColor: top.cor, fillOpacity: 0.1, opacity: 0.95 },
      }).addTo(alertLayer);
    }
    if (state.layers.alerts) alertLayer.addTo(map);
    renderAlerts();
    setSource('inmetAv', 'ok', ALERTS.length ? `${ALERTS.length} aviso(s) · ${ALERT_BY_MUN.size} municípios` : 'nenhum aviso ativo no CE');
  }
  const fmtAlertTime = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '');
  function alertCard(a, i) {
    return `<button class="alert" data-i="${i}" style="--ac:${esc(a.cor)}">
      <b>${esc(a.desc)}</b><span class="sev">${esc(a.sev)}${a.future ? ' · futuro' : ''}</span>
      <small>${fmtAlertTime(a.ini)} → ${fmtAlertTime(a.fim)} · ${a.codes.length} municípios</small></button>`;
  }
  function renderAlerts() {
    $('#alertsCount').textContent = ALERTS.length ? `${ALERTS.length} ativo(s)` : '';
    $('#alerts').innerHTML = ALERTS.length ? ALERTS.map(alertCard).join('') : '<p class="muted">Nenhum aviso ativo para o Ceará agora. ✅</p>';
  }
  $('#alerts').addEventListener('click', (e) => {
    const b = e.target.closest('.alert'); if (!b) return;
    const a = ALERTS[+b.dataset.i];
    const bounds = L.latLngBounds(a.codes.flatMap((c) => { const bb = BYCODE.get(c).bbox; return [[bb[1], bb[0]], [bb[3], bb[2]]]; }));
    if (!state.layers.alerts) toggleLayer('alerts', true);
    map.flyToBounds(bounds, { ...fitPad(), duration: 1, maxZoom: 9 });
    toast(a.riscos ? a.riscos.slice(0, 160) : a.desc);
  });

  // ------------------------------------------------------------ INPE: queimadas
  const fireRenderer = L.canvas({ pane: 'fires', padding: 0.3 });
  const fireLayer = L.layerGroup();
  async function loadFires() {
    setSource('inpe', 'loading');
    const days = [0, 1].map((d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10).replaceAll('-', ''));
    const res = await Promise.allSettled(days.map((d) => j(`${URLS.inpe}${d}.csv`, { text: true })));
    const texts = res.filter((r) => r.status === 'fulfilled').map((r) => r.value || '');
    if (!texts.length) throw new Error('INPE sem resposta');
    const seen = new Set();
    FIRES = [];
    for (const txt of texts) {
      const lines = txt.split('\n');
      const hd = lines[0].split(',').map((s) => s.trim());
      const ix = Object.fromEntries(hd.map((h, i) => [h, i]));
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (c.length < hd.length || !/^CEAR/.test(c[ix.estado])) continue;
        const id = c[ix.id];
        if (seen.has(id)) continue;
        seen.add(id);
        const num = (k) => (c[ix[k]] === '' || c[ix[k]] == null ? null : +c[ix[k]]);
        FIRES.push({
          lat: +c[ix.lat], lon: +c[ix.lon], time: c[ix.data_hora_gmt], sat: c[ix.satelite], mun: titleCase(c[ix.municipio] || ''),
          munId: c[ix.municipio_id], dias: num('numero_dias_sem_chuva'), risco: num('risco_fogo'), frp: num('frp'), bioma: c[ix.bioma],
        });
      }
    }
    FIRE_BY_MUN.clear();
    fireLayer.clearLayers();
    for (const f of FIRES) {
      FIRE_BY_MUN.set(f.munId, (FIRE_BY_MUN.get(f.munId) || 0) + 1);
      const r = 2.5 + Math.min(4, Math.sqrt(f.frp || 1) / 2);
      const utc = new Date(f.time.replace(' ', 'T') + 'Z');
      L.circleMarker([f.lat, f.lon], { renderer: fireRenderer, radius: r, color: '#ffd166', weight: 1, fillColor: '#ff5a1f', fillOpacity: 0.85 })
        .bindPopup(`<div class="pp"><b>🔥 Foco de calor</b><p>${esc(f.mun)} · ${utc.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<br>
          Satélite ${esc(f.sat)} · bioma ${esc(f.bioma || '—')}<br>
          ${f.dias != null ? `${f.dias} dias sem chuva · ` : ''}${f.risco != null ? `risco de fogo ${Math.round(f.risco * 100)}%` : ''}${f.frp != null ? ` · FRP ${f.frp} MW` : ''}</p></div>`)
        .addTo(fireLayer);
    }
    if (state.layers.fires) fireLayer.addTo(map);
    setSource('inpe', 'ok', `${FIRES.length} focos no CE (hoje + ontem)`);
  }

  // ------------------------------------------------------------ Litoral (marinho)
  const coastLayer = L.layerGroup();
  async function loadCoast() {
    setSource('marine', 'loading');
    let data = await j(`${URLS.marine}?${new URLSearchParams({
      latitude: COAST.map((p) => p.lat).join(','), longitude: COAST.map((p) => p.lon).join(','),
      current: 'wave_height,wave_direction,wave_period,sea_surface_temperature', timezone: TZ,
    })}`);
    if (!Array.isArray(data)) data = [data];
    coastLayer.clearLayers();
    let n = 0;
    coastMarkers = [];
    data.forEach((d, i) => {
      const p = COAST[i], c = d.current || {};
      if (c.wave_height == null) return;
      n++;
      const mk = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: '', html: `<div class="wave">🌊 ${c.wave_height.toFixed(1)} m</div>`, iconSize: [64, 22], iconAnchor: [32, 11] }),
      })
        .bindPopup(`<div class="pp"><b>🌊 ${esc(p.name)}</b><p>Altura das ondas: <b style="font-size:13px">${c.wave_height.toFixed(1)} m</b><br>
          Período: ${c.wave_period != null ? c.wave_period.toFixed(0) + ' s' : '—'} · de ${c.wave_direction != null ? cardinal(c.wave_direction) : '—'}<br>
          Temperatura do mar: ${c.sea_surface_temperature != null ? c.sea_surface_temperature.toFixed(1) + ' °C' : '—'}</p></div>`)
        .addTo(coastLayer);
      coastMarkers.push(mk);
    });
    if (state.layers.coast) coastLayer.addTo(map);
    layoutCoast();
    setSource('marine', 'ok', `${n} pontos no litoral`);
  }
  // Esconde etiquetas de ondas que se sobrepõem no zoom atual (reaparecem ao aproximar).
  let coastMarkers = [];
  function layoutCoast() {
    const boxes = [];
    for (const mk of coastMarkers) {
      const p = map.latLngToContainerPoint(mk.getLatLng());
      const box = [p.x - 34, p.y - 12, p.x + 34, p.y + 12];
      const hit = boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (!hit) boxes.push(box);
      mk.setOpacity(hit ? 0 : 1);
      const el = mk.getElement();
      if (el) el.style.pointerEvents = hit ? 'none' : '';
    }
  }
  map.on('zoomend', layoutCoast);

  // ------------------------------------------------------------ Proxy: açudes (FUNCEME/COGERH) e pluviômetros (CEMADEN)
  /** Busca um conjunto do proxy, tentando cada base de PROXY em ordem (Netlify Function → JSON do GitHub Actions). */
  async function viaProxy(nome) {
    let ultimoErro;
    for (const base of PROXY) {
      const url = base.startsWith('data') ? `${base}${nome}.json` : `${base}${nome}`;
      try {
        const d = await j(url, { timeout: 30000 });
        if (d && Array.isArray(d.itens)) return { ...d, via: base.startsWith('data') ? 'arquivo do GitHub Actions' : 'proxy' };
        ultimoErro = new Error(d && d.erro ? d.erro : 'resposta inválida');
      } catch (e) { ultimoErro = e; }
    }
    throw ultimoErro;
  }
  const idade = (iso) => {
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    return min < 2 ? 'agora' : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
  };

  async function loadPluv() {
    setSource('pluv', 'loading');
    const d = await viaProxy('pluviometros');
    PLUV = d.itens;
    for (const m of MUNS) { m.pluv = null; m.obs = null; }
    for (const p of PLUV) {
      const m = BYCODE.get(p.codibge);
      if (!m) continue;
      (m.pluv = m.pluv || []).push(p);
    }
    // Valor do município = maior acumulado entre seus pluviômetros (ressalta chuvas localizadas).
    for (const m of MUNS) {
      if (!m.pluv) continue;
      m.obs = {};
      for (const jn of Object.keys(m.pluv[0].acc)) {
        const vals = m.pluv.map((p) => p.acc[jn]).filter((v) => v != null);
        m.obs[jn] = vals.length ? Math.max(...vals) : null;
      }
    }
    const nMun = MUNS.filter((m) => m.pluv).length;
    setSource('pluv', 'ok', `${PLUV.length} pluviômetros em ${nMun} municípios · ${idade(d.coletado)}`);
    if (state.v === 'obs') refreshView();
  }

  const acudeLayer = L.layerGroup();
  const ACUDE_MK = new Map();
  async function loadAcudes() {
    setSource('acudes', 'loading');
    const d = await viaProxy('acudes');
    ACUDES = d.itens.filter((a) => a.lat != null && a.lon != null);
    acudeLayer.clearLayers();
    ACUDE_MK.clear();
    for (const a of [...ACUDES].sort((x, y) => (y.capacidade || 0) - (x.capacidade || 0))) {
      // Ícone de "mini-reservatório": tamanho pela capacidade, nível e cor pelo % do volume.
      const s = Math.round(11 + Math.min(17, Math.sqrt(a.capacidade || 1) / 4.5));
      const c = a.perc == null ? '#64748b' : color('_acude', a.perc);
      const lvl = a.perc == null ? 0 : clamp(a.perc, 4, 100);
      const mk = L.marker([a.lat, a.lon], {
        pane: 'acudes', riseOnHover: true,
        icon: L.divIcon({
          className: '', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
          html: `<div class="acmk${a.sangrando ? ' sangra' : ''}" style="width:${s}px;height:${s}px"><i style="height:${lvl}%;background:${c}"></i></div>`,
        }),
      })
        .bindTooltip(`<b>${esc(a.nome)}</b> <small>${esc(a.municipio)}</small><br><span style="color:${c};font-weight:700">${a.perc != null ? a.perc.toFixed(1) + '%' : '—'}</span> <small>${a.sangrando ? '· sangrando 🌊' : 'do volume'}</small>`, { direction: 'top', offset: [0, -s / 2] })
        .bindPopup(() => acudePopup(a), { maxWidth: 280 })
        .addTo(acudeLayer);
      ACUDE_MK.set(a.id, mk);
    }
    if (state.layers.acudes) acudeLayer.addTo(map);
    renderAcudes();
    setSource('acudes', 'ok', `${ACUDES.length} açudes · ${idade(d.coletado)}`);
  }
  function acudePopup(a) {
    const c = a.perc == null ? '#64748b' : color('_acude', a.perc);
    const p = a.perc == null ? 0 : clamp(a.perc, 0, 100);
    const dt = a.data ? a.data.split('-').reverse().join('/') : '—';
    return `<div class="pp acude-pp"><b>💧 ${esc(a.nome)}</b>
      <p>${esc(a.municipio)} · ${esc(a.rio || '')}<br>Região hidrográfica: ${esc(a.regiao || '—')}</p>
      <div class="tank"><i style="height:${p}%;background:${c}"></i><span>${a.perc != null ? a.perc.toFixed(1) + '%' : '—'}</span></div>
      <p><b style="font-size:13px">${a.volume != null ? a.volume.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'} hm³</b> de ${a.capacidade != null ? a.capacidade.toLocaleString('pt-BR') : '—'} hm³<br>
      ${a.sangrando ? '<b style="color:#7dd3fc;font-size:12px">🌊 Sangrando</b><br>' : ''}
      Cota ${a.cota ?? '—'} m · sangria a ${a.cotaSangria ?? '—'} m${a.vazao != null ? `<br>Vazão liberada ${a.vazao.toLocaleString('pt-BR')} L/s` : ''}<br>
      <small>Medição de ${dt} · FUNCEME/COGERH${a.ano ? ` · construído em ${a.ano}` : ''}</small></p></div>`;
  }
  function renderAcudes() {
    const el = $('#acudes');
    if (!ACUDES.length) { el.innerHTML = '<p class="muted">Sem dados de açudes no momento.</p>'; return; }
    const cap = ACUDES.reduce((s, a) => s + (a.capacidade || 0), 0);
    const vol = ACUDES.reduce((s, a) => s + (a.volume || 0), 0);
    const tot = (vol / cap) * 100;
    const sangra = ACUDES.filter((a) => a.sangrando).length;
    const criticos = ACUDES.filter((a) => a.perc != null && a.perc < 10).length;
    const grandes = [...ACUDES].sort((x, y) => (y.capacidade || 0) - (x.capacidade || 0)).slice(0, 5);
    el.innerHTML = `
      <div class="res-total"><div class="tank big"><i style="height:${clamp(tot, 0, 100)}%;background:${color('_acude', tot)}"></i></div>
        <div><b style="color:${color('_acude', tot)}">${tot.toFixed(1)}%</b><span>armazenado no estado</span>
        <small>${vol.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} de ${cap.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} hm³ · ${ACUDES.length} açudes</small>
        <small>🌊 ${sangra} sangrando · 🔴 ${criticos} abaixo de 10%</small></div></div>
      <ol class="res-list">${grandes.map((a) => `<li data-id="${a.id}"><span class="nm">${esc(a.nome)}</span><span class="bar"><i style="width:${clamp(a.perc || 0, 0, 100)}%;background:${color('_acude', a.perc || 0)}"></i></span><b>${a.perc != null ? a.perc.toFixed(0) + '%' : '—'}</b></li>`).join('')}</ol>`;
  }
  function focusAcude(a) {
    if (!state.layers.acudes) toggleLayer('acudes', true);
    map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 10), { duration: 1 });
    setTimeout(() => ACUDE_MK.get(a.id)?.openPopup(), 1150);
  }
  $('#acudes').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    focusAcude(ACUDES.find((x) => String(x.id) === li.dataset.id));
  });

  // ------------------------------------------------------------ Radar (RainViewer)
  const radar = { frames: [], layers: [], i: 0, timer: null };
  async function startRadar() {
    setSource('radar', 'loading');
    try {
      const d = await j(URLS.rainviewer);
      const past = d.radar?.past || [], now = d.radar?.nowcast || [];
      radar.frames = [...past.map((f) => ({ ...f, fc: false })), ...now.map((f) => ({ ...f, fc: true }))];
      if (!radar.frames.length) throw new Error('sem quadros');
      radar.layers = radar.frames.map((f) => L.tileLayer(`${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        pane: 'radar', opacity: 0, maxNativeZoom: 7, maxZoom: 13,
      }).addTo(map));
      radar.i = Math.max(0, past.length - 1);
      showRadarFrame();
      radar.timer = setInterval(() => { radar.i = (radar.i + 1) % radar.frames.length; showRadarFrame(); }, 700);
      setSource('radar', 'ok', `${radar.frames.length} quadros (últimas 2 h)`);
    } catch (e) {
      setSource('radar', 'err');
      toast('Radar indisponível no momento', true);
      toggleLayer('radar', false);
    }
  }
  function showRadarFrame() {
    radar.layers.forEach((l, i) => l.setOpacity(i === radar.i ? 0.8 : 0));
    const f = radar.frames[radar.i];
    const el = document.querySelector('[data-layer=radar] small');
    if (el && f) el.textContent = `${hhmm(new Date(f.time * 1000))}${f.fc ? ' (previsão)' : ''}`;
  }
  function stopRadar() {
    clearInterval(radar.timer);
    radar.layers.forEach((l) => l.remove());
    radar.layers = [];
    const el = document.querySelector('[data-layer=radar] small');
    if (el) el.textContent = 'RainViewer';
  }

  // ------------------------------------------------------------ Partículas de vento (recortadas no Ceará)
  const WIND_STEP = 12, WIND_SPEED = 0.06;
  const windCanvas = L.DomUtil.create('canvas', 'fx-canvas', map.getPane('windfx'));
  const wctx = windCanvas.getContext('2d');
  let W = null, particles = [];
  function placeCanvas(cv) {
    const s = map.getSize();
    if (cv.width !== s.x || cv.height !== s.y) { cv.width = s.x; cv.height = s.y; }
    cv.style.width = s.x + 'px'; cv.style.height = s.y + 'px';
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
  }
  let maskCache = null;
  function buildWind() {
    placeCanvas(windCanvas);
    wctx.clearRect(0, 0, windCanvas.width, windCanvas.height);
    windCanvas.classList.remove('fx-hidden');
    if (!state.ready) return;
    const s = map.getSize();
    const gw = Math.ceil(s.x / WIND_STEP), gh = Math.ceil(s.y / WIND_STEP), n = gw * gh;
    const key = `${gw}|${gh}|${map.getZoom()}|${map.getCenter().toString()}`;
    if (!maskCache || maskCache.key !== key) {
      const lat = new Float32Array(n), lon = new Float32Array(n), inside = new Uint8Array(n);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const ll = map.containerPointToLatLng([x * WIND_STEP + WIND_STEP / 2, y * WIND_STEP + WIND_STEP / 2]);
        lat[i] = ll.lat; lon[i] = ll.lng;
        inside[i] = inBox(STATE_BBOX, ll.lng, ll.lat) && inPolys(ll.lng, ll.lat, STATE_POLYS) ? 1 : 0;
      }
      maskCache = { key, lat, lon, inside };
    }
    const pts = MUNS.map((m) => { const w = windAt(m); return w && { lat: m.lat, lon: m.lon, u: w.u, v: w.v }; }).filter(Boolean);
    W = { gw, gh, u: new Float32Array(n), v: new Float32Array(n), m: maskCache.inside };
    for (let i = 0; i < n; i++) {
      if (!maskCache.inside[i]) continue;
      let nu = 0, nv = 0, den = 0;
      const la = maskCache.lat[i], lo = maskCache.lon[i], cl = Math.cos(la * Math.PI / 180);
      for (const p of pts) {
        const dx = (lo - p.lon) * 111.32 * cl, dy = (la - p.lat) * 110.57;
        const w = 1 / Math.max(dx * dx + dy * dy, 1);
        nu += w * p.u; nv += w * p.v; den += w;
      }
      W.u[i] = (nu / den) * WIND_SPEED; W.v[i] = (-nv / den) * WIND_SPEED;
    }
    const count = clamp(Math.round((s.x * s.y) / 600), 500, 3500);
    particles = Array.from({ length: count }, () => spawn({}));
  }
  function spawn(p) {
    p.x = Math.random() * windCanvas.width; p.y = Math.random() * windCanvas.height;
    p.age = 0; p.max = 40 + Math.random() * 80;
    return p;
  }
  function windFrame() {
    requestAnimationFrame(windFrame);
    if (!W || !state.layers.wind || document.hidden || windCanvas.classList.contains('fx-hidden')) return;
    const w = windCanvas.width, h = windCanvas.height;
    wctx.globalCompositeOperation = 'destination-in';
    wctx.fillStyle = 'rgba(0,0,0,0.93)';
    wctx.fillRect(0, 0, w, h);
    wctx.globalCompositeOperation = 'source-over';
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    for (const p of particles) {
      if (p.age++ > p.max) { spawn(p); continue; }
      const gx = (p.x / WIND_STEP) | 0, gy = (p.y / WIND_STEP) | 0;
      if (gx < 0 || gy < 0 || gx >= W.gw || gy >= W.gh) { spawn(p); continue; }
      const i = gy * W.gw + gx;
      if (!W.m[i]) { spawn(p); continue; }
      const u = W.u[i], v = W.v[i], sp = Math.abs(u) + Math.abs(v);
      const b = sp < 0.8 ? 0 : sp < 1.8 ? 1 : 2;
      paths[b].moveTo(p.x, p.y);
      p.x += u; p.y += v;
      paths[b].lineTo(p.x, p.y);
    }
    wctx.lineWidth = 1.2;
    wctx.lineCap = 'round';
    ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.9)'].forEach((c, i) => { wctx.strokeStyle = c; wctx.stroke(paths[i]); });
  }
  requestAnimationFrame(windFrame);
  map.on('zoomstart', () => windCanvas.classList.add('fx-hidden'));
  map.on('moveend', () => { buildWind(); renderRanking(); renderKpis(); saveHash(); });

  // ------------------------------------------------------------ Painel lateral
  function renderVarButtons() {
    $('#vars').innerHTML = Object.entries(VARS).map(([k, v]) =>
      `<button data-k="${k}" class="${k === state.v ? 'on' : ''}" title="${v.label}"><span>${v.icon}</span>${v.short}</button>`).join('');
  }
  $('#vars').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (VARS[k].src === 'aq') {
      b.classList.add('wait');
      try { await ensureAQ(); } catch { b.classList.remove('wait'); return toast('Qualidade do ar indisponível no momento', true); }
    }
    state.v = k;
    renderVarButtons(); renderLegend(); refreshView(); saveHash();
  });

  const LAYERS = [
    ['choro', 'Municípios (variável)', 'IBGE + Open-Meteo'],
    ['wind', 'Partículas de vento', 'Open-Meteo'],
    ['acudes', 'Açudes monitorados', 'FUNCEME / COGERH · proxy'],
    ['alerts', 'Avisos meteorológicos', 'INMET'],
    ['stations', 'Estações meteorológicas', 'INMET'],
    ['fires', 'Focos de queimadas', 'INPE · 48 h'],
    ['coast', 'Ondas no litoral', 'Open-Meteo Marine'],
    ['radar', 'Radar de chuva', 'RainViewer'],
    ['fBairros', 'Fortaleza · bairros', 'Prefeitura · IDH e população · zoom ≥ 10'],
    ['fCalor', 'Fortaleza · calor (UTCI)', 'Observatório · proxy · zoom ≥ 10'],
    ['fAgua', 'Fortaleza · canais e lagoas', 'Observatório · proxy · zoom ≥ 10'],
  ];
  $('#layers').innerHTML = LAYERS.map(([k, label, src]) =>
    `<label class="tg" data-layer="${k}"><input type="checkbox" ${state.layers[k] ? 'checked' : ''}><span></span><div>${label}<small>${src}</small></div></label>`).join('');
  $('#layers').addEventListener('change', (e) => {
    const lab = e.target.closest('[data-layer]');
    if (lab) toggleLayer(lab.dataset.layer, e.target.checked);
  });
  function toggleLayer(k, on) {
    state.layers[k] = on;
    const cb = document.querySelector(`[data-layer=${k}] input`);
    if (cb) cb.checked = on;
    const groups = { stations: stationLayer, fires: fireLayer, alerts: alertLayer, coast: coastLayer, acudes: acudeLayer, ...EXTRA_GROUPS };
    const g = groups[k];
    if (typeof g === 'function') g(on); // camadas de módulos (ex.: js/fortaleza.js) controlam a própria visibilidade
    else if (g) on ? g.addTo(map) : g.remove();
    if (k === 'wind' && !on) wctx.clearRect(0, 0, windCanvas.width, windCanvas.height);
    if (k === 'choro' || k === 'radar') restyle();
    if (k === 'radar') on ? startRadar() : stopRadar();
  }

  function renderMesos() {
    const mesos = [...new Set(MUNS.map((m) => m.meso))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('#mesos').innerHTML = [`<button data-m="" class="${!state.meso ? 'on' : ''}">Todo o Ceará</button>`,
      ...mesos.map((m) => `<button data-m="${esc(m)}" class="${state.meso === m ? 'on' : ''}">${esc(m.replace(' Cearense', '').replace('Metropolitana de ', 'RM '))}</button>`)].join('');
    HOOKS.mesos.forEach((fn) => fn($('#mesos')));
  }
  $('#mesos').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.m === undefined) return;
    state.meso = b.dataset.m || null;
    renderMesos(); restyle(); renderRanking(); renderKpis();
    if (!state.meso) return map.flyToBounds(BOUNDS, { ...fitPad(), duration: 1 });
    const list = MUNS.filter((m) => m.meso === state.meso);
    map.flyToBounds(L.latLngBounds(list.flatMap((m) => [[m.bbox[1], m.bbox[0]], [m.bbox[3], m.bbox[2]]])), { ...fitPad(), duration: 1 });
  });

  function renderLegend() {
    const v = VARS[state.v], s = v.scale;
    const lo = s[0][0], hi = s[s.length - 1][0];
    const grad = s.map(([x, c]) => `${c} ${(((x - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(',');
    const rel = state.rel && RANGE && RANGE.max > RANGE.min;
    const [a, b] = rel ? [RANGE.min, RANGE.max] : [lo, hi];
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => { const x = a + (b - a) * t; return `<span>${v.dec ? x.toFixed(1) : Math.round(x)}${v.unit}</span>`; }).join('');
    $('#legendTitle').textContent = `Escala · ${v.label}${v.full.trim() ? ' (' + v.full.trim() + ')' : ''}`;
    $('#legend').innerHTML = `<div class="legend-bar" style="background:linear-gradient(90deg,${grad})"></div><div class="legend-ticks">${ticks}</div>
      ${v.src === 'obs' ? `<div class="chips janelas">${['1h', '3h', '6h', '12h', '24h', '48h', '72h', '96h'].map((jn) => `<button data-j="${jn}" class="${jn === state.janela ? 'on' : ''}">${jn}</button>`).join('')}</div>
        <p class="muted" style="margin-top:6px">Maior acumulado entre os pluviômetros de cada município. Municípios sem pluviômetro ficam em cinza.</p>` : ''}
      <label class="tg mini"><input type="checkbox" id="relToggle" ${state.rel ? 'checked' : ''}><span></span><div>Contraste relativo<small>Estica as cores entre o mínimo e o máximo de agora</small></div></label>
      <div class="legend-key"><span><i class="ac"></i>Açude (cor = % do volume)</span><span><i class="st ok"></i>Estação operante</span><span><i class="st off"></i>Em pane</span><span><i class="fire"></i>Foco de calor</span><span><i class="dash"></i>Área com aviso</span></div>`;
  }

  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-j]'); if (!b) return;
    state.janela = b.dataset.j;
    renderLegend(); refreshView();
  });
  $('#legend').addEventListener('change', (e) => {
    if (e.target.id !== 'relToggle') return;
    state.rel = e.target.checked;
    refreshView();
  });

  function visibleMuns() {
    const b = map.getBounds();
    return MUNS.filter((m) => value(m) != null && b.contains([m.lat, m.lon]) && (!state.meso || m.meso === state.meso));
  }
  function renderRanking() {
    if (!state.ready) return;
    const list = visibleMuns().sort((a, b) => value(b) - value(a));
    if (!list.length) { $('#ranking').innerHTML = '<li class="empty">Nenhum município nesta área do mapa.</li>'; return; }
    const hi = value(list[0]), lo = value(list[list.length - 1]);
    $('#ranking').innerHTML = list.map((m, i) => {
      const v = value(m), w = hi === lo ? 100 : 12 + ((v - lo) / (hi - lo)) * 88;
      const badges = (ALERT_BY_MUN.has(m.code) ? '⚠️' : '') + (FIRE_BY_MUN.has(m.code) ? '🔥' : '');
      return `<li data-code="${m.code}" class="${state.selected?.code === m.code ? 'sel' : ''}"><span class="n">${i + 1}</span><span class="nm">${esc(m.name)}<em>${badges}</em></span><span class="bar"><i style="width:${w}%;background:${shade(v)}"></i></span><b>${fmt(state.v, v)}</b></li>`;
    }).join('');
  }
  $('#ranking').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-code]'); if (!li) return;
    focusMun(BYCODE.get(li.dataset.code));
  });
  function focusMun(m) {
    openDetail(munPlace(m));
    map.flyToBounds([[m.bbox[1], m.bbox[0]], [m.bbox[3], m.bbox[2]]], { ...fitPad(), maxZoom: 10, duration: 1 });
  }

  function renderKpis() {
    if (!state.ready) return;
    const list = visibleMuns();
    const k = state.v;
    let html = '';
    if (list.length) {
      const vals = list.map((m) => value(m));
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const max = list[vals.indexOf(Math.max(...vals))], min = list[vals.indexOf(Math.min(...vals))];
      html += `<div class="kpi" data-code="${max.code}"><small>Máxima</small><b style="color:${shade(value(max))}">${fmt(k, value(max))}</b><em>${esc(max.name)}</em></div>
        <div class="kpi" data-code="${min.code}"><small>Mínima</small><b style="color:${shade(value(min))}">${fmt(k, value(min))}</b><em>${esc(min.name)}</em></div>
        <div class="kpi"><small>Média</small><b>${fmt(k, avg)}</b><em>${list.length} mun.</em></div>`;
    }
    if (ACUDES.length) {
      const tot = (ACUDES.reduce((s, a) => s + (a.volume || 0), 0) / ACUDES.reduce((s, a) => s + (a.capacidade || 0), 0)) * 100;
      html += `<div class="kpi"><small>Açudes</small><b style="color:${color('_acude', tot)}">${tot.toFixed(0)}%</b><em>do volume</em></div>`;
    }
    html += `<div class="kpi"><small>Focos 48 h</small><b style="color:#ff8a3d">${SOURCES.inpe.st === 'ok' ? FIRES.length : '—'}</b><em>INPE</em></div>
      <div class="kpi"><small>Avisos</small><b style="color:${ALERTS[0] ? ALERTS[0].cor : 'inherit'}">${SOURCES.inmetAv.st === 'ok' ? ALERTS.length : '—'}</b><em>INMET</em></div>`;
    $('#kpis').innerHTML = html;
  }
  $('#kpis').addEventListener('click', (e) => { const el = e.target.closest('[data-code]'); if (el) focusMun(BYCODE.get(el.dataset.code)); });
  $('#sideToggle').addEventListener('click', () => { $('#side').classList.toggle('open'); if ($('#side').classList.contains('open')) closeDetail(); });

  // ------------------------------------------------------------ Linha do tempo
  const slider = $('#hour');
  const baseTime = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d; };
  const fmtHour = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
  function renderTimeline() {
    const h = state.hour;
    slider.value = h;
    slider.style.setProperty('--p', (h / (HOURS - 1)) * 100 + '%');
    const t = new Date(baseTime().getTime() + h * 3600e3);
    if (VARS[state.v].src === 'obs') {
      $('#tlLabel').textContent = `Medido · últimas ${state.janela} · CEMADEN${h ? ` (vento em +${h}h)` : ''}`;
      return;
    }
    $('#tlLabel').textContent = h === 0 ? `Agora · ${VARS[state.v].label}` : `+${h}h · ${fmtHour.format(t)} · ${VARS[state.v].label}`;
  }
  function renderTicks() {
    const b = baseTime(), out = [];
    for (let h = 0; h < HOURS; h++) {
      const t = new Date(b.getTime() + h * 3600e3);
      const hr = +t.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }) % 24;
      if (hr === 0 || hr === 12) {
        const lbl = hr === 0 ? t.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: TZ }) : '12h';
        out.push(`<span style="left:${(h / (HOURS - 1)) * 100}%">${lbl}</span>`);
      }
    }
    $('#ticks').innerHTML = out.join('');
  }
  function setHour(h) { state.hour = ((h % HOURS) + HOURS) % HOURS; refreshView(); }
  slider.addEventListener('input', () => setHour(+slider.value));
  let playTimer = null;
  function togglePlay(force) {
    state.playing = force ?? !state.playing;
    $('#play').classList.toggle('on', state.playing);
    clearInterval(playTimer);
    if (state.playing) playTimer = setInterval(() => setHour(state.hour + 1), 600);
  }
  $('#play').addEventListener('click', () => togglePlay());
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search]')) return;
    if (e.key === 'ArrowRight') { togglePlay(false); setHour(state.hour + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { togglePlay(false); setHour(state.hour - 1); e.preventDefault(); }
    else if (e.key === ' ' && !e.target.matches('button, input')) { togglePlay(); e.preventDefault(); }
    else if (e.key === 'Escape') closeDetail();
  });

  function refreshView() {
    if (!state.ready) return;
    computeRange();
    if (state.rel) renderLegend();
    restyle(); buildWind(); renderRanking(); renderKpis(); renderTimeline();
  }

  // ------------------------------------------------------------ Detalhe
  let chart = null, detailReq = 0, pin = null;
  function detailHead(p) {
    return `<div class="d-head"><div><h2>${esc(p.name)}</h2><p>${esc(p.sub || '')}${p.sub ? ' · ' : ''}${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}</p></div><button class="icon-btn d-close" aria-label="Fechar">×</button></div>`;
  }
  function closeDetail() {
    const panel = $('#detail');
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    state.selected = null;
    if (pin) { pin.remove(); pin = null; }
    restyle(); renderRanking(); saveHash();
  }
  function setPin(lat, lon) {
    if (pin) pin.remove();
    pin = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pulse-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
  }

  async function openDetail(place) {
    const mun = place.kind === 'mun' ? BYCODE.get(place.code) : munAt(place.lat, place.lon);
    state.selected = { ...place, code: mun ? mun.code : null };
    const req = ++detailReq;
    $('#side').classList.remove('open');
    const panel = $('#detail');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.innerHTML = `${detailHead(place)}<div class="skeleton" style="height:90px;margin:18px 0"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:190px;margin-top:20px"></div>`;
    panel.querySelector('.d-close').onclick = closeDetail;
    if (place.kind !== 'mun') setPin(place.lat, place.lon); else if (pin) { pin.remove(); pin = null; }
    restyle(); renderRanking(); saveHash();

    const meteoP = j(`${URLS.meteo}?${new URLSearchParams({
      latitude: place.lat, longitude: place.lon, timezone: TZ, forecast_days: '7',
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,is_day,cloud_cover',
      hourly: 'temperature_2m,precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset',
    })}`);
    const aqP = j(`${URLS.aq}?${new URLSearchParams({ latitude: place.lat, longitude: place.lon, current: 'pm2_5,pm10,us_aqi,dust', timezone: TZ })}`).catch(() => null);
    try {
      const [d, aq] = await Promise.all([meteoP, aqP]);
      if (req !== detailReq) return;
      renderDetail(place, mun, d, aq);
      if (mun) loadInmetPrev(mun, req);
    } catch {
      if (req !== detailReq) return;
      panel.innerHTML = `${detailHead(place)}<p class="d-src">Não foi possível carregar a previsão deste local. Tente novamente em instantes.</p>`;
      panel.querySelector('.d-close').onclick = closeDetail;
    }
  }

  const aqiLabel = (v) => (v == null ? ['—', '#93a0b8'] : v <= 50 ? ['Boa', '#3fae7a'] : v <= 100 ? ['Moderada', '#c9d34a'] : v <= 150 ? ['Ruim p/ sensíveis', '#f2a33a'] : v <= 200 ? ['Ruim', '#e8503a'] : ['Muito ruim', '#8f3fbf']);
  const unitSm = (u) => `<small class="u">${u}</small>`;

  function renderDetail(place, mun, d, aq) {
    const c = d.current, D = d.daily, H = d.hourly;
    const cond = wmo(c.weather_code, c.is_day);
    let idx = H.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13));
    if (idx < 0) idx = 0;
    const hours = H.time.slice(idx, idx + 48), temps = H.temperature_2m.slice(idx, idx + 48), pps = H.precipitation_probability.slice(idx, idx + 48);
    const wMin = Math.min(...D.temperature_2m_min), wMax = Math.max(...D.temperature_2m_max);
    const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
    const days = D.time.map((t, i) => {
      const mn = D.temperature_2m_min[i], mx = D.temperature_2m_max[i];
      const l = ((mn - wMin) / (wMax - wMin || 1)) * 100, w = ((mx - mn) / (wMax - wMin || 1)) * 100;
      const name = i === 0 ? 'Hoje' : dayFmt.format(new Date(t + 'T12:00:00Z')).replace('.', '');
      return `<div class="day" title="${wmo(D.weather_code[i]).text}"><span class="dn">${name}</span><span>${wmo(D.weather_code[i]).icon}</span><span class="mn">${Math.round(mn)}°</span>
        <span class="range"><i style="left:${l}%;width:${Math.max(w, 4)}%;background:linear-gradient(90deg,${color('temp', mn)},${color('temp', mx)})"></i></span>
        <b>${Math.round(mx)}°</b><span class="rain">${D.precipitation_probability_max[i] ?? 0}% · ${(D.precipitation_sum[i] ?? 0).toFixed(1)}</span></div>`;
    }).join('');
    const ac = aq && aq.current;
    const [aqTxt, aqCol] = aqiLabel(ac && ac.us_aqi);

    // Contexto vindo das outras bases
    const alerts = mun ? ALERT_BY_MUN.get(mun.code) || [] : [];
    const firesHere = mun ? FIRES.filter((f) => f.munId === mun.code) : [];
    const nearFire = FIRES.reduce((b, f) => { const k = km(place.lat, place.lon, f.lat, f.lon); return k < b.k ? { f, k } : b; }, { f: null, k: Infinity });
    const nearSt = STATIONS.reduce((b, s) => { const k = km(place.lat, place.lon, s.lat, s.lon); return k < b.k ? { s, k } : b; }, { s: null, k: Infinity });
    const st = place.kind === 'station' ? place.station : null;
    const pluvHere = mun && mun.pluv ? mun.pluv : [];
    const acHere = mun ? ACUDES.filter((a) => norm(a.municipio || '') === norm(mun.name)) : [];
    const nearAc = ACUDES.reduce((b, a) => { const k = km(place.lat, place.lon, a.lat, a.lon); return k < b.k ? { a, k } : b; }, { a: null, k: Infinity });
    const mm = (v) => (v == null ? '—' : v.toFixed(1));
    const pluvHtml = pluvHere.length
      ? `<table class="pluv"><thead><tr><th>Pluviômetro</th><th>1 h</th><th>24 h</th><th>72 h</th></tr></thead><tbody>${pluvHere.map((p) =>
        `<tr><td>${esc(p.nome)}<small>${p.dataHora ? new Date(p.dataHora).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : ''}</small></td><td>${mm(p.acc['1h'])}</td><td style="color:${p.acc['24h'] ? color('obs', p.acc['24h']) : 'inherit'}">${mm(p.acc['24h'])}</td><td>${mm(p.acc['72h'])}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">${SOURCES.pluv.st === 'ok' ? 'Nenhum pluviômetro do CEMADEN neste município.' : 'Pluviômetros indisponíveis no momento.'}</p>`;
    const acRow = (a, dist) => `<div class="ctx-row ac-row" data-ac="${a.id}"><span>💧</span><div><b>${esc(a.nome)}</b> · <b style="color:${color('_acude', a.perc ?? 0)}">${a.perc != null ? a.perc.toFixed(1) + '%' : '—'}</b>${a.sangrando ? ' 🌊' : ''}${dist != null ? ` <small style="display:inline">a ${Math.round(dist)} km</small>` : ''}
      <small>${a.volume != null ? a.volume.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'} de ${a.capacidade?.toLocaleString('pt-BR') ?? '—'} hm³ · ${esc(a.rio || a.regiao || '')}</small></div></div>`;
    const acHtml = acHere.length ? acHere.map((a) => acRow(a)).join('')
      : nearAc.a ? acRow(nearAc.a, nearAc.k) : `<p class="muted">${SOURCES.acudes.st === 'ok' ? 'Nenhum açude monitorado próximo.' : 'Dados de açudes indisponíveis no momento.'}</p>`;

    const panel = $('#detail');
    panel.innerHTML = `${detailHead(place)}
      ${st ? `<div class="d-badge ${st.status === 'Operante' ? 'ok' : 'off'}">Estação ${st.type === 'Automatica' ? 'automática' : 'convencional'} · ${esc(st.status)} · altitude ${Math.round(st.alt)} m · desde ${esc(st.since.split('-').reverse().join('/'))}</div>
        <p class="d-note">As leituras horárias das estações do INMET exigem cadastro na API oficial. Abaixo, a previsão de modelo para o local exato da estação.</p>` : ''}
      ${alerts.map((a) => `<details class="d-alert" style="--ac:${esc(a.cor)}"><summary><b>⚠️ ${esc(a.desc)}</b> <span>${esc(a.sev)} · ${fmtAlertTime(a.ini)} → ${fmtAlertTime(a.fim)}</span></summary>
        <p>${esc(a.riscos)}</p><p class="muted">${esc(a.instr)}</p></details>`).join('')}
      <div class="d-now">
        <div class="d-big" style="--c:${color('temp', c.temperature_2m)}">${Math.round(c.temperature_2m)}°</div>
        <div class="d-cond"><div class="ic">${cond.icon}</div><strong>${cond.text}</strong><div>Sensação de ${Math.round(c.apparent_temperature)}° · Hoje ${Math.round(D.temperature_2m_min[0])}° / ${Math.round(D.temperature_2m_max[0])}°</div></div>
      </div>
      <div class="d-grid">
        <div class="d-stat"><small>Umidade</small><b>${c.relative_humidity_2m}%</b></div>
        <div class="d-stat"><small>Vento</small><b><svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${c.wind_direction_10m + 180}deg)"><path d="M12 3l6 16-6-4-6 4z" fill="currentColor"/></svg>${Math.round(c.wind_speed_10m)}${unitSm('km/h ' + cardinal(c.wind_direction_10m))}</b></div>
        <div class="d-stat"><small>Rajadas</small><b>${Math.round(c.wind_gusts_10m)}${unitSm('km/h')}</b></div>
        <div class="d-stat"><small>Pressão</small><b>${Math.round(c.pressure_msl)}${unitSm('hPa')}</b></div>
        <div class="d-stat"><small>Nuvens</small><b>${c.cloud_cover}%</b></div>
        <div class="d-stat"><small>UV máx. hoje</small><b>${(D.uv_index_max[0] ?? 0).toFixed(0)}</b></div>
        <div class="d-stat wide"><small>Qualidade do ar · CAMS</small><b style="color:${aqCol}">${aqTxt}</b>${ac ? `<span class="aqd">AQI ${ac.us_aqi ?? '—'} · PM2.5 ${ac.pm2_5?.toFixed(0) ?? '—'} · PM10 ${ac.pm10?.toFixed(0) ?? '—'} · poeira ${ac.dust?.toFixed(0) ?? '—'} µg/m³</span>` : ''}</div>
      </div>
      <h3>Próximas 48 horas <span>temperatura · chance de chuva</span></h3>
      <div class="chart-box"><canvas id="dChart"></canvas></div>
      <h3>7 dias · modelo <span>mín · máx · chuva (mm)</span></h3>
      <div class="days">${days}</div>
      ${mun ? `<h3>Previsão oficial do INMET <span>${esc(mun.name)}</span></h3><div id="inmetPrev" class="prev"><div class="skeleton" style="height:120px"></div></div>` : ''}
      <div class="d-hook"></div>
      <h3>Chuva medida <span>CEMADEN · mm</span></h3>
      ${pluvHtml}
      <h3>${acHere.length ? 'Açudes no município' : 'Açude monitorado mais próximo'} <span>FUNCEME / COGERH</span></h3>
      <div class="ctx">${acHtml}</div>
      <h3>Contexto local</h3>
      <div class="ctx">
        <div class="ctx-row"><span>🔥</span><div><b>${firesHere.length} foco(s) de calor</b> no município nas últimas 48 h<small>${nearFire.f ? `Foco mais próximo a ${Math.round(nearFire.k)} km (${esc(nearFire.f.mun)})` : 'Nenhum foco detectado no Ceará'} · INPE</small></div></div>
        ${nearSt.s ? `<div class="ctx-row"><span>📡</span><div><b>Estação ${esc(nearSt.s.name)}</b> a ${Math.round(nearSt.k)} km<small>INMET ${nearSt.s.code} · ${esc(nearSt.s.status)}</small></div></div>` : ''}
        <div class="ctx-row"><span>🌅</span><div><b>${(D.sunrise[0] || '').slice(11, 16)} – ${(D.sunset[0] || '').slice(11, 16)}</b> nascer e pôr do sol<small>Elevação do terreno ${Math.round(d.elevation)} m</small></div></div>
      </div>
      <p class="d-src">Previsão: Open-Meteo · Ar: Copernicus CAMS · Malha: IBGE · Avisos, estações e previsão oficial: INMET · Focos: INPE · Pluviômetros: CEMADEN · Açudes: FUNCEME/COGERH.</p>`;
    panel.querySelector('.d-close').onclick = closeDetail;
    panel.querySelectorAll('[data-ac]').forEach((el) => el.addEventListener('click', () => {
      focusAcude(ACUDES.find((x) => String(x.id) === el.dataset.ac));
    }));
    HOOKS.detail.forEach((fn) => fn(panel.querySelector('.d-hook'), place, mun));
    drawChart(hours, temps, pps);
  }

  async function loadInmetPrev(mun, req) {
    setSource('inmetPrev', 'loading');
    try {
      const d = await j(URLS.inmetPrev + mun.code);
      if (req !== detailReq) return;
      const days = d && d[mun.code];
      if (!days) throw new Error('vazio');
      const rows = Object.entries(days).map(([date, o]) => {
        const p = o.tarde || o.manha || o.noite || o;
        const periods = o.manha ? ['manha', 'tarde', 'noite'].filter((k) => o[k]).map((k) => `${k === 'manha' ? 'manhã' : k}: ${o[k].resumo}`).join(' · ') : '';
        return `<div class="prow">
          ${p.icone ? `<img src="${p.icone}" alt="" width="34" height="32">` : '<span></span>'}
          <div><b>${esc((p.dia_semana || '').replace('-Feira', ''))}</b> <small>${date.slice(0, 5)}</small><br><span>${esc(p.resumo)}</span>${periods ? `<small class="per">${esc(periods)}</small>` : ''}</div>
          <div class="pt"><b>${p.temp_max ?? '—'}°</b><small>${p.temp_min ?? '—'}°</small></div>
          <div class="pu"><small>💧 ${p.umidade_min ?? '—'}–${p.umidade_max ?? '—'}%</small><small>🌬️ ${esc(p.dir_vento || '—')} ${esc((p.int_vento || '').toLowerCase())}</small></div>
        </div>`;
      }).join('');
      const el = $('#inmetPrev');
      if (el) el.innerHTML = rows;
      setSource('inmetPrev', 'ok', `${mun.name}`);
    } catch {
      if (req !== detailReq) return;
      const el = $('#inmetPrev');
      if (el) el.innerHTML = '<p class="muted">Previsão oficial indisponível no momento.</p>';
      setSource('inmetPrev', 'err');
    }
  }

  function drawChart(hours, temps, pps) {
    if (chart) chart.destroy();
    Chart.defaults.color = '#93a0b8';
    Chart.defaults.font.family = 'Inter, sans-serif';
    chart = new Chart(document.getElementById('dChart'), {
      data: {
        labels: hours.map((t) => t.slice(11, 13) + 'h'),
        datasets: [
          { type: 'line', data: temps, yAxisID: 'y', tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4,
            segment: { borderColor: (c) => color('temp', (c.p0.parsed.y + c.p1.parsed.y) / 2) }, borderColor: '#fbb05b' },
          { type: 'bar', data: pps, yAxisID: 'y1', backgroundColor: 'rgba(96,165,250,.35)', borderRadius: 2, barPercentage: 1, categoryPercentage: 0.9 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 600 }, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,21,40,.95)', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, padding: 10,
            callbacks: {
              title: (it) => { const t = hours[it[0].dataIndex]; return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; },
              label: (it) => (it.datasetIndex === 0 ? ` ${it.parsed.y.toFixed(1)} °C` : ` ${it.parsed.y}% chuva`),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { callback: (v) => v + '°' } },
          y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%', stepSize: 50 } },
        },
      },
    });
  }

  // ------------------------------------------------------------ Busca local (IBGE)
  const q = $('#q'), results = $('#results');
  let found = [];
  q.addEventListener('input', () => {
    const term = norm(q.value.trim());
    if (term.length < 2) { results.classList.remove('show'); return; }
    found = MUNS.filter((m) => norm(m.name).includes(term))
      .sort((a, b) => norm(a.name).indexOf(term) - norm(b.name).indexOf(term)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map((m, i) => `<li data-i="${i}"><span>${esc(m.name)}</span><small>${esc(m.meso)}</small></li>`).join('')
      : '<li class="empty">Nenhum município encontrado</li>';
    results.classList.add('show');
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && found[0]) pick(found[0]);
    if (e.key === 'Escape') { results.classList.remove('show'); q.blur(); }
  });
  results.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(found[+li.dataset.i]); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) results.classList.remove('show'); });
  function pick(m) { results.classList.remove('show'); q.value = m.name; q.blur(); focusMun(m); }

  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Geolocalização não suportada neste navegador', true);
    toast('Obtendo sua localização…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const m = munAt(coords.latitude, coords.longitude);
      if (!m) return toast('Sua localização está fora do Ceará', true);
      map.flyTo([coords.latitude, coords.longitude], 10, { duration: 1.2 });
      openDetail({ kind: 'point', name: 'Sua localização', sub: m.name, lat: coords.latitude, lon: coords.longitude });
    }, () => toast('Não foi possível obter a localização', true), { timeout: 10000 });
  });

  // ------------------------------------------------------------ URL compartilhável
  function saveHash() {
    const c = map.getCenter();
    const h = new URLSearchParams({ v: state.v, z: map.getZoom(), c: `${c.lat.toFixed(3)},${c.lng.toFixed(3)}` });
    if (state.selected && state.selected.kind === 'mun') h.set('m', state.selected.code);
    history.replaceState(null, '', '#' + h);
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const c = (h.get('c') || '').split(',').map(Number), z = +h.get('z');
    if (c.length === 2 && c.every(Number.isFinite) && z) map.setView(c, clamp(z, 6, 13), { animate: false }); else fitCeara();
    return { v: h.get('v'), m: h.get('m') };
  }

  // ------------------------------------------------------------ Atualização
  async function guarded(key, fn) {
    try { await fn(); } catch (e) { console.warn(key, e); setSource(key, 'err'); }
    renderKpis(); renderRanking();
  }
  async function refresh(manual = false) {
    const btn = $('#refresh');
    btn.classList.add('spin');
    try {
      await loadMeteo(manual);
      if (aqPromise) { aqPromise = null; await ensureAQ().catch(() => {}); }
      state.ready = true;
      $('#live').className = 'live on';
      $('#updated').textContent = `Atualizado às ${hhmm(state.updatedAt)}`;
      renderTicks(); refreshView();
      if (manual) toast(`Dados de ${MUNS.length} municípios atualizados`);
    } catch (e) {
      console.error(e);
      setSource('meteo', 'err');
      $('#live').className = 'live err';
      $('#updated').textContent = 'Falha ao atualizar';
      toast('Não foi possível obter a previsão. Nova tentativa em 30 s.', true);
      setTimeout(refresh, 30000);
    } finally {
      btn.classList.remove('spin');
    }
    guarded('inmetAv', loadAlerts);
    guarded('inpe', loadFires);
    guarded('pluv', loadPluv);
    guarded('acudes', loadAcudes);
    HOOKS.refresh.forEach(([key, fn]) => guarded(key, fn));
  }
  $('#refresh').addEventListener('click', () => refresh(true));
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.updatedAt && Date.now() - state.updatedAt > REFRESH_MS) refresh();
  });

  /** Abre a gaveta de detalhes com conteúdo próprio de um módulo. */
  function openCustomPanel(render) {
    detailReq++;
    state.selected = null;
    if (pin) { pin.remove(); pin = null; }
    $('#side').classList.remove('open');
    const panel = $('#detail');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.scrollTop = 0;
    render(panel);
    panel.querySelector('.d-close')?.addEventListener('click', closeDetail);
    restyle(); renderRanking(); saveHash();
  }

  // API para módulos opcionais carregados depois deste arquivo (ex.: js/fortaleza.js)
  window.ATMOS = {
    map, state, TZ, HOOKS, EXTRA_GROUPS, SOURCES,
    j, esc, clamp, norm, km, toast, hhmm, idade, inPolys, inBox, bboxOf, polysOf, labelPoint,
    fitPad, setSource, viaProxy, toggleLayer, openDetail, openCustomPanel, closeDetail,
    getMun: (code) => BYCODE.get(code),
  };

  // ------------------------------------------------------------ Início
  async function boot() {
    renderVarButtons(); renderLegend(); renderTimeline(); renderSources();
    let uf;
    try { uf = await loadBase(); } catch (e) {
      console.error(e);
      setSource('ibge', 'err');
      $('#loaderMsg').textContent = 'Não foi possível carregar a malha do IBGE. Recarregue a página em instantes.';
      return;
    }
    buildBaseLayers(uf);
    renderMesos();
    const h = readHash();
    $('#loaderMsg').textContent = 'Consultando a previsão para os 184 municípios…';
    await refresh();
    $('#loader').classList.add('done');
    guarded('inmetEst', loadStations);
    guarded('marine', loadCoast);
    if (h.v && VARS[h.v]) document.querySelector(`#vars [data-k=${h.v}]`)?.click();
    if (h.m && BYCODE.has(h.m)) openDetail(munPlace(BYCODE.get(h.m)));
  }
  boot();
})();
