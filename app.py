# -*- coding: utf-8 -*-
"""
Servidor local do importador de pre-faturas GKO Frete.

Roda com a biblioteca padrao do Python 3 (nada a instalar). Sobe um servidor
HTTP em 127.0.0.1, abre o navegador e serve a aplicacao. O processamento dos
arquivos .TXT e feito aqui, no seu computador; nada e enviado para fora.

Uso:
    python app.py            (abre o navegador automaticamente)
    python app.py --porta 9000 --sem-navegador
"""
import argparse
import datetime
import json
import mimetypes
import os
import re
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import gko_parser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
MAX_BODY = 25 * 1024 * 1024  # 25 MB de arquivos por importacao

# ---------------------------------------------------------------------------
# Banco central no computador-servidor. Guarda as PRE-FATURAS importadas (de
# qualquer PC) e as FATURAS (rascunho/emitida). Persiste em disco, entao
# sobrevive a reload da pagina e a reinicio do servico.
# ---------------------------------------------------------------------------
STORE_DIR = os.path.join(BASE_DIR, "dados")
STORE_PATH = os.path.join(STORE_DIR, "dados.json")
_store_lock = threading.Lock()

# Numeração das faturas. Ajuste aqui se quiser continuar de um número já usado.
NUM_INICIO = 1          # primeiro número da sequência
NUM_DIGITOS = 6         # zeros à esquerda (000001)
NUM_PREFIXO_ANO_MES = True   # prefixa com AA-MM da emissão (ex.: 26-07-000001)


def _agora():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _store_load():
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = {}
    data.setdefault("contador", NUM_INICIO)
    data.setdefault("prefaturas", {})
    data.setdefault("faturas", {})
    return data


def _store_save(data):
    os.makedirs(STORE_DIR, exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, STORE_PATH)


def _formatar_numero(seq, emissao_br):
    serial = str(seq).zfill(NUM_DIGITOS)
    if NUM_PREFIXO_ANO_MES:
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})", emissao_br or "")
        if m:
            return "%s-%s-%s" % (m.group(3)[2:], m.group(2), serial)
    return serial


def _chave(res, pf):
    cnpj = (res.get("transportadora") or {}).get("cnpj", "")
    return cnpj + "#" + str(pf.get("numero", ""))


def persistir_importacao(resultados):
    """Grava cada pre-fatura importada no banco (upsert por chave)."""
    novos, atualizados = 0, 0
    with _store_lock:
        data = _store_load()
        for res in resultados:
            if not res.get("ok"):
                continue
            for pf in res.get("prefaturas", []):
                ch = _chave(res, pf)
                entry = {
                    "chave": ch, "arquivo": res.get("arquivo", ""),
                    "cabecalho": res.get("cabecalho", {}),
                    "transportadora": res.get("transportadora", {}),
                    "documento_id": res.get("documento_id", ""),
                    "totais": res.get("totais", {}),
                    "registros": res.get("registros", []),
                    "pf": pf,
                }
                if ch in data["prefaturas"]:
                    entry["importado_em"] = data["prefaturas"][ch].get("importado_em", _agora())
                    atualizados += 1
                else:
                    entry["importado_em"] = _agora()
                    novos += 1
                data["prefaturas"][ch] = entry
        _store_save(data)
    return {"novos": novos, "atualizados": atualizados}


def prefaturas_listar():
    data = _store_load()
    out = []
    for ch, e in data["prefaturas"].items():
        fat = data["faturas"].get(ch)
        e2 = dict(e)
        e2["fatura_status"] = fat.get("status") if fat else "nenhuma"
        e2["fatura_numero"] = (fat.get("numero") if (fat and fat.get("status") == "emitida") else "")
        out.append(e2)
    out.sort(key=lambda x: x.get("importado_em", ""), reverse=True)
    return {"prefaturas": out}


def _total_itens(itens):
    return sum((it.get("valor") or 0) for it in (itens or []))


def faturas_listar():
    data = _store_load()
    out = []
    for ch, f in data["faturas"].items():
        if f.get("status") != "emitida":
            continue
        f2 = dict(f)
        f2["total"] = _total_itens(f.get("itens"))
        out.append(f2)
    out.sort(key=lambda x: x.get("emitida_em", ""), reverse=True)
    return {"faturas": out}


