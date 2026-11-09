/* Coletores das fontes que não liberam acesso direto do navegador (CORS).
 * Usado pelas Netlify Functions (netlify/functions) e pelo coletor do GitHub Actions (scripts/coletar.mjs).
 * Cada coletor devolve um JSON normalizado e enxuto para o painel.
 */

export const FONTES = {
  acudes: {
    nome: 'Portal Hidrológico do Ceará (FUNCEME/COGERH)',
    url: 'http://www.hidro.ce.gov.br/',
  },
  pluviometros: {
    nome: 'CEMADEN — pluviômetros do Ceará',
    url: 'https://resources.cemaden.gov.br/graficos/interativo/getJson2.php?uf=CE',
  },
  fortaleza: {
    nome: 'Observatório de Riscos Climáticos de Fortaleza (IPPLAN / Prefeitura de Fortaleza)',
    url: 'https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/painel-de-calor',
    hidricos: 'https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/recursos-hidricos',
  },
};

const UA = 'Mozilla/5.0 (compatible; AtmosCeara/1.0; painel meteorologico)';

async function baixarTexto(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return r.text();
}

/** Extrai um objeto JSON literal atribuído a uma variável dentro de um HTML (ex.: `var x = {...};`). */
export function extrairObjeto(html, marcador) {
  const i = html.indexOf(marcador);
  if (i < 0) throw new Error(`marcador "${marcador}" não encontrado`);
  const ini = html.indexOf('{', i);
  let prof = 0, emTexto = false, escape = false;
  for (let p = ini; p < html.length; p++) {
    const ch = html[p];
    if (emTexto) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') emTexto = false;
      continue;
    }
    if (ch === '"') emTexto = true;
    else if (ch === '{') prof++;
    else if (ch === '}' && --prof === 0) return JSON.parse(html.slice(ini, p + 1));
  }
  throw new Error('JSON incompleto');
}

const num = (v) => (v === null || v === undefined || v === '' || v === '-' ? null : Number(v));

/** Açudes monitorados: volume, percentual, sangria e ficha técnica. */
export function normalizarAcudes(html) {
  const bruto = extrairObjeto(html, 'var dados_reservatorios');
  const lista = bruto?.data?.list || [];
  const itens = lista
    .filter((e) => e.reservatorio && e.reservatorio.latitude != null)
    .map(({ reservatorio: r, volume: v = {}, nivel: n = {}, vazao: q = {} }) => ({
      id: r.id,
      nome: r.nome,
      municipio: r.municipio,
      lat: num(r.latitude),
      lon: num(r.longitude),
      capacidade: num(r.capacidade), // hm³
      volume: num(v.valor), // hm³
      perc: num(v.perc), // %
      data: v.data || n.data || null,
      sangrando: !!n.sangrando,
      cota: num(n.valor),
      cotaSangria: num(r.cota_sangria),
      vazao: num(q.valor), // L/s
      rio: r.rio_barrado || null,
      regiao: r.regiao_hidrografica || null,
      ano: num(r.ano_construcao),
    }));
  return { fonte: FONTES.acudes.nome, url: FONTES.acudes.url, coletado: new Date().toISOString(), itens };
}

