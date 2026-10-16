# -*- coding: utf-8 -*-
"""
Leitor de arquivos de pre-fatura da interface GKO Frete.

Processo INTPROCEDAPREFAT ("Exportacao de Pre Faturas - ARQ.TEXTO"), layout 1.2A,
arquivo texto de largura fixa. Cada linha comeca com um tipo de registro de 3
posicoes (000, 390, 391, 392, 393, 394, 396, 399).

Funcao principal: parse_text(nome_arquivo, conteudo) -> dict serializavel em JSON.
Nao depende de nada fora da biblioteca padrao.
"""

# ---------------------------------------------------------------------------
# Layout dos registros: (nome_do_campo, tamanho). A ordem importa.
# ---------------------------------------------------------------------------
LAYOUTS = {
    "000": [("TPREGISTRO", 3), ("IDREMETENTE", 35), ("IDDESTINATARIO", 35),
            ("DATA", 6), ("HORA", 4), ("INTERCAMBIO", 12), ("FILLER", 105)],
    "390": [("TPREGISTRO", 3), ("IDDOCUMENTO", 14), ("FILLER", 183)],
    "391": [("TPREGISTRO", 3), ("NOCGCCPF", 15), ("DSINSCRESTADUAL", 15),
            ("EMPRESA", 40), ("FILLER", 127)],
    "392": [("TPREGISTRO", 3), ("NOPREFATURA", 20), ("DTINIEMBARQUE", 8),
            ("DATAPAGAMENTO", 8), ("QTDOCUMENTOS", 4), ("VALORTOTALPREFATURA", 15),
            ("ACAO", 1), ("FILLER", 141)],
    "393": [("TPREGISTRO", 3), ("NOCGCCPF", 15), ("SERIEDOC", 5),
            ("IDENTIFICACAODOC", 20), ("EMISSAODOC", 8), ("CDSERIE", 5),
            ("CDCONHECIMENTO", 12), ("DTEMISSAO", 8), ("CNPJORIGEM", 15),
            ("CNPJDESTINO", 15), ("TPPESSOA", 1), ("VALORFRETEMBARCADOR", 15),
            ("VALORFRETECONHECIMENTO", 15), ("INDICACAODIFERENCA", 1),
            ("VALORDIFERENCAFRETE", 15), ("IDENTIFICACAODOCINTERNO", 15),
            ("FILLER", 32)],
    "394": [("TPREGISTRO", 3), ("FRETEPESO", 15), ("VALORSECCAT", 15),
            ("VALORITR", 15), ("VALORPEDAGIO", 15), ("VROUTROS", 15),
            ("VALORDESCONTO", 15), ("VALORADEME", 15), ("PERCTAXAISS", 15),
            ("VALORISS", 15), ("BASECALCULOICMS", 15), ("PERCTAXAICMS", 15),
            ("VALORICMS", 15), ("FRETEVALOR", 15), ("VALORDESPACHO", 15),
            ("PESOTRANSPORTADO", 15)],
    "396": [("TPREGISTRO", 3)]
           + sum([[("SERIENOTA%d" % i, 3), ("NUMERONOTA%d" % i, 8)]
                  for i in range(1, 16)], [])
           + [("FILLER", 31)],
    "399": [("TPREGISTRO", 3), ("VRTOTALPREFATURAS", 15),
            ("QTTOTALPREFATURAS", 15), ("FILLER", 167)],
}

TITULO_REGISTRO = {
    "000": "Cabecalho do intercambio",
    "390": "Identificacao do documento",
    "391": "Embarcador (sacado)",
    "392": "Pre-fatura",
    "393": "Documento / conhecimento",
    "394": "Valores do documento",
    "396": "Notas fiscais",
    "399": "Totais do arquivo",
}


def _fields(line, tipo):
    layout = LAYOUTS[tipo]
    out, pos = {}, 0
    for name, ln in layout:
        out[name] = line[pos:pos + ln]
        pos += ln
    return out


def _cents(raw):
    """Campo numerico com 2 decimais -> inteiro em centavos, ou None se vazio."""
    s = raw.strip()
    if s == "":
        return None
    if s.isdigit():
        return int(s)
    return None


def _inteiro(raw):
    s = raw.strip()
    if s == "":
        return None
    return int(s) if s.isdigit() else None