def fatura_obter(payload):
    """Retorna a fatura da pre-fatura; cria um RASCUNHO (sem numero) na 1a vez."""
    chave = str(payload.get("chave", ""))
    seed = payload.get("seed") or {}
    if not chave:
        return {"erro": "chave ausente"}
    with _store_lock:
        data = _store_load()
        fat = data["faturas"].get(chave)
        if not fat:
            fat = {
                "chave": chave, "numero": "", "status": "rascunho", "emitida_em": "",
                "emissao": seed.get("emissao", ""), "vencimento": seed.get("vencimento", ""),
                "itens": seed.get("itens", []), "contexto": seed.get("contexto", {}),
            }
            data["faturas"][chave] = fat
            _store_save(data)
        return fat


def fatura_salvar(payload):
    chave = str(payload.get("chave", ""))
    with _store_lock:
        data = _store_load()
        fat = data["faturas"].get(chave)
        if not fat:
            return {"erro": "fatura ainda nao inicializada"}
        for campo in ("itens", "emissao", "vencimento", "contexto"):
            if campo in payload:
                fat[campo] = payload[campo]
        data["faturas"][chave] = fat
        _store_save(data)
        return fat


def fatura_emitir(payload):
    """Atribui o numero definitivo (se ainda nao tem) e marca como emitida."""
    chave = str(payload.get("chave", ""))
    with _store_lock:
        data = _store_load()
        fat = data["faturas"].get(chave)
        if not fat:
            return {"erro": "fatura ainda nao inicializada"}
        for campo in ("itens", "emissao", "vencimento", "contexto"):
            if campo in payload:
                fat[campo] = payload[campo]
        if not fat.get("numero"):
            seq = int(data.get("contador", NUM_INICIO))
            fat["numero"] = _formatar_numero(seq, fat.get("emissao", ""))
            fat["seq"] = seq
            data["contador"] = seq + 1
        # Preserva a data da primeira emissão em re-emissões (ao salvar
        # alterações numa fatura já emitida).
        ja_emitida = fat.get("status") == "emitida" and fat.get("emitida_em")
        fat["status"] = "emitida"
        if not ja_emitida:
            fat["emitida_em"] = _agora()
        data["faturas"][chave] = fat
        _store_save(data)
        return fat


def prefatura_excluir(payload):
    chave = str(payload.get("chave", ""))
    with _store_lock:
        data = _store_load()
        data["prefaturas"].pop(chave, None)
        _store_save(data)
        return {"ok": True}


def fatura_excluir(payload):
    chave = str(payload.get("chave", ""))
    with _store_lock:
        data = _store_load()
        data["faturas"].pop(chave, None)
        _store_save(data)
        return {"ok": True}


def _read_static(rel):
    caminho = os.path.normpath(os.path.join(STATIC_DIR, rel.lstrip("/")))
    # commonpath é mais robusto que startswith: evita que "/.../staticX/..."
    # passe quando STATIC_DIR termina em "/static".
    try:
        if os.path.commonpath([STATIC_DIR, caminho]) != STATIC_DIR:
            return None, None
    except ValueError:
        # caminhos em drives diferentes no Windows
        return None, None
    if not os.path.isfile(caminho):
        return None, None
    ctype = mimetypes.guess_type(caminho)[0] or "application/octet-stream"
    with open(caminho, "rb") as fh:
        return fh.read(), ctype