/** "09/11/26 19:10" (UTC) -> ISO 8601 */
function dataCemaden(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4}) (\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const ano = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${ano}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00Z`;
}

const JANELAS = ['1h', '3h', '6h', '12h', '24h', '48h', '72h', '96h'];

/** Pluviômetros: chuva acumulada por janela (mm) e código IBGE do município. */
export function normalizarPluviometros(texto) {
  const lista = JSON.parse(texto);
  if (!Array.isArray(lista)) throw new Error('formato inesperado do CEMADEN');
  const itens = lista.map((e) => ({
    id: e.idestacao,
    nome: e.nomeestacao,
    codibge: String(e.codibge),
    cidade: e.cidade,
    tipo: e.tipoestacao,
    ultimo: num(e.ultimovalor),
    dataHora: dataCemaden(e.datahoraUltimovalor),
    acc: Object.fromEntries(JANELAS.map((j) => [j, num(e[`acc${j}r`])])),
  }));
  return { fonte: FONTES.pluviometros.nome, url: FONTES.pluviometros.url, coletado: new Date().toISOString(), itens };
}

// ------------------------------------------------------------------ Fortaleza (Observatório)

/** Decodifica entidades HTML (&quot; &amp; &#039; &#x2F; …) de um atributo. */
export function desescapar(s) {
  const nomes = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => {
    if (c[0] === '#') return String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    return nomes[c.toLowerCase()] ?? m;
  });
}
const scriptsInline = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());

/* O desenho dos bairros do Observatório (viewBox 768×658) não tem projeção; a relação linear
 * abaixo é a calibração publicada no próprio código do Observatório (assets/js/hologram/config.js),
 * ajustada contra as coordenadas reais das estações. Precisão da ordem de algumas centenas de metros. */
const GEO_SVG = { LON_A: 3084.1711, LON_B: 119179.9992, LAT_A: -3219.2287, LAT_B: -11885.4478 };
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const svgParaLatLon = (x, y) => [r5((y - GEO_SVG.LAT_B) / GEO_SVG.LAT_A), r5((x - GEO_SVG.LON_B) / GEO_SVG.LON_A)];

/** Converte o atributo "d" de um path SVG em listas de pontos [x, y] (curvas viram o ponto final). */
export function caminhoSvg(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const aneis = [];
  let atual = null, x = 0, y = 0, x0 = 0, y0 = 0, cmd = null, i = 0;
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const C = cmd.toUpperCase(), rel = cmd !== C, n = ARGS[C];
    if (C === 'Z') { if (atual) { atual.push([x0, y0]); atual = null; } x = x0; y = y0; cmd = null; continue; }
    const a = tokens.slice(i, i + n).map(Number);
    if (a.length < n || a.some(Number.isNaN)) break;
    i += n;
    if (C === 'H') x = rel ? x + a[0] : a[0];
    else if (C === 'V') y = rel ? y + a[0] : a[0];
    else { x = rel ? x + a[n - 2] : a[n - 2]; y = rel ? y + a[n - 1] : a[n - 1]; }
    if (C === 'M') { atual = [[x, y]]; aneis.push(atual); x0 = x; y0 = y; cmd = rel ? 'l' : 'L'; }
    else { if (!atual) { atual = [[x0, y0]]; aneis.push(atual); } atual.push([x, y]); }
  }
  return aneis.filter((r) => r.length >= 2);
}

/** Calor (UTCI) nas estações, histórico de 30 dias e manutenção de canais e lagoas. */
export function normalizarFortaleza(htmlCalor, htmlHidricos) {
  const mv = /data-vistas="([^"]*)"/.exec(htmlCalor);
  if (!mv) throw new Error('dados das estações não encontrados');
  const vistas = JSON.parse(desescapar(mv[1]));
  const porId = new Map();
  for (const e of vistas.agora || []) {
    porId.set(e.id, { id: e.id, nome: e.nome, lat: num(e.lat), lon: num(e.lon), agora: { utci: num(e.sensacao), nivel: e.nivel ?? null } });
  }
  for (const e of vistas.registrada || []) {
    const s = porId.get(e.id) || { id: e.id, nome: e.nome, lat: num(e.lat), lon: num(e.lon), agora: null };
    const hora = /(\d{1,2}:\d{2})/.exec(e.rotulo || '');
    s.maxDia = { utci: num(e.sensacao), nivel: e.nivel ?? null, hora: hora ? hora[1] : null };
    porId.set(e.id, s);
  }
  const ma = /<script[^>]*id="calor-analise-dados"[^>]*>([\s\S]*?)<\/script>/i.exec(htmlCalor);
  const analise = ma ? JSON.parse(ma[1]) : null;
  const N = 30;
  const historico = analise ? {
    datas: analise.datas.slice(-N),
    estacoes: analise.estacoes.map((e) => ({ id: e.id, nome: e.nome, media: e.media.slice(-N), maxima: e.maxima.slice(-N) })),
  } : null;

  let hidricos = null;
  const bruto = htmlHidricos && scriptsInline(htmlHidricos).find((s) => s.startsWith('{"itens"'));
  if (bruto) {
    const d = JSON.parse(bruto);
    hidricos = {
      status: d.status || {},
      itens: d.itens.map((it) => ({
        id: it.id, nome: it.nome, tipo: it.tipo, bairro: it.bairro, status: it.status,
        ultima: it.ultima, prazo: it.prazo, dias: it.dias, frequencia: it.frequencia, conclusoes: it.conclusoes,
        geometria: (it.geometria || []).map((g) => ({ area: !!g.area, linhas: caminhoSvg(g.d || '').map((r) => r.map(([x, y]) => svgParaLatLon(x, y))) })),
      })),
    };
  }
  return {
    fonte: FONTES.fortaleza.nome, url: FONTES.fortaleza.url, coletado: new Date().toISOString(),
    niveis: analise?.niveis || null, estacoes: [...porId.values()], historico, hidricos,
    itens: [...porId.values()], // compatibilidade com a validação genérica do proxy
  };
}

export async function coletarAcudes(baixar = baixarTexto) {
  return normalizarAcudes(await baixar(FONTES.acudes.url));
}
export async function coletarPluviometros(baixar = baixarTexto) {
  return normalizarPluviometros(await baixar(FONTES.pluviometros.url));
}
export async function coletarFortaleza(baixar = baixarTexto) {
  const [calor, hidricos] = await Promise.all([
    baixar(FONTES.fortaleza.url),
    baixar(FONTES.fortaleza.hidricos).catch(() => null), // canais/lagoas são complementares
  ]);
  return normalizarFortaleza(calor, hidricos);
}

export const COLETORES = { acudes: coletarAcudes, pluviometros: coletarPluviometros, fortaleza: coletarFortaleza };
