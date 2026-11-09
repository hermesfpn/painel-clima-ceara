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

export async function coletarAcudes(baixar = baixarTexto) {
  return normalizarAcudes(await baixar(FONTES.acudes.url));
}
export async function coletarPluviometros(baixar = baixarTexto) {
  return normalizarPluviometros(await baixar(FONTES.pluviometros.url));
}

export const COLETORES = { acudes: coletarAcudes, pluviometros: coletarPluviometros };