def _cnpj(raw):
    d = "".join(ch for ch in raw if ch.isdigit())
    if not d:
        return ""
    d = d.zfill(14)[-14:]
    return "%s.%s.%s/%s-%s" % (d[0:2], d[2:5], d[5:8], d[8:12], d[12:14])


def _ie(raw):
    s = raw.strip()
    return s


def _data8(raw):
    s = raw.strip()
    if len(s) == 8 and s.isdigit():
        return "%s/%s/%s" % (s[0:2], s[2:4], s[4:8])
    return ""


def _data6(raw):
    s = raw.strip()
    if len(s) == 6 and s.isdigit():
        return "%s/%s/20%s" % (s[0:2], s[2:4], s[4:6])
    return ""


def _hora(raw):
    s = raw.strip()
    if len(s) == 4 and s.isdigit():
        return "%s:%s" % (s[0:2], s[2:4])
    return ""


def _tp_pessoa(raw):
    return {"1": "Fisica", "2": "Juridica"}.get(raw.strip(), raw.strip())


def _registros_tecnicos(linhas):
    """Lista todos os registros com seus campos (sem FILLER), para inspecao."""
    regs = []
    for ln in linhas:
        tipo = ln[:3]
        if tipo not in LAYOUTS:
            regs.append({"tipo": tipo, "titulo": "Desconhecido",
                         "campos": [{"nome": "linha", "valor": ln.strip()}]})
            continue
        f = _fields(ln, tipo)
        campos = [{"nome": nome, "valor": f[nome].strip()}
                  for nome, _ in LAYOUTS[tipo] if nome != "FILLER"]
        regs.append({"tipo": tipo, "titulo": TITULO_REGISTRO.get(tipo, ""),
                     "campos": campos})
    return regs


def _valores_394(f):
    return {
        "frete_peso": _cents(f["FRETEPESO"]),
        "seccat": _cents(f["VALORSECCAT"]),
        "itr": _cents(f["VALORITR"]),
        "pedagio": _cents(f["VALORPEDAGIO"]),
        "outros": _cents(f["VROUTROS"]),
        "desconto": _cents(f["VALORDESCONTO"]),
        "ademe": _cents(f["VALORADEME"]),
        "perc_iss": _cents(f["PERCTAXAISS"]),
        "iss": _cents(f["VALORISS"]),
        "base_icms": _cents(f["BASECALCULOICMS"]),
        "perc_icms": _cents(f["PERCTAXAICMS"]),
        "icms": _cents(f["VALORICMS"]),
        "frete_valor": _cents(f["FRETEVALOR"]),
        "despacho": _cents(f["VALORDESPACHO"]),
        "peso": _cents(f["PESOTRANSPORTADO"]),
    }


