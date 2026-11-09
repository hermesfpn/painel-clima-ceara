"""Servidor local de desenvolvimento (sem Node e sem Netlify CLI).

Serve o site e responde /api/acudes e /api/pluviometros com a mesma normalização
de netlify/lib/fontes.mjs. Também expõe /__bruto/<fonte> (resposta original da fonte)
para conferir o coletor JavaScript direto no navegador.

Uso:  python scripts/servidor_local.py [porta]
"""
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


NORMALIZAR = {"acudes": acudes, "pluviometros": pluviometros}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def do_GET(self):
        caminho = self.path.split("?")[0]
        m = re.fullmatch(r"/(api|__bruto)/(acudes|pluviometros)", caminho)
        if not m:
            return super().do_GET()
        tipo, fonte = m.groups()
        try:
            txt = baixar(fonte)
            corpo = (json.dumps(NORMALIZAR[fonte](txt), ensure_ascii=False) if tipo == "api" else txt).encode("utf-8")
            self._enviar(200, corpo, "application/json" if tipo == "api" else "text/plain")
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
