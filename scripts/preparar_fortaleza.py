"""Gera geo/fortaleza-bairros.geojson a partir dos dados abertos da Prefeitura de Fortaleza.

Fontes (dados.fortaleza.ce.gov.br):
  - Malha de bairros 2025 (SEUMA) .............. licença aberta
  - IDH por bairro (SDE, base Censo 2010) ....... CC BY-SA
  - Dados demográficos por bairro (SDE, 2010) ... CC BY-SA

O arquivo gerado é estático (muda raramente): rode de novo só quando a Prefeitura publicar
uma nova malha ou novos indicadores.  Uso:  python scripts/preparar_fortaleza.py
"""
import io
import json
import re
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "geo" / "fortaleza-bairros.geojson"
BASE = "https://dados.fortaleza.ce.gov.br/dataset"
URL_BAIRROS = f"{BASE}/a90409b9-4c2c-4ad0-bcc0-3e24a381c531/resource/08c58502-965e-4f28-bb6e-b08dab04b788/download/bairros_2025.kmz"
URL_IDH = f"{BASE}/607f1ecf-73b3-4ef1-9a4f-0db2eb8c7b39/resource/f7cf7081-b0e3-4c9c-b89e-0ee1b3755437/download/indicededesenvolvimentohumano.xlsx"
URL_DEMO = f"{BASE}/af6e5400-9f51-4b79-9be5-71dd43fce37c/resource/e3174adb-842b-45c5-8a6d-6563d9a5a7aa/download/dadosdemograficosdefortalezaporbairroeregionalateoanode2010.xlsx"
TOLERANCIA = 0.00022  # graus (~25 m) para simplificar os contornos

# Grafias diferentes entre a malha de 2025 e as planilhas de 2010
APELIDOS = {
    "dende": "edson queiroz",  # Dendê foi desmembrado do Edson Queiroz
    "amadeu furtado": "amadeo furtado",
    "boa vista castelao": "boa vista",
    "ellery": "vila ellery",
    "engenheiro luciano cavalcante": "luciano cavalcante",
    "moura brasil": "arraial moura brasil",
    "parque genibau": "genibau",
    "prefeito jose walter": "prefeito jose valter",
    "tauape": "sao joao do tauape",
    "vicente pinzon": "vincente pinzon",
    "vila peri": "vila pery",
    # Aracapé e Rachel de Queiroz foram criados depois de 2010: sem IDH/demografia.
}


def baixar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AtmosCeara/1.0)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def chave(nome):
    s = unicodedata.normalize("NFD", nome or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def planilha(conteudo):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    z = zipfile.ZipFile(io.BytesIO(conteudo))
    textos = ["".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t"))
              for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)]
    linhas = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{{{ns['m']}}}row"):
        linha = {}
        for c in r.findall("m:c", ns):
            v = c.find("m:v", ns)
            col = re.match(r"[A-Z]+", c.get("r")).group()
            if v is not None:
                linha[col] = textos[int(v.text)] if c.get("t") == "s" else v.text
        linhas.append(linha)
    return linhas


MINUSCULAS = {"de", "do", "da", "dos", "das", "e"}


def titulo(nome):
    """'BOA VISTA-CASTELÃO' -> 'Boa Vista-Castelão'"""
    partes = re.split(r"([ -])", nome.strip().lower())
    return "".join(p if p in " -" or (i and p in MINUSCULAS) else p[:1].upper() + p[1:] for i, p in enumerate(partes))


def num(v, casas=None):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, casas) if casas is not None else x


def simplificar(pontos, tol):
    """Douglas–Peucker. Anéis fechados (primeiro == último) são divididos no ponto mais
    distante do início — sem isso o segmento de referência tem comprimento zero."""
    if len(pontos) < 5:
        return pontos
    if pontos[0] == pontos[-1]:
        x0, y0 = pontos[0]
        k = max(range(len(pontos)), key=lambda i: (pontos[i][0] - x0) ** 2 + (pontos[i][1] - y0) ** 2)
        a = _dp(pontos[: k + 1], tol)
        b = _dp(pontos[k:], tol)
        anel = a + b[1:]
        return anel if len(anel) >= 4 else pontos
    return _dp(pontos, tol)


