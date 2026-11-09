"""Servidor local de desenvolvimento (sem Node e sem Netlify CLI).

Serve o site e responde /api/acudes e /api/pluviometros com a mesma normalização
de netlify/lib/fontes.mjs. Também expõe /__bruto/<fonte> (resposta original da fonte)
para conferir o coletor JavaScript direto no navegador.

Uso:  python scripts/servidor_local.py [porta]
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FONTES = {
    "acudes": ("Portal Hidrológico do Ceará (FUNCEME/COGERH)", "http://www.hidro.ce.gov.br/"),
    "pluviometros": ("CEMADEN — pluviômetros do Ceará", "https://resources.cemaden.gov.br/graficos/interativo/getJson2.php?uf=CE"),
    "fortaleza-calor": ("Observatório de Riscos Climáticos de Fortaleza (IPPLAN / Prefeitura de Fortaleza)",
                        "https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/painel-de-calor"),
    "fortaleza-hidricos": ("Observatório — recursos hídricos", "https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/recursos-hidricos"),
}
JANELAS = ["1h", "3h", "6h", "12h", "24h", "48h", "72h", "96h"]
CACHE = {}  # fonte -> (instante, texto bruto)


def baixar(fonte):
    t, txt = CACHE.get(fonte, (0, None))
    if txt is None or time.time() - t > 900:
        req = urllib.request.Request(FONTES[fonte][1], headers={"User-Agent": "Mozilla/5.0 (compatible; AtmosCeara/1.0)"})
        with urllib.request.urlopen(req, timeout=25) as r:
            txt = r.read().decode("utf-8", "replace")
        CACHE[fonte] = (time.time(), txt)
    return txt


def num(v):
    return None if v in (None, "", "-") else float(v)


def agora():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def acudes(html):
    i = html.index("var dados_reservatorios")
    bruto, _ = json.JSONDecoder().raw_decode(html[html.index("{", i):])
    itens = []
    for e in bruto["data"]["list"]:
        r, v, n, q = e.get("reservatorio") or {}, e.get("volume") or {}, e.get("nivel") or {}, e.get("vazao") or {}
        if r.get("latitude") is None:
            continue
        itens.append({
            "id": r.get("id"), "nome": r.get("nome"), "municipio": r.get("municipio"),
            "lat": num(r.get("latitude")), "lon": num(r.get("longitude")),
            "capacidade": num(r.get("capacidade")), "volume": num(v.get("valor")), "perc": num(v.get("perc")),
            "data": v.get("data") or n.get("data"), "sangrando": bool(n.get("sangrando")),
            "cota": num(n.get("valor")), "cotaSangria": num(r.get("cota_sangria")), "vazao": num(q.get("valor")),
            "rio": r.get("rio_barrado"), "regiao": r.get("regiao_hidrografica"), "ano": num(r.get("ano_construcao")),
        })
    return {"fonte": FONTES["acudes"][0], "url": FONTES["acudes"][1], "coletado": agora(), "itens": itens}


def data_cemaden(s):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{2,4}) (\d{2}):(\d{2})", s or "")
    if not m:
        return None
    ano = "20" + m[3] if len(m[3]) == 2 else m[3]
    return f"{ano}-{m[2]}-{m[1]}T{m[4]}:{m[5]}:00Z"


def pluviometros(txt):
    itens = [{
        "id": e.get("idestacao"), "nome": e.get("nomeestacao"), "codibge": str(e.get("codibge")),
        "cidade": e.get("cidade"), "tipo": e.get("tipoestacao"), "ultimo": num(e.get("ultimovalor")),
        "dataHora": data_cemaden(e.get("datahoraUltimovalor")),
        "acc": {j: num(e.get(f"acc{j}r")) for j in JANELAS},
    } for e in json.loads(txt)]
    return {"fonte": FONTES["pluviometros"][0], "url": FONTES["pluviometros"][1], "coletado": agora(), "itens": itens}


GEO_SVG = {"LON_A": 3084.1711, "LON_B": 119179.9992, "LAT_A": -3219.2287, "LAT_B": -11885.4478}
ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def r5(v):
    # mesmo arredondamento do JavaScript (Math.round: metade para cima)
    import math
    return math.floor(v * 1e5 + 0.5) / 1e5


def svg_para_latlon(x, y):
    return [r5((y - GEO_SVG["LAT_B"]) / GEO_SVG["LAT_A"]), r5((x - GEO_SVG["LON_B"]) / GEO_SVG["LON_A"])]


def caminho_svg(d):
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?", d)
    aneis, atual, x, y, x0, y0, cmd, i = [], None, 0.0, 0.0, 0.0, 0.0, None, 0
    while i < len(tokens):
        if re.fullmatch(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
        if not cmd:
            break
        C = cmd.upper()
        rel, n = cmd != C, ARGS[C]
        if C == "Z":
            if atual is not None:
                atual.append([x0, y0])
                atual = None
            x, y, cmd = x0, y0, None
            continue
        try:
            a = [float(t) for t in tokens[i:i + n]]
        except ValueError:
            break
        if len(a) < n:
            break
        i += n
        if C == "H":
            x = x + a[0] if rel else a[0]
        elif C == "V":
            y = y + a[0] if rel else a[0]
        else:
            x = x + a[n - 2] if rel else a[n - 2]
            y = y + a[n - 1] if rel else a[n - 1]
        if C == "M":
            atual = [[x, y]]
            aneis.append(atual)
            x0, y0 = x, y
            cmd = "l" if rel else "L"
        else:
            if atual is None:
                atual = [[x0, y0]]
                aneis.append(atual)
            atual.append([x, y])
    return [r for r in aneis if len(r) >= 2]


def fortaleza(html_calor, html_hidricos):
    vistas = json.loads(html.unescape(re.search(r'data-vistas="([^"]*)"', html_calor).group(1)))
    por_id = {}
    for e in vistas.get("agora") or []:
        por_id[e["id"]] = {"id": e["id"], "nome": e["nome"], "lat": num(e.get("lat")), "lon": num(e.get("lon")),
                           "agora": {"utci": num(e.get("sensacao")), "nivel": e.get("nivel")}}
    for e in vistas.get("registrada") or []:
        s = por_id.get(e["id"]) or {"id": e["id"], "nome": e["nome"], "lat": num(e.get("lat")), "lon": num(e.get("lon")), "agora": None}
        hora = re.search(r"(\d{1,2}:\d{2})", e.get("rotulo") or "")
        s["maxDia"] = {"utci": num(e.get("sensacao")), "nivel": e.get("nivel"), "hora": hora.group(1) if hora else None}
        por_id[e["id"]] = s
    m = re.search(r'<script[^>]*id="calor-analise-dados"[^>]*>(.*?)</script>', html_calor, re.S | re.I)
    analise = json.loads(m.group(1)) if m else None
    historico = None
    if analise:
        historico = {"datas": analise["datas"][-30:], "estacoes": [
            {"id": e["id"], "nome": e["nome"], "media": e["media"][-30:], "maxima": e["maxima"][-30:]} for e in analise["estacoes"]]}
    hidricos = None
    if html_hidricos:
        scripts = [s.group(1).strip() for s in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html_hidricos, re.S | re.I)]
        bruto = next((s for s in scripts if s.startswith('{"itens"')), None)
        if bruto:
            d = json.loads(bruto)
            hidricos = {"status": d.get("status") or {}, "itens": [{
                "id": it.get("id"), "nome": it.get("nome"), "tipo": it.get("tipo"), "bairro": it.get("bairro"),
                "status": it.get("status"), "ultima": it.get("ultima"), "prazo": it.get("prazo"), "dias": it.get("dias"),
                "frequencia": it.get("frequencia"), "conclusoes": it.get("conclusoes"),
                "geometria": [{"area": bool(g.get("area")), "linhas": [[svg_para_latlon(x, y) for x, y in r] for r in caminho_svg(g.get("d") or "")]}
                              for g in it.get("geometria") or []],
            } for it in d["itens"]]}
    estacoes = list(por_id.values())
    return {"fonte": FONTES["fortaleza-calor"][0], "url": FONTES["fortaleza-calor"][1], "coletado": agora(),
            "niveis": analise.get("niveis") if analise else None, "estacoes": estacoes, "historico": historico,
            "hidricos": hidricos, "itens": estacoes}


def _opcional(fonte):
    try:
        return baixar(fonte)
    except Exception:  # noqa: BLE001
        return None


# rota -> função que monta a resposta
NORMALIZAR = {
    "acudes": lambda: acudes(baixar("acudes")),
    "pluviometros": lambda: pluviometros(baixar("pluviometros")),
    "fortaleza": lambda: fortaleza(baixar("fortaleza-calor"), _opcional("fortaleza-hidricos")),
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def do_GET(self):
        caminho = self.path.split("?")[0]
        m = re.fullmatch(r"/api/(acudes|pluviometros|fortaleza)", caminho) or \
            re.fullmatch(r"/__bruto/(acudes|pluviometros|fortaleza-calor|fortaleza-hidricos)", caminho)
        if not m:
            return super().do_GET()
        fonte = m.group(1)
        try:
            if caminho.startswith("/api/"):
                corpo, tipo = json.dumps(NORMALIZAR[fonte](), ensure_ascii=False).encode("utf-8"), "application/json"
            else:
                corpo, tipo = baixar(fonte).encode("utf-8"), "text/plain"
            self._enviar(200, corpo, tipo)
        except Exception as e:  # noqa: BLE001 — servidor de desenvolvimento
            self._enviar(502, json.dumps({"erro": "Fonte indisponível", "detalhe": str(e)}).encode(), "application/json")

    def _enviar(self, status, corpo, tipo):
        self.send_response(status)
        self.send_header("Content-Type", f"{tipo}; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5173))
    print(f"Atmos Ceará em http://localhost:{porta}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", porta), partial(Handler, directory=str(RAIZ))).serve_forever()