def parse_text(nome_arquivo, conteudo):
    """Interpreta o conteudo de um arquivo de pre-fatura do GKO.

    Retorna um dicionario com cabecalho, transportadora, a lista de pre-faturas
    (cada uma com seus documentos) e a lista de registros tecnicos. Sempre
    retorna 'ok' + 'avisos'; nunca levanta excecao por conteudo malformado.
    """
    avisos = []
    linhas = [l.rstrip("\r\n") for l in conteudo.split("\n")]
    linhas = [l for l in linhas if l.strip() != ""]

    cabecalho = {}
    documento_id = ""
    transportadora = {}
    totais = {}
    prefaturas = []
    atual_pf = None
    atual_doc = None

    for ln in linhas:
        tipo = ln[:3]
        if tipo not in LAYOUTS:
            avisos.append("Registro nao reconhecido ignorado: tipo '%s'." % tipo)
            continue
        f = _fields(ln, tipo)

        if tipo == "000":
            cabecalho = {
                "remetente": f["IDREMETENTE"].strip(),
                "destinatario": f["IDDESTINATARIO"].strip(),
                "data": _data6(f["DATA"]),
                "hora": _hora(f["HORA"]),
                "intercambio": f["INTERCAMBIO"].strip(),
            }
        elif tipo == "390":
            documento_id = f["IDDOCUMENTO"].strip()
        elif tipo == "391":
            transportadora = {
                "cnpj": _cnpj(f["NOCGCCPF"]),
                "ie": _ie(f["DSINSCRESTADUAL"]),
                "codigo": f["EMPRESA"].strip(),
            }
        elif tipo == "392":
            atual_pf = {
                "numero": (str(_inteiro(f["NOPREFATURA"]))
                           if _inteiro(f["NOPREFATURA"]) is not None
                           else f["NOPREFATURA"].strip()),
                "dt_embarque": _data8(f["DTINIEMBARQUE"]),
                "dt_pagamento": _data8(f["DATAPAGAMENTO"]),
                "qtd_documentos": _inteiro(f["QTDOCUMENTOS"]),
                "valor_total": _cents(f["VALORTOTALPREFATURA"]),
                "acao": f["ACAO"].strip(),
                "documentos": [],
            }
            prefaturas.append(atual_pf)
            atual_doc = None
        elif tipo == "393":
            if atual_pf is None:
                avisos.append("Documento (393) encontrado sem pre-fatura (392) anterior; ignorado.")
                continue
            atual_doc = {
                "identificacao": f["IDENTIFICACAODOC"].strip() or "NOTA FISCAL",
                "cnpj": _cnpj(f["NOCGCCPF"]),
                "serie_doc": f["SERIEDOC"].strip(),
                "emissao_doc": _data8(f["EMISSAODOC"]),
                "cd_serie": f["CDSERIE"].strip(),
                "cd_conhecimento": f["CDCONHECIMENTO"].strip(),
                "dt_emissao": _data8(f["DTEMISSAO"]),
                "cnpj_origem": _cnpj(f["CNPJORIGEM"]),
                "cnpj_destino": _cnpj(f["CNPJDESTINO"]),
                "tp_pessoa": _tp_pessoa(f["TPPESSOA"]),
                "frete_embarcador": _cents(f["VALORFRETEMBARCADOR"]),
                "frete_conhecimento": _cents(f["VALORFRETECONHECIMENTO"]),
                "diferenca": _cents(f["VALORDIFERENCAFRETE"]),
                "doc_interno": f["IDENTIFICACAODOCINTERNO"].strip(),
                "valores": None,
                "notas": [],
            }
            atual_pf["documentos"].append(atual_doc)
        elif tipo == "394":
            v = _valores_394(f)
            if atual_doc is not None:
                atual_doc["valores"] = v
            elif atual_pf is not None:
                atual_pf.setdefault("valores_avulsos", []).append(v)
            else:
                avisos.append("Valores (394) sem documento anterior; ignorado.")
        elif tipo == "396":
            notas = []
            for i in range(1, 16):
                serie = f["SERIENOTA%d" % i].strip()
                num = f["NUMERONOTA%d" % i].strip()
                if num:
                    notas.append({"serie": serie,
                                  "numero": str(int(num)) if num.isdigit() else num})
            if atual_doc is not None:
                atual_doc["notas"] = notas
            elif atual_pf is not None and atual_pf["documentos"]:
                atual_pf["documentos"][-1]["notas"] = notas
        elif tipo == "399":
            totais = {
                "valor_total": _cents(f["VRTOTALPREFATURAS"]),
                "qtd_total": _cents(f["QTTOTALPREFATURAS"]),
            }

    ok = len(prefaturas) > 0
    if not ok:
        avisos.append("Nenhum registro de pre-fatura (392) encontrado neste arquivo.")

    # Agregados uteis por pre-fatura
    for pf in prefaturas:
        docs = pf["documentos"]
        peso = 0
        tem_peso = False
        comp = {}
        for d in docs:
            v = d.get("valores") or {}
            for k, val in v.items():
                if val is None:
                    continue
                if k == "peso":
                    peso += val
                    tem_peso = True
                elif k in ("perc_iss", "perc_icms"):
                    comp[k] = val  # percentual: mantem o ultimo informado
                else:
                    comp[k] = comp.get(k, 0) + val
        pf["peso_total"] = peso if tem_peso else None
        pf["composicao"] = comp

    return {
        "arquivo": nome_arquivo,
        "ok": ok,
        "cabecalho": cabecalho,
        "documento_id": documento_id,
        "transportadora": transportadora,
        "prefaturas": prefaturas,
        "totais": totais,
        "registros": _registros_tecnicos(linhas),
        "avisos": avisos,
    }


if __name__ == "__main__":
    import os
    import sys
    import json
    for caminho in sys.argv[1:]:
        with open(caminho, "r", encoding="latin-1") as fh:
            data = parse_text(os.path.basename(caminho), fh.read())
        print(json.dumps(data, ensure_ascii=False, indent=2))