def _dp(pontos, tol):
    if len(pontos) < 3:
        return pontos
    manter = [False] * len(pontos)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pontos) - 1)]
    while pilha:
        a, b = pilha.pop()
        (x1, y1), (x2, y2) = pontos[a], pontos[b]
        dx, dy = x2 - x1, y2 - y1
        n = (dx * dx + dy * dy) ** 0.5 or 1e-12
        maior, idx = 0, None
        for i in range(a + 1, b):
            x0, y0 = pontos[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / n
            if d > maior:
                maior, idx = d, i
        if idx is not None and maior > tol:
            manter[idx] = True
            pilha += [(a, idx), (idx, b)]
    return [p for p, k in zip(pontos, manter) if k]


def main():
    kml = zipfile.ZipFile(io.BytesIO(baixar(URL_BAIRROS))).read("doc.kml").decode("utf-8")
    k = {"k": "http://www.opengis.net/kml/2.2"}
    raiz = ET.fromstring(kml)

    idh = {}
    for l in planilha(baixar(URL_IDH))[1:]:
        if l.get("B") and l.get("F"):
            idh[chave(l["B"])] = {
                "regional": (l.get("A") or "").title().replace("Regional", "Regional"),
                "idh": num(l.get("F"), 3), "idhEduc": num(l.get("C"), 3),
                "idhLong": num(l.get("D"), 3), "idhRenda": num(l.get("E"), 3),
                "idhRank": int(re.sub(r"\D", "", l.get("G") or "") or 0) or None,
            }
    demo = {}
    for l in planilha(baixar(URL_DEMO))[3:]:
        if l.get("B") and l.get("C"):
            demo[chave(l["B"])] = {
                "pop": int(float(l["C"])), "pop0a14": int(float(l.get("G") or 0)),
                "pop65": int(float(l.get("I") or 0)), "pct65": num(l.get("L"), 1), "pct0a14": num(l.get("J"), 1),
                "moradores": num(l.get("N"), 2),
            }

    feicoes, sem_dados = {}, []
    for pm in raiz.iter(f"{{{k['k']}}}Placemark"):
        dados = {sd.get("name"): (sd.text or "").strip() for sd in pm.iter(f"{{{k['k']}}}SimpleData")}
        nome = dados.get("nome")
        poligonos = []
        for pol in pm.iter(f"{{{k['k']}}}Polygon"):
            aneis = []
            for anel in [pol.find("k:outerBoundaryIs/k:LinearRing/k:coordinates", k)] + pol.findall("k:innerBoundaryIs/k:LinearRing/k:coordinates", k):
                if anel is None:
                    continue
                pts = [tuple(float(v) for v in t.split(",")[:2]) for t in anel.text.split()]
                pts = [[round(x, 5), round(y, 5)] for x, y in simplificar(pts, TOLERANCIA)]
                aneis.append(pts)
            if aneis:
                poligonos.append(aneis)
        if not nome or not poligonos:
            continue  # placemarks só de rótulo
        ch = chave(nome)
        f = feicoes.setdefault(ch, {"type": "Feature", "properties": {"id": dados.get("id"), "nome": titulo(nome)}, "geometry": {"type": "MultiPolygon", "coordinates": []}})
        f["geometry"]["coordinates"] += poligonos
        ref = APELIDOS.get(ch, ch)
        if ref in idh:
            f["properties"].update(idh[ref])
        if ref in demo:
            f["properties"].update(demo[ref])
        if ref not in idh and ch not in sem_dados:
            sem_dados.append(ch)

    SAIDA.parent.mkdir(exist_ok=True)
    fc = {
        "type": "FeatureCollection",
        "fonte": "Prefeitura de Fortaleza — dados.fortaleza.ce.gov.br (malha de bairros 2025/SEUMA; IDH e demografia 2010/SDE, CC BY-SA)",
        "features": sorted(feicoes.values(), key=lambda f: chave(f["properties"]["nome"])),
    }
    SAIDA.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(fc['features'])} bairros -> {SAIDA.relative_to(RAIZ)} ({SAIDA.stat().st_size // 1024} KB)")
    if sem_dados:
        print("Sem IDH/demografia (bairros novos ou grafia diferente):", ", ".join(sem_dados))


if __name__ == "__main__":
    main()
