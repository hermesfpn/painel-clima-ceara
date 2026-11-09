# Atmos Ceará — Painel do Clima

Mapa meteorológico interativo do **Ceará**. Mostra:

- os 184 municípios coloridos pela variável escolhida;
- partículas de vento recortadas no contorno do estado;
- os açudes monitorados;
- a chuva medida pelos pluviômetros;
- as estações e os avisos do INMET;
- os focos de queimadas do INPE;
- radar de chuva, ondas no litoral e qualidade do ar.

O site é estático, sem build e sem chave de API. Duas fontes (FUNCEME/COGERH e CEMADEN) passam por um proxy pequeno, que funciona tanto na Netlify quanto no GitHub Pages.

## Fontes públicas de dados

O painel lateral mostra o status de cada fonte em tempo real.

### Direto do navegador

| Fonte | O que fornece |
|---|---|
| **IBGE**, API de Malhas e Localidades | Contorno do estado, polígonos dos 184 municípios, meso e microrregiões |
| **Open-Meteo**, Forecast | Previsão horária (48 h) para cada município: temperatura, sensação, umidade, vento, chuva e UV |
| **Open-Meteo / Copernicus CAMS** | Qualidade do ar: PM2.5, PM10, poeira e AQI |
| **Open-Meteo Marine** | Ondas e temperatura do mar em 11 pontos do litoral |
| **INMET**, estações | Localização, tipo, situação e altitude das estações automáticas e convencionais do CE |
| **INMET**, avisos | Avisos ativos e futuros, com severidade, riscos, instruções e municípios afetados |
| **INMET**, previsão oficial | Previsão por município (manhã/tarde/noite) |
| **INPE**, Programa Queimadas | Focos de calor de hoje e de ontem |
| **RainViewer** | Radar de chuva animado |

### Via proxy (as fontes não liberam CORS)

| Fonte | O que fornece | Rota |
|---|---|---|
| **FUNCEME / COGERH**, Portal Hidrológico do Ceará | 144 açudes monitorados: volume (hm³ e %), capacidade, cota, sangria, vazão, rio e região hidrográfica | `/api/acudes` |
| **CEMADEN**, pluviômetros | Cerca de 300 pluviômetros no CE, com chuva acumulada em 1, 3, 6, 12, 24, 48, 72 e 96 h | `/api/pluviometros` |

### Fortaleza (modo urbano)

Para abrir: botão **🏙️ Fortaleza** junto das mesorregiões, ou cartão no detalhe do município. Os bairros, as estações e os canais aparecem a partir do zoom 10.

