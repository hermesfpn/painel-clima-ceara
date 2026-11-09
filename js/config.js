/* Configuração do painel — ajuste aqui escalas, pontos do litoral e endereços das fontes. */
window.CFG = {
  TZ: 'America/Fortaleza',
  BOUNDS: [[-7.88, -41.45], [-2.75, -37.24]], // Ceará
  HOURS: 48,
  REFRESH_MS: 30 * 60 * 1000,

  // Variáveis exibidas no mapa coroplético. src: 'meteo' (previsão) ou 'aq' (qualidade do ar, carregada sob demanda).
  VARS: {
    temp: { label: 'Temperatura', short: 'Temp', icon: '🌡️', unit: '°', full: '°C', src: 'meteo', hourly: 'temperature_2m', current: 'temperature_2m',
      scale: [[18, '#3f6fd8'], [22, '#4fb7e0'], [24, '#7fd8c4'], [26, '#c4e89a'], [28, '#f3e27a'], [30, '#f9b45a'], [32, '#f6824a'], [34, '#e9503f'], [36, '#c0263f'], [40, '#8a0f3c']] },
    app: { label: 'Sensação térmica', short: 'Sensação', icon: '🥵', unit: '°', full: '°C', src: 'meteo', hourly: 'apparent_temperature', current: 'apparent_temperature',
      scale: [[18, '#3f6fd8'], [22, '#4fb7e0'], [24, '#7fd8c4'], [26, '#c4e89a'], [28, '#f3e27a'], [31, '#f9b45a'], [34, '#f6824a'], [37, '#e9503f'], [40, '#c0263f'], [44, '#8a0f3c']] },
    rh: { label: 'Umidade relativa', short: 'Umidade', icon: '💧', unit: '%', full: '%', src: 'meteo', hourly: 'relative_humidity_2m', current: 'relative_humidity_2m',
      scale: [[15, '#b8682f'], [30, '#d99a4e'], [45, '#e6cf86'], [60, '#c9e4a8'], [72, '#7fd1c3'], [85, '#36a9b8'], [100, '#2a6fb0']] },
    wind: { label: 'Velocidade do vento', short: 'Vento', icon: '🌬️', unit: '', full: ' km/h', src: 'meteo', hourly: 'wind_speed_10m', current: 'wind_speed_10m',
      scale: [[0, '#34507d'], [6, '#3d84b8'], [12, '#45b6c4'], [18, '#8fdcaa'], [24, '#e8e48a'], [32, '#f7a95c'], [42, '#ef6a5a'], [60, '#c23b8a']] },
    pp: { label: 'Chance de chuva', short: 'Chance', icon: '☔', unit: '%', full: '%', src: 'meteo', hourly: 'precipitation_probability',
      scale: [[0, '#4a5568'], [15, '#56789e'], [30, '#4a9fd8'], [50, '#4f86f0'], [70, '#7a5cf0'], [90, '#b04ce0'], [100, '#d63cc0']] },
    rain: { label: 'Chuva prevista', short: 'Chuva', icon: '🌧️', unit: '', full: ' mm/h', dec: 1, src: 'meteo', hourly: 'precipitation',
      scale: [[0, '#3a4558'], [0.2, '#4a7fb0'], [1, '#3fa9f5'], [3, '#5b6cf0'], [6, '#9b4ce0'], [10, '#e03cb0']] },
    uv: { label: 'Índice UV', short: 'UV', icon: '🔆', unit: '', full: '', src: 'meteo', hourly: 'uv_index',
      scale: [[0, '#2f4a6b'], [2, '#3b8f5a'], [4, '#c9d34a'], [6, '#f2a33a'], [8, '#e8503a'], [11, '#9b3fd0']] },
    obs: { label: 'Chuva medida (CEMADEN)', short: 'Medida', icon: '🪣', unit: '', full: ' mm', dec: 1, src: 'obs',
      scale: [[0, '#3a4558'], [1, '#4a7fb0'], [5, '#3fa9f5'], [15, '#5b6cf0'], [30, '#9b4ce0'], [60, '#e03cb0']] },
    pm25: { label: 'Partículas PM2.5', short: 'Ar', icon: '🌫️', unit: '', full: ' µg/m³', src: 'aq', hourly: 'pm2_5', current: 'pm2_5',
      scale: [[0, '#3fae7a'], [10, '#8fca5a'], [15, '#c9d34a'], [25, '#f2a33a'], [50, '#e8503a'], [100, '#8f3fbf']] },
  },

  // Pontos ligeiramente afastados da costa para a previsão marinha (ondas e temperatura do mar).
  COAST: [
    { name: 'Camocim', lat: -2.80, lon: -40.86 },
    { name: 'Jericoacoara', lat: -2.72, lon: -40.50 },
    { name: 'Acaraú', lat: -2.78, lon: -40.12 },
    { name: 'Itarema', lat: -2.85, lon: -39.85 },
    { name: 'Trairi', lat: -3.18, lon: -39.28 },
    { name: 'Paracuru', lat: -3.35, lon: -39.02 },
    { name: 'Fortaleza', lat: -3.66, lon: -38.48 },
    { name: 'Aquiraz', lat: -3.88, lon: -38.30 },
    { name: 'Beberibe', lat: -4.12, lon: -37.98 },
    { name: 'Canoa Quebrada', lat: -4.48, lon: -37.66 },
    { name: 'Icapuí', lat: -4.63, lon: -37.30 },
  ],

  // Escala de cor do volume dos açudes (% da capacidade).
  ACUDE_SCALE: [[0, '#991b1b'], [10, '#ef4444'], [30, '#f59e0b'], [50, '#facc15'], [70, '#4ade80'], [90, '#38bdf8'], [100, '#2563eb']],

  // Dados que passam pelo proxy (FUNCEME/COGERH e CEMADEN). Tenta cada base em ordem:
  //  1) 'api/'  → Netlify Functions (netlify/functions) ou scripts/servidor_local.py
  //  2) 'data/' → JSON gerado pelo GitHub Actions (scripts/coletar.mjs) para o GitHub Pages
  // Para usar um proxy hospedado em outro lugar, coloque a URL completa primeiro, ex.: 'https://seusite.netlify.app/api/'.
  PROXY: ['api/', 'data/'],

  URLS: {
    ibgeUF: 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/23?formato=application/vnd.geo+json&qualidade=intermediaria',
    ibgeMun: 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/23?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=intermediaria',
    ibgeNomes: 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/23/municipios',
    meteo: 'https://api.open-meteo.com/v1/forecast',
    aq: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    marine: 'https://marine-api.open-meteo.com/v1/marine',
    inmetEst: 'https://apitempo.inmet.gov.br/estacoes/',
    inmetAvisos: 'https://apiprevmet3.inmet.gov.br/avisos/ativos',
    inmetPrev: 'https://apiprevmet3.inmet.gov.br/previsao/',
    inpe: 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_',
    rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
  },
};