class Handler(BaseHTTPRequestHandler):
    server_version = "PreFaturasGKO/1.0"

    def log_message(self, fmt, *args):  # servidor silencioso no terminal
        pass

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/" or path == "/index.html":
            body, ctype = _read_static("index.html")
            if body is None:
                self._send(500, "index.html nao encontrado")
            else:
                self._send(200, body, "text/html; charset=utf-8")
            return
        if path.startswith("/static/"):
            body, ctype = _read_static(path[len("/static/"):])
            if body is None:
                self._send(404, "Nao encontrado")
            else:
                self._send(200, body, ctype + ("; charset=utf-8"
                           if ctype.startswith("text/") or "javascript" in ctype else ""))
            return
        if path == "/saude":
            self._send(200, json.dumps({"ok": True}), "application/json; charset=utf-8")
            return
        if path == "/api/prefaturas":
            self._send(200, json.dumps(prefaturas_listar(), ensure_ascii=False), "application/json; charset=utf-8")
            return
        if path == "/api/faturas":
            self._send(200, json.dumps(faturas_listar(), ensure_ascii=False), "application/json; charset=utf-8")
            return
        self._send(404, "Nao encontrado")

    do_HEAD = do_GET

    def _ler_json(self):
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            tamanho = 0
        if tamanho <= 0:
            return None, (400, "Corpo vazio.")
        if tamanho > MAX_BODY:
            return None, (413, "Corpo grande demais.")
        raw = self.rfile.read(tamanho)
        try:
            return json.loads(raw.decode("utf-8")), None
        except Exception:
            return None, (400, "Requisicao invalida.")

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        payload, err = self._ler_json()
        if err:
            self._json({"erro": err[1]}, err[0])
            return

        if path == "/api/importar":
            arquivos = payload.get("arquivos")
            if not isinstance(arquivos, list):
                self._json({"erro": "Formato invalido: 'arquivos' deve ser uma lista."}, 400)
                return
            resultados = []
            for arq in arquivos:
                if not isinstance(arq, dict):
                    continue
                nome = str(arq.get("nome", "arquivo.txt"))
                conteudo = arq.get("conteudo", "")
                try:
                    resultados.append(gko_parser.parse_text(nome, conteudo))
                except Exception as exc:  # um arquivo ruim nao derruba os outros
                    resultados.append({"arquivo": nome, "ok": False, "prefaturas": [],
                                       "cabecalho": {}, "transportadora": {}, "totais": {},
                                       "registros": [], "documento_id": "",
                                       "avisos": ["Falha ao ler o arquivo: %s" % exc]})
            resumo = persistir_importacao(resultados)
            self._json({"resultados": resultados, "resumo": resumo})
            return

        if path == "/api/fatura/obter":
            self._json(fatura_obter(payload))
            return
        if path == "/api/fatura/salvar":
            self._json(fatura_salvar(payload))
            return
        if path == "/api/fatura/emitir":
            self._json(fatura_emitir(payload))
            return
        if path == "/api/prefatura/excluir":
            self._json(prefatura_excluir(payload))
            return
        if path == "/api/fatura/excluir":
            self._json(fatura_excluir(payload))
            return

        self._send(404, "Nao encontrado")


def _escolher_porta(inicial):
    import socket
    for porta in range(inicial, inicial + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", porta)) != 0:
                return porta
    return inicial


def _ips_locais():
    """IPs da máquina na rede local, para acesso a partir de outros computadores."""
    import socket
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # não envia nada; só descobre o IP de saída
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


def main():
    ap = argparse.ArgumentParser(description="Gestao de Fretes - Pre-Faturas / Faturas")
    ap.add_argument("--porta", type=int, default=8730)
    ap.add_argument("--host", default="0.0.0.0",
                    help="Interface de escuta. 0.0.0.0 (padrao) libera o acesso na rede; "
                         "use 127.0.0.1 para restringir a este computador.")
    ap.add_argument("--sem-navegador", action="store_true")
    args = ap.parse_args()

    porta = _escolher_porta(args.porta)
    servidor = ThreadingHTTPServer((args.host, porta), Handler)
    url_local = "http://127.0.0.1:%d/" % porta
    na_rede = args.host not in ("127.0.0.1", "localhost")

    print("=" * 60)
    print("  Gestao de Fretes - Pre-Faturas / Faturas")
    print("  Neste computador:  %s" % url_local)
    if na_rede:
        ips = _ips_locais()
        for ip in ips:
            print("  Na rede local:     http://%s:%d/" % (ip, porta))
        if not ips:
            print("  Na rede local:     http://<IP-deste-PC>:%d/" % porta)
        print("  (1a vez no Windows: permita o Python no Firewall, em rede privada.)")
    print("  Para encerrar, pressione Ctrl+C nesta janela.")
    print("=" * 60)

    if not args.sem_navegador:
        threading.Timer(0.6, lambda: webbrowser.open(url_local)).start()

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando...")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
