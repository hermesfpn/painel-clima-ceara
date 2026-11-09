/* Atmos Ceará — modo Fortaleza
 * Inspirado no Painel de Calor do Observatório de Riscos Climáticos de Fortaleza (IPPLAN/Prefeitura).
 * Fontes:
 *   - Observatório (via proxy /api/fortaleza): sensação térmica UTCI e níveis de calor nas 11 estações,
 *     histórico de 30 dias e situação de limpeza de canais e lagoas.
 *   - Dados abertos da Prefeitura (geo/fortaleza-bairros.geojson, gerado por scripts/preparar_fortaleza.py):
 *     malha de bairros 2025, IDH e população por bairro (Censo 2010).
 * Este arquivo usa a API exposta por app.js em window.ATMOS.
 */
(() => {
  'use strict';
  const A = window.ATMOS;
  if (!A) return;
  const { map, state, esc, km } = A;

  const COD_IBGE = '2304400';
  const LIMITES = [[-3.895, -38.64], [-3.69, -38.40]];
  const ZOOM_MIN = 10;
  const OBS_URL = 'https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/painel-de-calor';

  // Níveis do protocolo municipal de calor (UTCI). Critérios conforme o Observatório; textos de orientação próprios.
  const NIVEIS = {
    1: { nome: 'Monitoramento', cor: '#60a5fa', acao: 'Sem gatilho de calor ativo. Mantenha a hidratação e a atenção com crianças, idosos e quem trabalha ao ar livre.' },
    2: { nome: 'Atenção', cor: '#facc15', acao: 'Calor intenso. Beba água com frequência, faça pausas à sombra e reduza o esforço físico nas horas mais quentes.' },
    3: { nome: 'Alerta', cor: '#fb923c', acao: 'Calor intenso há vários dias. Evite exposição prolongada ao sol e acompanhe de perto as pessoas mais vulneráveis.' },
    4: { nome: 'Emergência', cor: '#ef4444', acao: 'Calor extremo depois de dias muito quentes. Reduza atividades ao ar livre e procure locais frescos.' },
    5: { nome: 'Resposta ampliada', cor: '#c084fc', acao: 'Situação crítica. Evite esforço físico; confusão mental, desmaio ou convulsão exigem atendimento imediato (SAMU 192).' },
  };
  const CRITERIOS = [
    [2, '≥ 38 °C', '≥ 4 h/dia', '1 ou 2 dias seguidos'],
    [3, '≥ 38 °C', '≥ 4 h/dia', '3 dias seguidos ou mais'],
    [4, '≥ 40 °C', '≥ 4 h/dia', 'após 3 dias com ≥ 38 °C'],
    [5, '> 46 °C', '≥ 2 h/dia', 'após um dia com ≥ 40 °C'],
  ];
  const STATUS = {
    dia: ['Em dia', '#22c55e'], andamento: ['Em andamento', '#38bdf8'], planejada: ['Planejada', '#a78bfa'],
    atrasada: ['Prazo vencido', '#ef4444'], 'sem-registro': ['Sem conclusão registrada', '#94a3b8'],
    'sem-prazo': ['Sem periodicidade', '#94a3b8'], inativo: ['Fora de operação', '#475569'],
  };
  const GRUPOS = ['Pessoas idosas (60+)', 'Crianças de 0 a 5 anos', 'Gestantes e lactantes', 'Pessoas com doenças crônicas, cardíacas ou respiratórias', 'Trabalhadores expostos ao sol', 'População em situação de rua'];

  const UTCI_ESCALA = [[24, '#4fb7e0'], [28, '#8fdcaa'], [31, '#e8e48a'], [34, '#f9b45a'], [38, '#f6824a'], [40, '#e9503f'], [43, '#c0263f'], [46, '#7e1d6b']];
  const VARS = {
    utci: { rotulo: 'Sensação agora (UTCI)', curto: 'Agora', un: '°', casas: 0, escala: UTCI_ESCALA, valor: (b) => b.utciAgora },
    utciMax: { rotulo: 'Máxima do dia (UTCI)', curto: 'Máx. dia', un: '°', casas: 0, escala: UTCI_ESCALA, valor: (b) => b.utciMax },
    vuln: { rotulo: 'Vulnerabilidade ao calor (experimental)', curto: 'Vulnerab.', un: '', casas: 2, escala: [[0, '#1e3a5f'], [0.3, '#2f7f8f'], [0.45, '#e6cf86'], [0.6, '#f59e0b'], [0.75, '#dc2626'], [1, '#7f1d1d']], valor: (b) => b.vuln },
    idh: { rotulo: 'IDH (base 2010)', curto: 'IDH', un: '', casas: 2, escala: [[0.1, '#7f1d1d'], [0.25, '#dc2626'], [0.4, '#f59e0b'], [0.55, '#facc15'], [0.7, '#86efac'], [0.9, '#22c55e']], valor: (b) => b.idh },
    idosos: { rotulo: '% da população com mais de 64 anos', curto: '% idosos', un: '%', casas: 1, escala: [[2, '#1e3a5f'], [5, '#2f7f8f'], [8, '#e6cf86'], [11, '#f59e0b'], [15, '#dc2626']], valor: (b) => b.pct65 },
    pop: { rotulo: 'População (2010)', curto: 'População', un: '', casas: 0, escala: [[2000, '#1e3a5f'], [15000, '#2f7f8f'], [30000, '#e6cf86'], [50000, '#f59e0b'], [80000, '#dc2626']], valor: (b) => b.pop },
  };

  const F = { bairros: [], dados: null, var: 'utci', aberto: false, janela: 7, grafico: null };
  const porNome = new Map();

  // ------------------------------------------------------------ utilidades
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function cor(escala, v) {
    if (v == null || Number.isNaN(v)) return '#2a3350';
    const s = escala.map(([x, c]) => [x, hex(c)]);
    if (v <= s[0][0]) return `rgb(${s[0][1]})`;
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        const [v0, c0] = s[i - 1], [v1, c1] = s[i], t = (v - v0) / (v1 - v0);
        return `rgb(${c0.map((c, n) => Math.round(c + (c1[n] - c) * t)).join(',')})`;
      }
    }
    return `rgb(${s[s.length - 1][1]})`;
  }
  const fmtV = (k, v) => (v == null ? '—' : k === 'pop' ? Math.round(v).toLocaleString('pt-BR') : v.toFixed(VARS[k].casas).replace('.', ',') + VARS[k].un);
  const fmtC = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + ' °C');
  const nivel = (n) => NIVEIS[n] || { nome: '—', cor: '#64748b', acao: '' };
  const badge = (n) => `<span class="nv" style="--nv:${nivel(n).cor}">${nivel(n).nome}</span>`;
  const estacoes = () => (F.dados && F.dados.estacoes) || [];
  const media = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const mesmoBairro = (a, b) => { const x = A.norm(a || ''), y = A.norm(b || ''); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

  /** Nível municipal: o maior nível atingido por pelo menos duas estações (regra de confirmação do protocolo). */
  function nivelMunicipal(campo) {
    const ns = estacoes().map((s) => s[campo] && s[campo].nivel).filter((n) => n != null);
    for (let n = 5; n >= 1; n--) if (ns.filter((x) => x >= n).length >= 2) return n;
    return ns.length ? 1 : null;
  }
  function extremo(campo) {
    return estacoes().filter((s) => s[campo] && s[campo].utci != null).sort((a, b) => b[campo].utci - a[campo].utci)[0] || null;
  }
  function idwUtci(lat, lon, campo) {
    let n = 0, d = 0;
    for (const s of estacoes()) {
      const v = s[campo] && s[campo].utci;
      if (v == null) continue;
      const dist = Math.max(km(lat, lon, s.lat, s.lon), 0.4);
      const w = 1 / (dist * dist);
      n += w * v; d += w;
    }
    return d ? n / d : null;
  }

  // ------------------------------------------------------------ camadas
  const panes = { fBairros: 400, fCirculos: 402, fAgua: 403 };
  for (const [p, z] of Object.entries(panes)) map.createPane(p).style.zIndex = z;
  map.getPane('fCirculos').style.pointerEvents = 'none';

  let camadaBairros = null;
  const camadaCalor = L.layerGroup();
  const camadaAgua = L.layerGroup();
  const marcadoresEst = new Map();
  const formasAgua = new Map();

  function sincronizar() {
    const visivel = map.getZoom() >= ZOOM_MIN - 0.01;
    document.querySelectorAll('.fz-zoom').forEach((el) => { el.hidden = visivel; });
    for (const [k, camada] of [['fBairros', camadaBairros], ['fCalor', camadaCalor], ['fAgua', camadaAgua]]) {
      if (!camada) continue;
      if (state.layers[k] && visivel) { if (!map.hasLayer(camada)) camada.addTo(map); } else if (map.hasLayer(camada)) camada.remove();
    }
  }
  map.on('zoomend', sincronizar);
  Object.assign(A.EXTRA_GROUPS, { fBairros: sincronizar, fCalor: sincronizar, fAgua: sincronizar });

  function estiloBairro(b) {
    const v = VARS[F.var].valor(b);
    return { fillColor: cor(VARS[F.var].escala, v), fillOpacity: v == null ? 0.25 : 0.72, color: 'rgba(11,16,32,.9)', weight: 0.8 };
  }
  function montarBairros() {
    if (camadaBairros) camadaBairros.remove();
    camadaBairros = L.geoJSON({ type: 'FeatureCollection', features: F.bairros.map((b) => b.feature) }, {
      pane: 'fBairros',
      style: (f) => estiloBairro(porNome.get(f.properties.nome)),
      onEachFeature: (f, layer) => {
        const b = porNome.get(f.properties.nome);
        b.layer = layer;
        layer.bindTooltip(() => `<b>${esc(b.nome)}</b> <small>${esc(b.regional || '')}</small><br>
          <span style="color:${cor(VARS[F.var].escala, VARS[F.var].valor(b))};font-weight:700;font-size:15px">${fmtV(F.var, VARS[F.var].valor(b))}</span> <small>${VARS[F.var].rotulo}</small>`,
        { sticky: true, direction: 'top', offset: [0, -8], opacity: 1 });
        layer.on('mouseover', () => { layer.setStyle({ weight: 2.2, color: '#fff' }); layer.bringToFront(); });
        layer.on('mouseout', () => layer.setStyle(estiloBairro(b)));
        layer.on('click', (e) => { L.DomEvent.stop(e); L.popup({ maxWidth: 320, className: 'bz-popup' }).setLatLng(e.latlng).setContent(popupBairro(b)).openOn(map); });
      },
    });
    sincronizar();
  }
  const reestilizar = () => camadaBairros && camadaBairros.eachLayer((l) => { const b = porNome.get(l.feature.properties.nome); if (b) l.setStyle(estiloBairro(b)); });

  function sparkline(e) {
    const W = 230, H = 54, vals = [...e.media, ...e.maxima].filter((v) => v != null);
    if (!vals.length) return '';
    const lo = Math.min(...vals, 30) - 1, hi = Math.max(...vals, 38) + 1;
    const x = (i) => (i / (e.media.length - 1)) * W, y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const linha = (arr) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(38)}" y2="${y(38)}" class="ref"/>
      <polyline points="${linha(e.maxima)}" class="mx"/><polyline points="${linha(e.media)}" class="md"/></svg>
      <small class="spark-leg"><i class="mx"></i>máxima diária <i class="md"></i>média diária <i class="ref"></i>38 °C (gatilho)</small>`;
  }

  function montarCalor() {
    camadaCalor.clearLayers();
    marcadoresEst.clear();
    const hist = F.dados.historico;
    for (const s of estacoes()) {
      const nAg = s.agora && s.agora.nivel, nDia = s.maxDia && s.maxDia.nivel;
      const c = nivel(nDia || nAg).cor;
      L.circle([s.lat, s.lon], { pane: 'fCirculos', radius: 2000, color: c, weight: 1.2, opacity: 0.8, fillColor: c, fillOpacity: 0.13, interactive: false }).addTo(camadaCalor);
      const u = s.agora && s.agora.utci;
      const h = hist && hist.estacoes.find((e) => e.id === s.id);
      const mk = L.marker([s.lat, s.lon], {
        riseOnHover: true,
        icon: L.divIcon({ className: '', iconSize: [62, 26], iconAnchor: [31, 13], html: `<div class="fz-pill" style="--c:${cor(UTCI_ESCALA, u)};--nv:${c}"><b>${u != null ? Math.round(u) + '°' : '—'}</b><i></i></div>` }),
      })
        .bindTooltip(`<b>${esc(s.nome)}</b> · ${badge(nDia || nAg)}<br><small>UTCI agora ${fmtC(u)} · máx. do dia ${fmtC(s.maxDia && s.maxDia.utci)}</small>`, { direction: 'top', offset: [0, -14] })
        .bindPopup(() => `<div class="pp fz-pp"><b>🌡️ Estação ${esc(s.nome)}</b>
          <div class="fz-pp-grid"><div><small>Agora</small><b style="color:${cor(UTCI_ESCALA, u)}">${fmtC(u)}</b>${badge(nAg)}</div>
          <div><small>Máxima do dia${s.maxDia && s.maxDia.hora ? ' · ' + s.maxDia.hora : ''}</small><b style="color:${cor(UTCI_ESCALA, s.maxDia && s.maxDia.utci)}">${fmtC(s.maxDia && s.maxDia.utci)}</b>${badge(nDia)}</div></div>
          ${h ? `<small class="muted">Últimos ${h.media.length} dias</small>${sparkline(h)}` : ''}
          <p>Raio de 2 km ao redor da estação, como no painel do Observatório. UTCI é a sensação térmica do corpo ao ar livre, não a temperatura do termômetro.</p></div>`, { maxWidth: 280 })
        .addTo(camadaCalor);
      marcadoresEst.set(s.id, mk);
    }
  }

  function montarAgua() {
    camadaAgua.clearLayers();
    formasAgua.clear();
    const itens = (F.dados.hidricos && F.dados.hidricos.itens) || [];
    for (const it of itens) {
      const [rot, c] = STATUS[it.status] || [it.status, '#94a3b8'];
      const grupo = L.featureGroup();
      for (const g of it.geometria || []) {
        if (!g.linhas.length) continue;
        (g.area
          ? L.polygon(g.linhas, { pane: 'fAgua', color: c, weight: 1.2, fillColor: c, fillOpacity: 0.55 })
          : L.polyline(g.linhas, { pane: 'fAgua', color: c, weight: 3, opacity: 0.9, lineCap: 'round' })
        ).addTo(grupo);
      }
      if (!grupo.getLayers().length) continue;
      grupo.bindTooltip(`<b>${esc(it.nome)}</b> <small>${esc(it.tipo)} · ${esc(it.bairro || '')}</small><br><span style="color:${c};font-weight:600">${esc(rot)}</span>`, { sticky: true })
        .bindPopup(`<div class="pp"><b>${it.tipo === 'Lagoa' ? '💧' : '〰️'} ${esc(it.nome)}</b>
          <p>${esc(it.tipo)} · bairro ${esc(it.bairro || '—')}<br>
          Limpeza: <b style="color:${c};font-size:12px">${esc(rot)}</b><br>
          Última conclusão: ${esc(it.ultima || '—')}${it.prazo ? ` · próxima até ${esc(it.prazo)}` : ''}<br>
          ${it.frequencia ? `Periodicidade: a cada ${it.frequencia} dias · ` : ''}${it.conclusoes ?? 0} limpeza(s) registrada(s)<br>
          <small>Fonte: Observatório de Fortaleza · posição aproximada (±500 m), convertida do mapa esquemático.</small></p></div>`, { maxWidth: 280 })
        .addTo(camadaAgua);
      formasAgua.set(it.id, grupo);
    }
  }

  // ------------------------------------------------------------ cálculo por bairro
  function calcularBairros() {
    const temCalor = estacoes().length > 0;
    const itensAgua = (F.dados && F.dados.hidricos && F.dados.hidricos.itens) || [];
    for (const b of F.bairros) {
      b.utciAgora = temCalor ? idwUtci(b.lat, b.lon, 'agora') : null;
      b.utciMax = temCalor ? idwUtci(b.lat, b.lon, 'maxDia') : null;
      const agua = itensAgua.filter((it) => mesmoBairro(it.bairro, b.nome));
      b.agua = { total: agua.length, atrasada: agua.filter((i) => i.status === 'atrasada').length, dia: agua.filter((i) => i.status === 'dia').length };
    }
    // Índice experimental: média de exposição (UTCI máx. estimado), sensibilidade (faixas etárias) e baixa capacidade adaptativa (1 − IDH)
    const faixa = (k) => { const v = F.bairros.map((b) => b[k]).filter((x) => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
    const nrm = (v, f) => (v == null || !f || f[1] === f[0] ? null : (v - f[0]) / (f[1] - f[0]));
    const fx = { exp: faixa('utciMax'), p65: faixa('pct65'), p014: faixa('pct0a14'), idh: faixa('idh') };
    for (const b of F.bairros) {
      const exp = nrm(b.utciMax, fx.exp);
      const s65 = nrm(b.pct65, fx.p65), s014 = nrm(b.pct0a14, fx.p014);
      const sens = s65 != null && s014 != null ? 0.6 * s65 + 0.4 * s014 : null;
      const cap = b.idh != null ? 1 - nrm(b.idh, fx.idh) : null;
      const comps = [exp, sens, cap].filter((x) => x != null);
      b.vulnComp = { exp, sens, cap };
      b.vuln = comps.length >= 2 ? comps.reduce((s, x) => s + x, 0) / comps.length : null;
    }
  }

  function barra(v, c) { return `<span class="mini-bar"><i style="width:${Math.round((v || 0) * 100)}%;background:${c}"></i></span>`; }
  function popupBairro(b) {
    const comp = b.vulnComp || {};
    return `<div class="pp bz"><b>🏘️ ${esc(b.nome)}</b> <small>${esc(b.regional || '')}</small>
      <div class="fz-pp-grid">
        <div><small>Sensação agora*</small><b style="color:${cor(UTCI_ESCALA, b.utciAgora)}">${fmtC(b.utciAgora)}</b></div>
        <div><small>Máxima do dia*</small><b style="color:${cor(UTCI_ESCALA, b.utciMax)}">${fmtC(b.utciMax)}</b></div>
        <div><small>IDH${b.idhRank ? ` · ${b.idhRank}º de 119` : ''}</small><b style="color:${cor(VARS.idh.escala, b.idh)}">${b.idh != null ? b.idh.toFixed(2).replace('.', ',') : '—'}</b></div>
        <div><small>População (2010)</small><b>${b.pop != null ? b.pop.toLocaleString('pt-BR') : '—'}</b></div>
      </div>
      ${b.idh != null ? `<table class="bz-t"><tr><td>Educação</td><td>${barra(b.idhEduc, '#60a5fa')}</td><td>${b.idhEduc?.toFixed(2)}</td></tr>
        <tr><td>Longevidade</td><td>${barra(b.idhLong, '#4ade80')}</td><td>${b.idhLong?.toFixed(2)}</td></tr>
        <tr><td>Renda</td><td>${barra(b.idhRenda, '#facc15')}</td><td>${b.idhRenda?.toFixed(2)}</td></tr></table>` : ''}
      ${b.pop != null ? `<p>0 a 14 anos: <b>${b.pct0a14?.toFixed(1)}%</b> · mais de 64: <b>${b.pct65?.toFixed(1)}%</b> (${b.pop65?.toLocaleString('pt-BR')} pessoas) · ${b.moradores?.toFixed(1)} moradores/domicílio</p>` : '<p>Bairro criado depois de 2010: sem IDH e dados demográficos.</p>'}
      ${b.vuln != null ? `<div class="vuln"><small>Vulnerabilidade ao calor (experimental)</small>${barra(b.vuln, cor(VARS.vuln.escala, b.vuln))}<b>${b.vuln.toFixed(2)}</b>
        <small class="muted">exposição ${comp.exp != null ? comp.exp.toFixed(2) : '—'} · sensibilidade ${comp.sens != null ? comp.sens.toFixed(2) : '—'} · baixa capacidade ${comp.cap != null ? comp.cap.toFixed(2) : '—'}</small></div>` : ''}
      ${b.agua && b.agua.total ? `<p>Canais e lagoas no bairro: <b>${b.agua.total}</b> · ${b.agua.dia} em dia · <span style="color:#ef4444">${b.agua.atrasada} com prazo vencido</span></p>` : ''}
      <small class="muted">* estimado a partir das estações do Observatório (interpolação por distância).</small></div>`;
  }

  // ------------------------------------------------------------ carregamento
  async function carregarBairros() {
    if (F.bairros.length) return;
    A.setSource('bairros', 'loading');
    const g = await A.j('geo/fortaleza-bairros.geojson');
    F.bairros = g.features.map((f) => {
      const polys = A.polysOf(f.geometry);
      const bbox = A.bboxOf(polys);
      const [lon, lat] = A.labelPoint(polys, bbox);
      return { ...f.properties, feature: f, polys, bbox, lat, lon };
    });
    F.bairros.forEach((b) => porNome.set(b.nome, b));
    calcularBairros();
    montarBairros();
    A.setSource('bairros', 'ok', `${F.bairros.length} bairros · IDH e população (2010)`);
  }
  async function carregarObservatorio() {
    A.setSource('fortaleza', 'loading');
    const d = await A.viaProxy('fortaleza');
    F.dados = d;
    calcularBairros();
    reestilizar();
    montarCalor();
    montarAgua();
    sincronizar();
    if (F.aberto) desenharPainel();
    const nA = (d.hidricos && d.hidricos.itens.length) || 0;
    A.setSource('fortaleza', 'ok', `${d.estacoes.length} estações · ${nA} canais/lagoas · ${A.idade(d.coletado)}`);
  }
  A.HOOKS.refresh.push(['bairros', carregarBairros], ['fortaleza', carregarObservatorio]);

  // ------------------------------------------------------------ painel urbano
  function serieCidade(n) {
    const h = F.dados && F.dados.historico;
    if (!h) return null;
    const ini = Math.max(0, h.datas.length - n);
    const datas = h.datas.slice(ini);
    return {
      datas,
      media: datas.map((_, i) => media(h.estacoes.map((e) => e.media[ini + i]))),
      maxima: datas.map((_, i) => { const v = h.estacoes.map((e) => e.maxima[ini + i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; }),
      ranking: h.estacoes.map((e) => ({ id: e.id, nome: e.nome, media: media(e.media.slice(ini)), pico: Math.max(...e.maxima.slice(ini).filter((x) => x != null)) }))
        .filter((r) => r.media != null).sort((a, b) => b.media - a.media),
    };
  }

  function desenharPainel() {
    A.openCustomPanel((panel) => {
      const d = F.dados;
      const nDia = nivelMunicipal('maxDia');
      const topAg = extremo('agora'), topDia = extremo('maxDia');
      const ests = [...estacoes()].sort((a, b) => ((b.agora && b.agora.utci) || 0) - ((a.agora && a.agora.utci) || 0));
      const v = VARS[F.var], s = v.escala, lo = s[0][0], hi = s[s.length - 1][0];
      const grad = s.map(([x, c]) => `${c} ${(((x - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(',');
      const agua = (d && d.hidricos && d.hidricos.itens) || [];
      const contagem = Object.keys(STATUS).map((k) => [k, agua.filter((i) => i.status === k).length]).filter(([, n]) => n);
      const atrasadas = agua.filter((i) => i.status === 'atrasada').sort((a, b) => {
        const p = (x) => (x.prazo ? x.prazo.split('/').reverse().join('') : '9');
        return p(a).localeCompare(p(b));
      }).slice(0, 6);
      const vuln = F.bairros.filter((b) => b.vuln != null).sort((a, b) => b.vuln - a.vuln).slice(0, 8);
      const serie = serieCidade(F.janela);

      panel.innerHTML = `
        <div class="d-head"><div><h2>🏙️ Fortaleza</h2><p>Painel urbano · ${F.bairros.length} bairros · ${estacoes().length} estações de calor</p></div><button class="icon-btn d-close" aria-label="Fechar">×</button></div>
        ${d ? `
        <div class="fz-nivel" style="--nv:${nivel(nDia).cor}">
          <small>Nível de calor hoje · protocolo municipal</small>
          <strong>${nivel(nDia).nome}</strong>
          <p>${esc(nivel(nDia).acao)}</p>
          <div class="fz-nivel-row">
            <div><small>Maior sensação agora</small>${topAg ? `<span><b>${fmtC(topAg.agora.utci)}</b> em ${esc(topAg.nome)}</span>` : '—'}</div>
            <div><small>Máxima do dia</small>${topDia ? `<span><b>${fmtC(topDia.maxDia.utci)}</b> em ${esc(topDia.nome)}${topDia.maxDia.hora ? ' às ' + topDia.maxDia.hora : ''}</span>` : '—'}</div>
          </div>
          <small class="muted">O nível considera as últimas 24 h e os dias anteriores, e vale para a cidade quando pelo menos duas estações o atingem. Fonte: Observatório de Fortaleza · ${A.idade(d.coletado)}.</small>
        </div>
        <details class="fz-crit"><summary>Critérios dos níveis (sensação térmica UTCI)</summary>
          <table><thead><tr><th>Nível</th><th>UTCI</th><th>Duração</th><th>Sequência</th></tr></thead><tbody>
          ${CRITERIOS.map(([n, u, du, sq]) => `<tr><td>${badge(n)}</td><td>${u}</td><td>${du}</td><td>${sq}</td></tr>`).join('')}
          </tbody></table><p class="muted">Monitoramento: nenhum critério atingido. O UTCI combina temperatura, umidade, vento e radiação para estimar como o corpo sente o calor ao ar livre.</p></details>`
          : '<p class="muted" style="margin-top:14px">Dados do Observatório indisponíveis no momento. Bairros, IDH e população seguem disponíveis.</p>'}

        <h3>Colorir bairros por</h3>
        <div class="chips fz-vars">${Object.entries(VARS).map(([k, x]) => `<button data-fv="${k}" class="${k === F.var ? 'on' : ''}">${x.curto}</button>`).join('')}</div>
        <div class="legend-bar" style="margin-top:10px;background:linear-gradient(90deg,${grad})"></div>
        <div class="legend-ticks"><span>${fmtV(F.var, lo)}</span><span>${esc(v.rotulo)}</span><span>${fmtV(F.var, hi)}</span></div>
        ${F.var === 'vuln' ? '<p class="muted" style="margin-top:6px">Índice experimental do Atmos (não oficial): média de exposição (UTCI máximo estimado), sensibilidade (crianças e idosos) e baixa capacidade adaptativa (1 − IDH), cada um reescalado de 0 a 1 entre os bairros.</p>' : ''}
        <p class="muted fz-zoom" style="margin-top:6px">Aproxime o mapa para ver os bairros.</p>

        ${d ? `<h3>Estações agora <span>UTCI · nível</span></h3>
        <div class="fz-list">${ests.map((s) => `<button data-est="${esc(s.id)}"><span>${esc(s.nome)}</span>
          <b style="color:${cor(UTCI_ESCALA, s.agora && s.agora.utci)}">${fmtC(s.agora && s.agora.utci)}</b>${badge((s.maxDia && s.maxDia.nivel) || (s.agora && s.agora.nivel))}</button>`).join('')}</div>` : ''}

        ${serie ? `<h3>Histórico <span>UTCI diário das estações</span></h3>
        <div class="chips fz-jan">${[7, 15, 30].map((n) => `<button data-jan="${n}" class="${n === F.janela ? 'on' : ''}">${n} dias</button>`).join('')}</div>
        <div class="chart-box" style="height:170px;margin-top:8px"><canvas id="fzChart"></canvas></div>
        <ol class="fz-rank">${serie.ranking.map((r, i) => `<li><span class="n">${i + 1}</span><span>${esc(r.nome)}</span><b style="color:${cor(UTCI_ESCALA, r.media)}">${r.media.toFixed(1).replace('.', ',')}°</b><small>pico ${r.pico.toFixed(1).replace('.', ',')}°</small></li>`).join('')}</ol>
        <p class="muted">Média da sensação térmica diária em cada estação no período (dias completos).</p>` : ''}

        ${vuln.length ? `<h3>Bairros mais vulneráveis ao calor <span>experimental</span></h3>
        <div class="fz-list">${vuln.map((b) => `<button data-bairro="${esc(b.nome)}"><span>${esc(b.nome)}</span>${barra(b.vuln, cor(VARS.vuln.escala, b.vuln))}<b>${b.vuln.toFixed(2)}</b></button>`).join('')}</div>` : ''}

        ${agua.length ? `<h3>Canais e lagoas <span>limpeza · ${agua.length} corpos d'água</span></h3>
        <div class="stack">${contagem.map(([k, n]) => `<i style="flex:${n};background:${STATUS[k][1]}" title="${STATUS[k][0]}: ${n}"></i>`).join('')}</div>
        <div class="stack-leg">${contagem.map(([k, n]) => `<span><i style="background:${STATUS[k][1]}"></i>${STATUS[k][0]} <b>${n}</b></span>`).join('')}</div>
        ${atrasadas.length ? `<small class="muted">Prazos vencidos há mais tempo:</small><div class="fz-list">${atrasadas.map((i) => `<button data-agua="${esc(i.id)}"><span>${esc(i.nome)}<small>${esc(i.bairro || '')}</small></span><small>prazo ${esc(i.prazo || '—')}</small></button>`).join('')}</div>` : ''}` : ''}

        <h3>Grupos prioritários no calor</h3>
        <ul class="fz-grupos">${GRUPOS.map((g) => `<li>${g}</li>`).join('')}</ul>

        <p class="d-src">Calor, histórico e canais/lagoas: <a href="${OBS_URL}" target="_blank" rel="noopener">Observatório de Riscos Climáticos de Fortaleza</a> (IPPLAN/Prefeitura), coletados automaticamente a cada 30 min. Para decisões oficiais, consulte o painel do Observatório e a Defesa Civil.
        Bairros, IDH e população: <a href="https://dados.fortaleza.ce.gov.br" target="_blank" rel="noopener">dados abertos da Prefeitura de Fortaleza</a> (SEUMA, SDE · CC BY-SA).</p>`;

      panel.querySelector('.d-close').addEventListener('click', () => { F.aberto = false; renderChip(); });
      panel.querySelectorAll('[data-fv]').forEach((b) => b.addEventListener('click', () => { F.var = b.dataset.fv; reestilizar(); desenharPainel(); }));
      panel.querySelectorAll('[data-jan]').forEach((b) => b.addEventListener('click', () => { F.janela = +b.dataset.jan; desenharPainel(); }));
      panel.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', () => {
        const s = estacoes().find((x) => x.id === b.dataset.est);
        irPara([s.lat, s.lon], 13, () => marcadoresEst.get(s.id)?.openPopup());
      }));
      panel.querySelectorAll('[data-bairro]').forEach((el) => el.addEventListener('click', () => {
        const b = porNome.get(el.dataset.bairro);
        irPara([b.lat, b.lon], 13, () => L.popup({ maxWidth: 320 }).setLatLng([b.lat, b.lon]).setContent(popupBairro(b)).openOn(map));
      }));
      panel.querySelectorAll('[data-agua]').forEach((el) => el.addEventListener('click', () => {
        const g = formasAgua.get(el.dataset.agua);
        if (!g) return;
        irPara(g.getBounds().getCenter(), 14, () => g.openPopup(g.getBounds().getCenter()));
      }));
      if (serie) desenharGrafico(serie);
      sincronizar();
    });
  }

  function irPara(latlng, zoom, depois) {
    for (const k of ['fBairros', 'fCalor', 'fAgua']) if (!state.layers[k]) A.toggleLayer(k, true);
    map.flyTo(latlng, Math.max(map.getZoom(), zoom), { duration: 1 });
    setTimeout(depois, 1150);
  }

  function desenharGrafico(serie) {
    if (F.grafico) F.grafico.destroy();
    const el = document.getElementById('fzChart');
    if (!el || !window.Chart) return;
    F.grafico = new Chart(el, {
      type: 'line',
      data: {
        labels: serie.datas.map((t) => `${t.slice(8, 10)}/${t.slice(5, 7)}`),
        datasets: [
          { label: 'Maior máxima entre as estações', data: serie.maxima, borderColor: '#f6824a', backgroundColor: 'rgba(246,130,74,.15)', fill: '+1', tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { label: 'Média das estações', data: serie.media, borderColor: '#8fdcaa', tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { label: 'Gatilho 38 °C', data: serie.datas.map(() => 38), borderColor: 'rgba(250,204,21,.7)', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 }, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, boxHeight: 2, font: { size: 10 } } },
          tooltip: { backgroundColor: 'rgba(15,21,40,.95)', callbacks: { label: (it) => ` ${it.dataset.label}: ${it.parsed.y != null ? it.parsed.y.toFixed(1) : '—'} °C` } },
        },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { callback: (v) => v + '°' } } },
      },
    });
  }

  async function abrirFortaleza() {
    F.aberto = true;
    renderChip();
    const largo = innerWidth > 860;
    map.flyToBounds(LIMITES, largo ? { paddingTopLeft: [330, 90], paddingBottomRight: [430, 100], duration: 1.2 } : { duration: 1.2 });
    desenharPainel();
    if (!F.bairros.length) await carregarBairros().catch(() => A.setSource('bairros', 'err'));
    if (!F.dados) await carregarObservatorio().catch(() => A.setSource('fortaleza', 'err'));
    desenharPainel();
  }

  // Botão "Fortaleza" junto das mesorregiões
  function renderChip() {
    const el = document.querySelector('#mesos [data-city]');
    if (el) el.classList.toggle('on', F.aberto);
  }
  A.HOOKS.mesos.push((el) => {
    el.insertAdjacentHTML('beforeend', `<button data-city class="city ${F.aberto ? 'on' : ''}">🏙️ Fortaleza</button>`);
    el.querySelector('[data-city]').addEventListener('click', abrirFortaleza);
  });

  // Cartão no detalhe do município de Fortaleza
  A.HOOKS.detail.push((el, place, mun) => {
    F.aberto = false;
    renderChip();
    if (!el || !mun || mun.code !== COD_IBGE) return;
    const n = F.dados ? nivelMunicipal('maxDia') : null;
    el.innerHTML = `<button class="fz-cta" style="--nv:${nivel(n).cor}">
      <span>🏙️ Abrir painel urbano de Fortaleza</span>
      <small>${n ? `Calor hoje: <b>${nivel(n).nome}</b> · ` : ''}bairros, IDH, sensação térmica UTCI, canais e lagoas</small></button>`;
    el.querySelector('button').addEventListener('click', abrirFortaleza);
  });

  sincronizar();
})();