| Fonte | O que fornece | Como entra |
|---|---|---|
| **Observatório de Riscos Climáticos de Fortaleza** (IPPLAN/Prefeitura), [Painel de Calor](https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/painel-de-calor) | Sensação térmica **UTCI** agora e máxima do dia nas 11 estações, nível do protocolo municipal de calor, histórico de 30 dias | Proxy `/api/fortaleza` |
| **Observatório**, [Recursos hídricos](https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/recursos-hidricos) | 235 canais e lagoas com a situação da limpeza (em dia, prazo vencido…) | Proxy `/api/fortaleza` |
| **Dados abertos da Prefeitura** ([dados.fortaleza.ce.gov.br](https://dados.fortaleza.ce.gov.br)) | Malha dos 121 bairros (SEUMA, 2025), IDH por bairro e população por faixa etária (SDE, base 2010, CC BY-SA) | Arquivo estático `geo/fortaleza-bairros.geojson` |

No modo Fortaleza você encontra:

- **Nível de calor do dia**, pelas regras do protocolo municipal: o nível vale para a cidade quando pelo menos duas estações o atingem. Acompanha a tabela de critérios e uma orientação curta.
- **Estações** com raio de 2 km colorido pelo nível, e popup com a evolução dos últimos 30 dias.
- **Bairros coloridos** por: sensação agora, máxima do dia, IDH, % de idosos, população ou **vulnerabilidade ao calor**. Este último é um índice experimental do Atmos, não oficial: a média de exposição (UTCI máximo estimado), sensibilidade (crianças e idosos) e baixa capacidade adaptativa (1 − IDH).
- **Histórico de 7, 15 ou 30 dias**, com gráfico e ranking das estações.
- **Canais e lagoas** coloridos pela situação da limpeza, com a lista dos prazos vencidos há mais tempo.

Observações:

- A sensação por bairro é **estimada** por interpolação entre as estações.
- Os canais e lagoas são publicados pelo Observatório num mapa esquemático. As coordenadas foram convertidas com a calibração do próprio Observatório e têm precisão de algumas centenas de metros: 209 de 234 caem no bairro declarado.
- Para regerar os bairros (quando a Prefeitura publicar nova malha ou novos indicadores), rode:

  ```bash
  python scripts/preparar_fortaleza.py
  ```

## Como o proxy funciona

```
netlify/
  lib/fontes.mjs        ← coletores e normalização (código único, usado pelos dois modos)
  lib/resposta.mjs      ← resposta JSON com cache na CDN
  functions/acudes.mjs        → GET /api/acudes
  functions/pluviometros.mjs  → GET /api/pluviometros
scripts/
  coletar.mjs           ← grava data/*.json (usado pelo GitHub Actions)
  servidor_local.py     ← servidor de desenvolvimento com as mesmas rotas
```

O navegador tenta as bases definidas em `PROXY`, no arquivo `js/config.js`, nesta ordem:

1. **`api/`**: Netlify Functions. As respostas ficam **15 min em cache na CDN**, então todos os visitantes compartilham a mesma consulta e os servidores do governo não são sobrecarregados.
2. **`data/`**: arquivos JSON gerados pelo GitHub Actions a cada 30 min, para quem hospeda só no GitHub Pages.

Para usar um proxy hospedado em outro lugar (por exemplo, site no GitHub Pages e proxy na Netlify), coloque a URL completa no início da lista: `PROXY: ['https://seusite.netlify.app/api/', 'api/', 'data/']`.

Se uma fonte sair do ar, o painel continua funcionando e a marca como "indisponível agora".

## Rodar localmente

```bash
python scripts/servidor_local.py
```

Depois abra http://localhost:5173. Esse servidor de desenvolvimento serve o site e também responde `/api/acudes` e `/api/pluviometros`.

Com Node e a Netlify CLI, a alternativa é `npx netlify dev`.

## Publicar

### Netlify (recomendado: o proxy roda como Netlify Function)

1. Envie esta pasta para um repositório no GitHub.
2. Na Netlify: *Add new site → Import an existing project* → escolha o repositório. Deixe o comando de build vazio, porque o `netlify.toml` já configura a pasta publicada e as funções.
3. Pronto: `https://seusite.netlify.app/api/acudes` passa a responder.

> O **Netlify Drop** (arrastar a pasta) publica só os arquivos estáticos, sem as funções. Nesse caso os açudes e os pluviômetros ficam indisponíveis e o restante funciona. Para ter o proxy, use o repositório (passo acima) ou a CLI: `npx netlify deploy --prod`.

### GitHub Pages (o proxy roda como coleta agendada)

1. Envie esta pasta para a branch `main` de um repositório.
2. Em *Settings → Pages → Build and deployment*, escolha **GitHub Actions**.
3. O workflow `.github/workflows/pages.yml` coleta os açudes e os pluviômetros e publica o site **a cada push e a cada 30 minutos**.

> O GitHub pode atrasar execuções agendadas em horários de pico e pausa os agendamentos em repositórios sem atividade por 60 dias.

## Limitações conhecidas

- **Leituras das estações do INMET**: os dados horários observados exigem token, obtido por cadastro no INMET. Por isso o painel mostra os metadados das estações e a previsão para o ponto exato de cada uma.
- **Pluviômetros do CEMADEN**: a fonte informa o município, mas não as coordenadas de cada aparelho. O mapa mostra o **maior acumulado por município**, e o detalhe do município lista cada pluviômetro.
- **Portal Hidrológico**: os dados vêm de uma variável embutida na página (`dados_reservatorios`), não de uma API documentada. Se o portal mudar de formato, o coletor acusa erro e o painel marca a fonte como indisponível.
- **Open-Meteo**: é gratuito para uso não comercial, com limites de 600 chamadas por minuto e 10 mil por dia por IP. Cada atualização consulta os 184 municípios, o que conta como 184 chamadas. Por isso o resultado fica **guardado no navegador por 15 min**, e recarregar a página não gasta cota.
- **Observatório de Fortaleza**: os dados vêm embutidos nas páginas públicas, não de uma API documentada. Se o site mudar de formato, o coletor acusa erro e o painel marca a fonte como indisponível. O painel cita o Observatório e aponta para ele como referência oficial.

## Recursos

- **9 variáveis**: temperatura, sensação, umidade, vento, chance de chuva, chuva prevista, UV, **chuva medida (CEMADEN)** com janela de 1 h a 96 h, e PM2.5.
- **Açudes como "mini-reservatórios"**: o tamanho indica a capacidade, e o nível e a cor indicam o % do volume. Açudes sangrando pulsam. O painel mostra o total armazenado no estado e os maiores açudes.
- **Contraste relativo**, **linha do tempo de 48 h**, **filtro por mesorregião**, **busca instantânea**, **geolocalização** e **link compartilhável**.
- **Detalhe do município**, com:
  - condições atuais e qualidade do ar;
  - gráfico de 48 h e 7 dias de previsão;
  - previsão oficial do INMET e avisos ativos;
  - tabela dos pluviômetros do CEMADEN;
  - açudes do município ou o mais próximo;
  - focos de queimada e estação do INMET mais próxima.

## Personalizar

- `js/config.js`: variáveis, escalas de cor, pontos do litoral, ordem das bases do proxy e endereços das fontes.
- `netlify/lib/fontes.mjs`: para adicionar uma fonte nova, crie um coletor, registre-o em `COLETORES` e crie a função correspondente em `netlify/functions/`.
