/* Gestão de Fretes — Pré-Faturas / Faturas (front-end, sem dependências) */
(function () {
  "use strict";

  var db = [];            // pré-faturas (vindas do servidor)
  var emitidas = [];      // faturas emitidas (vindas do servidor)
  var view = "loading";   // loading | empty | list | detail | fatura | emitidas
  var filtro = "";
  var filtroEmit = "";
  var pagina = 1, porPagina = 12;
  var selChave = null;
  var _fatSource = null;  // {tipo:"prefatura", entry} | {tipo:"emitida", rec}
  var _fatCtx = null, _saveTimer = null;
  var lastFocus = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var panel = $("#panel");
  var banner = $("#banner");

  // ---------- formatação ----------
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num2(c) {
    if (c == null) return "—";
    return (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money(c) { return c == null ? "—" : "R$ " + num2(c); }
  function inteiro(n) { return n == null ? "—" : String(n); }
  function traco(s) { return (s == null || s === "") ? "—" : esc(s); }
  function _parseCents(str) {
    if (str == null) return null;
    str = String(str).trim().replace(/\s/g, "").replace(/r\$/gi, "").replace(/\./g, "").replace(",", ".");
    if (str === "") return null;
    var v = parseFloat(str);
    return isNaN(v) ? null : Math.round(v * 100);
  }

  // ---------- valor por extenso ----------
  function _ate999(x) {
    var u = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
             "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
    var dez = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
    var cem = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
    if (x === 0) return "";
    if (x === 100) return "cem";
    var partes = [], c = Math.floor(x / 100), r = x % 100;
    if (c > 0) partes.push(cem[c]);
    if (r > 0) {
      if (r < 20) partes.push(u[r]);
      else { var d = Math.floor(r / 10), un = r % 10; partes.push(dez[d] + (un > 0 ? " e " + u[un] : "")); }
    }
    return partes.join(" e ");
  }
  function _numExtenso(n) {
    if (n === 0) return "zero";
    if (n < 1000) return _ate999(n);
    var mi = Math.floor(n / 1000000), mil = Math.floor((n % 1000000) / 1000), resto = n % 1000, chunks = [];
    if (mi > 0) chunks.push(_ate999(mi) + (mi === 1 ? " milhão" : " milhões"));
    if (mil > 0) chunks.push(mil === 1 ? "mil" : _ate999(mil) + " mil");
    var out = chunks.join(", ");
    if (resto > 0) { var con = out === "" ? "" : (resto < 100 || resto % 100 === 0) ? " e " : " "; out += con + _ate999(resto); }
    return out;
  }
  function extenso(cents) {
    if (cents == null) return "—";
    var reais = Math.floor(cents / 100), cent = cents % 100;
    var s = _numExtenso(reais) + (reais === 1 ? " real" : " reais");
    if (cent > 0) s += " e " + _numExtenso(cent) + (cent === 1 ? " centavo" : " centavos");
    return s.toUpperCase();
  }
  function _yymm(dataBr) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr || "");
    if (!m) { var d = new Date(); return String(d.getFullYear()).slice(2) + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
    return m[3].slice(2) + "-" + m[2];
  }
  function _hoje() {
    var d = new Date();
    return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
  }

  // ---------- carregamento do servidor ----------
  function _offline() {
    setBanner("err", "Sem conexão com o servidor.",
      ["Verifique se o app.py está rodando no computador-servidor e recarregue a página."]);
  }
  function carregarPrefaturas(cb) {
    fetch("/api/prefaturas").then(function (r) { return r.json(); }).then(function (d) {
      db = (d.prefaturas || []).map(function (e) { e.id = e.chave; return e; });
      if (cb) cb(true);
    }).catch(function () { _offline(); if (cb) cb(false); });
  }
  function carregarEmitidas(cb) {
    fetch("/api/faturas").then(function (r) { return r.json(); }).then(function (d) {
      emitidas = d.faturas || [];
      if (cb) cb(true);
    }).catch(function () { _offline(); if (cb) cb(false); });
  }

  // ---------- importação ----------
  function lerArquivo(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve({ nome: file.name, conteudo: String(r.result) }); };
      r.onerror = function () { resolve({ nome: file.name, conteudo: "", _erro: true }); };
      r.readAsText(file, "ISO-8859-1");
    });
  }
  function importar(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    limparBanner();
    view = "loading"; render();
    Promise.all(files.map(lerArquivo)).then(function (payload) {
      return fetch("/api/importar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivos: payload })
      });
    }).then(function (r) { if (!r.ok) throw new Error("Falha no servidor (" + r.status + ")."); return r.json(); })
      .then(function (data) {
        var resultados = data.resultados || [], resumo = data.resumo || {};
        var falhas = [], avisos = [];
        resultados.forEach(function (res) {
          if (!res.ok || !(res.prefaturas || []).length) {
            falhas.push(res.arquivo);
            (res.avisos || []).forEach(function (a) { avisos.push(res.arquivo + ": " + a); });
          }
        });
        carregarPrefaturas(function () {
          pagina = 1; view = db.length ? "list" : "empty"; render();
          var n = (resumo.novos || 0), at = (resumo.atualizados || 0);
          if (n || at) {
            var msg = [];
            if (n) msg.push(n + (n === 1 ? " pré-fatura nova" : " pré-faturas novas"));
            if (at) msg.push(at + (at === 1 ? " atualizada" : " atualizadas"));
            setBanner(falhas.length ? "warn" : "ok", msg.join(" · ") + ".",
              falhas.length ? ["Sem pré-faturas em: " + falhas.join(", ")].concat(avisos.slice(0, 3)) : []);
          } else {
            setBanner("err", "Nenhuma pré-fatura encontrada nos arquivos.",
              falhas.length ? ["Arquivos sem registro 392: " + falhas.join(", ")] : avisos.slice(0, 5));
          }
        });
      }).catch(function (err) {
        view = db.length ? "list" : "empty"; render();
        setBanner("err", "Não foi possível importar", [String(err.message || err)]);
      });
  }

  // ---------- banner ----------
  function setBanner(tipo, titulo, itens) {
    var lista = (itens && itens.length) ? "<ul>" + itens.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "";
    banner.innerHTML = '<div class="banner ' + tipo + '"><div><p>' + esc(titulo) + "</p>" + lista +
      '</div><button type="button" class="banner-x" aria-label="Dispensar">×</button></div>';
    var x = $(".banner-x", banner); if (x) x.onclick = limparBanner;
  }
  function limparBanner() { banner.innerHTML = ""; }

  // ---------- filtro (pré-faturas) ----------
  function textoBusca(e) {
    var pf = e.pf, docs = pf.documentos || [];
    var notas = docs.map(function (d) { return (d.notas || []).map(function (n) { return n.numero; }).join(" "); }).join(" ");
    var cnpjs = docs.map(function (d) { return d.cnpj_origem + " " + d.cnpj_destino; }).join(" ");
    return [pf.numero, e.arquivo, e.cabecalho.destinatario, e.transportadora.cnpj, e.fatura_numero, notas, cnpjs].join(" ").toLowerCase();
  }
  function filtradas() {
    if (!filtro) return db;
    var f = filtro.toLowerCase();
    return db.filter(function (e) { return textoBusca(e).indexOf(f) >= 0; });
  }

  // ---------- cabeçalho do módulo + nav ----------
  function _mh(title, sub, showImport) {
    var t = $("#mhTitle"), s = $("#mhSub"), a = $("#mhActions");
    if (t) t.textContent = title;
    if (s) s.textContent = sub;
    if (a) a.hidden = !showImport;
  }
  function _navAtivo(which) {
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item[data-nav]"), function (a) {
      var on = a.getAttribute("data-nav") === which;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  // ---------- render router ----------
  function render() {
    var subPref = "Importação e conferência de pré-faturas exportadas do GKO Frete (interface INTPROCEDAPREFAT).";
    var subEmit = "Faturas comerciais geradas a partir das pré-faturas.";
    var ctxEmit = (view === "emitidas") || (view === "fatura" && _fatSource && _fatSource.tipo === "emitida");
    if (ctxEmit) { _mh("Faturas emitidas", subEmit, false); _navAtivo("emitidas"); }
    else { _mh("Pré-Faturas", subPref, (view === "list" || view === "empty")); _navAtivo("prefaturas"); }

    if (view === "loading") return renderLoading();
    if (view === "empty") return renderEmpty();
    if (view === "detail") return renderDetail();
    if (view === "fatura") return renderFatura();
    if (view === "emitidas") return renderEmitidas();
    return renderList();
  }

  function renderLoading() {
    panel.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Carregando…</div>';
  }

  function renderEmpty() {
    panel.innerHTML =
      '<div class="empty">' +
        "<h2>Nenhum arquivo importado</h2>" +
        "<p>Selecione os arquivos de pré-fatura (.TXT) exportados do GKO Frete para visualizar, conferir e faturar.</p>" +
        '<div class="dropzone" id="dz"><strong>Clique para selecionar</strong> ou arraste os arquivos .TXT aqui</div>' +
        '<p class="empty-hint">As pré-faturas ficam salvas no servidor e aparecem para todos os computadores da rede.</p>' +
      "</div>";
    var dz = $("#dz");
    dz.onclick = function () { $("#fileInput").click(); };
    ["dragenter", "dragover"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); }); });
    dz.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) importar(e.dataTransfer.files); });
  }

  // ---------- lista de pré-faturas ----------
  function _badge(status, numero) {
    if (status === "emitida") return '<span class="tag tag-ok">Faturada ' + esc(numero || "") + "</span>";
    if (status === "rascunho") return '<span class="tag tag-draft">Rascunho</span>';
    return '<span class="cell-muted">—</span>';
  }
  function renderList() {
    if (!db.length) return renderEmpty();
    var itens = filtradas(), total = itens.length;
    var somaCents = itens.reduce(function (a, e) { return a + (e.pf.valor_total || 0); }, 0);
    var maxPag = Math.max(1, Math.ceil(total / porPagina));
    if (pagina > maxPag) pagina = maxPag;
    var ini = (pagina - 1) * porPagina, slice = itens.slice(ini, ini + porPagina);

    var linhas = slice.map(function (e) {
      var pf = e.pf, docs = (pf.documentos && pf.documentos.length) || pf.qtd_documentos || 0;
      return '<tr class="clickable" tabindex="0" data-chave="' + esc(e.chave) + '">' +
        '<td class="cell-strong mono">' + esc(pf.numero) + "</td>" +
        '<td class="mono">' + traco(e.transportadora.cnpj) + "</td>" +
        "<td>" + traco(pf.dt_embarque) + "</td>" +
        '<td class="num">' + docs + "</td>" +
        '<td class="num">' + num2(pf.peso_total) + "</td>" +
        '<td class="num cell-strong">' + num2(pf.valor_total) + "</td>" +
        "<td>" + _badge(e.fatura_status, e.fatura_numero) + "</td>" +
        '<td class="cell-muted">' + esc(e.arquivo.replace(/\.txt$/i, "")) + "</td>" +
        '<td class="acao-col"><button type="button" class="row-del" title="Excluir pré-fatura" aria-label="Excluir">×</button></td>' +
      "</tr>";
    }).join("");

    var corpo = total ? linhas : '<tr><td colspan="9" class="table-empty">Nenhuma pré-fatura corresponde ao filtro “' + esc(filtro) + "”.</td></tr>";
    var de = total ? (ini + 1) : 0, ate = Math.min(ini + porPagina, total);

    panel.innerHTML =
      '<div class="filterbar">' +
        '<div class="searchwrap"><input type="search" id="busca" placeholder="Filtrar por nº, CNPJ, nota, fatura…" value="' + esc(filtro) + '" autocomplete="off"></div>' +
        '<div class="result-count">' + total + (total === 1 ? " pré-fatura" : " pré-faturas") + " · " + money(somaCents) + "</div>" +
      "</div>" +
      '<div class="table-wrap"><table class="grid">' +
        "<thead><tr><th>Nº Pré-Fatura</th><th>Cliente (CNPJ)</th><th>Embarque</th><th class='num'>Docs</th>" +
        "<th class='num'>Peso (kg)</th><th class='num'>Valor total (R$)</th><th>Situação</th><th>Arquivo</th><th class='acao-col'></th></tr></thead>" +
        "<tbody>" + corpo + "</tbody>" +
      "</table></div>" +
      (total > porPagina ? '<div class="pagination"><span class="pg-info">' + de + "–" + ate + " de " + total + "</span>" +
        '<button type="button" class="btn btn-secondary btn-sm" id="pgPrev"' + (pagina <= 1 ? " disabled" : "") + ">‹ Anterior</button>" +
        '<button type="button" class="btn btn-secondary btn-sm" id="pgNext"' + (pagina >= maxPag ? " disabled" : "") + ">Próxima ›</button></div>" : "");

    var busca = $("#busca");
    busca.oninput = function () { filtro = busca.value; pagina = 1; var pos = busca.selectionStart; renderList(); var b = $("#busca"); if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (e) {} } };
    Array.prototype.forEach.call(panel.querySelectorAll("tr.clickable"), function (tr) {
      var ch = tr.getAttribute("data-chave");
      tr.onclick = function (ev) { if (ev.target.closest(".row-del")) return; abrirDetalhe(ch); };
      tr.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrirDetalhe(ch); } };
      var del = tr.querySelector(".row-del");
      if (del) del.onclick = function (ev) { ev.stopPropagation(); excluirPrefatura(ch); };
    });
    var prev = $("#pgPrev"), next = $("#pgNext");
    if (prev) prev.onclick = function () { if (pagina > 1) { pagina--; renderList(); } };
    if (next) next.onclick = function () { if (pagina < maxPag) { pagina++; renderList(); } };
  }

  function excluirPrefatura(chave) {
    var e = db.filter(function (x) { return x.chave === chave; })[0];
    if (!e) return;
    if (!window.confirm("Excluir a pré-fatura nº " + e.pf.numero + " da lista?\n(Uma fatura já emitida não é afetada.)")) return;
    fetch("/api/prefatura/excluir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave: chave }) })
      .then(function () { carregarPrefaturas(function () { view = db.length ? "list" : "empty"; render(); }); });
  }

  function abrirDetalhe(chave) { selChave = chave; view = "detail"; render(); window.scrollTo(0, 0); }

  // ---------- detalhe da pré-fatura ----------
  function dlItem(label, valor) { return '<div class="dl-item"><div class="dl-label">' + esc(label) + '</div><div class="dl-value">' + valor + "</div></div>"; }
  function kvRow(label, valor, muted) { return "<tr" + (muted ? ' class="muted"' : "") + "><td>" + esc(label) + "</td><td>" + valor + "</td></tr>"; }

  function renderDetail() {
    var e = db.filter(function (x) { return x.chave === selChave; })[0];
    if (!e) { view = "list"; return renderList(); }
    var pf = e.pf, c = e.cabecalho, t = e.transportadora, docs = pf.documentos || [], comp = pf.composicao || {};
    var somaFrete = ["frete_peso", "seccat", "itr", "pedagio", "outros", "ademe", "frete_valor", "despacho"]
      .reduce(function (a, k) { return a + (comp[k] || 0); }, 0) - (comp.desconto || 0);
    var confere = (pf.valor_total != null) && (somaFrete === pf.valor_total);
    var difer = (pf.valor_total != null) ? (somaFrete - pf.valor_total) : null;

    var linhasDoc = docs.map(function (d) {
      var nf = (d.notas || []).map(function (n) { return esc(n.numero) + (n.serie ? "/" + esc(n.serie) : ""); }).join(", ") || "—";
      return "<tr>" +
        "<td>" + traco(d.identificacao) + (d.cd_conhecimento ? '<br><span class="cell-muted">CT-e ' + esc(d.cd_conhecimento) + "</span>" : "") + "</td>" +
        '<td class="mono">' + nf + "</td>" +
        '<td class="mono">' + traco(d.cnpj_origem) + "</td>" +
        '<td class="mono">' + traco(d.cnpj_destino) + "</td>" +
        '<td class="num">' + num2(d.valores ? d.valores.peso : null) + "</td>" +
        '<td class="num">' + num2(d.frete_embarcador) + "</td>" +
        '<td class="num">' + num2(d.frete_conhecimento) + "</td>" +
      "</tr>";
    }).join("");

    var blocoFrete = "<table class='kv'>" +
      kvRow("Frete-peso", num2(comp.frete_peso)) + kvRow("Pedágio", num2(comp.pedagio)) +
      kvRow("Sec/Cat", num2(comp.seccat)) + kvRow("ITR / GRIS", num2(comp.itr)) +
      kvRow("Ad valorem (frete-valor)", num2(comp.frete_valor)) + kvRow("Despacho", num2(comp.despacho)) +
      kvRow("Ademe", num2(comp.ademe)) + kvRow("Outros", num2(comp.outros)) + kvRow("(-) Desconto", num2(comp.desconto)) + "</table>";
    var blocoTrib = "<table class='kv'>" +
      kvRow("Base de cálculo ICMS", num2(comp.base_icms)) + kvRow("ICMS", num2(comp.icms)) +
      kvRow("ISS", num2(comp.iss)) + kvRow("Peso transportado (kg)", num2(pf.peso_total)) +
      kvRow("Diferença de frete", num2(comp.diferenca)) + "</table>";
    var confHtml = (pf.valor_total == null) ? "" : (confere
      ? '<span class="tag tag-ok">Valores conferem</span>'
      : '<span class="tag tag-warn">Divergência: R$ ' + num2(Math.abs(difer)) + "</span>");
    var jaFat = e.fatura_status === "emitida";

    panel.innerHTML =
      '<div class="detail-toolbar no-print">' +
        '<div class="left"><button type="button" class="btn btn-secondary btn-sm" id="btnVoltar">‹ Voltar</button>' + (jaFat ? ' <span class="tag tag-ok" style="margin-left:8px">Faturada ' + esc(e.fatura_numero) + '</span>' : '') + "</div>" +
        '<div class="right">' +
          '<button type="button" class="btn-link" id="btnTec">Ver registros técnicos</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="btnImprimir">Imprimir pré-fatura</button>' +
          '<button type="button" class="btn btn-primary btn-sm" id="btnFatura">' + (jaFat ? "Abrir fatura" : "Gerar fatura") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="doc" id="doc">' +
        '<div class="doc-head"><div class="kicker">Pré-fatura de frete</div>' +
          '<div class="title-row"><h2>Nº ' + esc(pf.numero) + "</h2>" +
            '<div class="doc-meta">Arquivo: ' + esc(e.arquivo) + "<br>" + (c.data ? "Gerado em " + esc(c.data) + (c.hora ? " " + esc(c.hora) : "") : "") + "</div></div></div>" +
        '<div class="doc-section"><div class="two-col">' +
          '<div><div class="sec-title">Cliente / embarcador (sacado)</div><div class="dl">' +
            dlItem("CNPJ", '<span class="mono">' + traco(t.cnpj) + "</span>") + dlItem("Inscrição estadual", traco(t.ie)) + dlItem("Código", traco(t.codigo)) + "</div></div>" +
          '<div><div class="sec-title">Intercâmbio (GKO)</div><div class="dl">' +
            dlItem("Remetente", traco(c.remetente)) + dlItem("Destinatário", traco(c.destinatario)) + dlItem("Documento", traco(e.documento_id)) + dlItem("Intercâmbio", traco(c.intercambio)) + "</div></div>" +
        "</div></div>" +
        '<div class="doc-section"><div class="sec-title">Dados da pré-fatura</div><div class="dl">' +
          dlItem("Número", '<span class="mono">' + esc(pf.numero) + "</span>") + dlItem("Início do embarque", traco(pf.dt_embarque)) +
          dlItem("Previsão de pagamento", traco(pf.dt_pagamento)) + dlItem("Qtd. de documentos", inteiro(pf.qtd_documentos != null ? pf.qtd_documentos : docs.length)) + "</div></div>" +
        '<div class="doc-section"><div class="sec-title">Documentos</div><div class="table-wrap"><table class="grid">' +
          "<thead><tr><th>Documento</th><th>Nota fiscal / série</th><th>CNPJ origem</th><th>CNPJ destino</th><th class='num'>Peso (kg)</th><th class='num'>Frete embarc.</th><th class='num'>Frete conhec.</th></tr></thead>" +
          "<tbody>" + (linhasDoc || '<tr><td colspan="7" class="table-empty">Sem documentos.</td></tr>') + "</tbody></table></div></div>" +
        '<div class="doc-section"><div class="sec-title">Composição de valores</div><div class="valores">' +
          '<div class="vbloco"><div class="cell-muted" style="margin-bottom:6px;font-size:11px;">FRETE (R$)</div>' + blocoFrete + "</div>" +
          '<div class="vbloco"><div class="cell-muted" style="margin-bottom:6px;font-size:11px;">TRIBUTOS E INFORMAÇÕES</div>' + blocoTrib + "</div></div></div>" +
        '<div class="total-row"><span class="lbl">Total da pré-fatura</span><span style="display:flex;align-items:center;gap:12px;">' + confHtml +
          '<span class="val">' + money(pf.valor_total) + "</span></span></div>" +
      "</div>";

    $("#btnVoltar").onclick = function () { view = "list"; render(); };
    $("#btnImprimir").onclick = function () { window.print(); };
    $("#btnTec").onclick = function () { abrirModalTecnico(e); };
    $("#btnFatura").onclick = function () { _fatSource = { tipo: "prefatura", entry: e }; view = "fatura"; render(); window.scrollTo(0, 0); };
  }

  // ---------- resolução de filial/sacado ----------
  function resolverPartes(e) {
    var cad = window.CADASTROS || { emitente: { filiais: {} }, sacados: {} };
    var cnpjEmb = (e.transportadora && e.transportadora.cnpj) || "";
    var sacado = cad.sacados[cnpjEmb] || null;
    var uf = sacado ? sacado.uf : null;
    if (!uf) {
      var hay = ((e.cabecalho && e.cabecalho.destinatario) || "") + " " + (e.arquivo || "");
      if (/\bES\b/.test(hay)) uf = "ES"; else if (/\bSP\b/.test(hay)) uf = "SP";
    }
    var filial = uf ? cad.emitente.filiais[uf] : null;
    return { uf: uf, sacado: sacado, filial: filial, razao: cad.emitente.razao, site: cad.emitente.site, cnpjEmb: cnpjEmb, ieEmb: (e.transportadora && e.transportadora.ie) || "" };
  }

  // ---------- fatura ----------
  function _toolbarFat(status, source) {
    var emitBtn = (status !== "emitida") ? '<button type="button" class="btn btn-primary btn-sm" id="btnGerar">Gerar fatura</button>' : "";
    return '<div class="detail-toolbar no-print">' +
      '<div class="left"><button type="button" class="btn btn-secondary btn-sm" id="btnVoltarFat">‹ Voltar</button></div>' +
      '<div class="right"><span id="ftStatus" class="ft-status"></span>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="btnImprimirFat">Imprimir / Salvar PDF</button>' + emitBtn + "</div>" +
      "</div>";
  }

  function renderFatura() {
    if (!_fatSource) { view = "list"; return renderList(); }
    if (_fatSource.tipo === "emitida") {
      var rec = _fatSource.rec;
      _fatCtx = {
        chave: rec.chave, numero: rec.numero || "", status: rec.status || "emitida", emitida_em: rec.emitida_em || "",
        dataEmissao: rec.emissao || _hoje(), venc: rec.vencimento || "", itens: _mapItens(rec.itens), ctx: rec.contexto || {}
      };
      return desenharFatura();
    }
    // origem: pré-fatura
    var entry = _fatSource.entry, pf = entry.pf, docs = pf.documentos || [], p = resolverPartes(entry);
    if (!p.filial) {
      panel.innerHTML = _toolbarFat("rascunho", _fatSource) +
        '<div class="empty"><h2>Não foi possível identificar a filial emitente</h2>' +
        "<p>O CNPJ do embarcador (" + traco(p.cnpjEmb) + ") não está em <span class='mono'>static/cadastros.js</span>.</p></div>";
      $("#btnVoltarFat").onclick = function () { view = "detail"; render(); };
      return;
    }
    var dataEmissao = (entry.cabecalho && entry.cabecalho.data) || _hoje();
    var venc = pf.dt_pagamento || "";
    var contexto = { razao: p.razao, site: p.site, filial: p.filial, sacado: p.sacado, cnpjEmb: p.cnpjEmb, ieEmb: p.ieEmb, prefaturaNumero: pf.numero, prefaturaTotal: pf.valor_total, arquivo: entry.arquivo };
    var seedItens = docs.map(function (d) {
      var valor = (d.frete_conhecimento != null) ? d.frete_conhecimento : (d.frete_embarcador != null ? d.frete_embarcador : null);
      return { cte: "", serie: "", tipo: "", emissao: (d.dt_emissao || pf.dt_embarque || ""), origem: "", destino: "",
               nfe: (d.notas || []).map(function (n) { return n.numero; }).join(", "), icms: (d.valores ? d.valores.icms : null), valor: valor };
    });
    panel.innerHTML = _toolbarFat("rascunho", _fatSource) + '<div class="loading"><span class="spinner" aria-hidden="true"></span>Carregando fatura…</div>';
    $("#btnVoltarFat").onclick = function () { view = "detail"; render(); };

    fetch("/api/fatura/obter", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave: entry.chave, seed: { emissao: dataEmissao, vencimento: venc, itens: seedItens, contexto: contexto } }) })
      .then(function (r) { return r.json(); }).then(function (fat) {
        if (fat.erro) throw new Error(fat.erro);
        var ctx = (fat.contexto && fat.contexto.filial) ? fat.contexto : contexto;
        _fatCtx = { chave: entry.chave, numero: fat.numero || "", status: fat.status || "rascunho", emitida_em: fat.emitida_em || "",
                    dataEmissao: fat.emissao || dataEmissao, venc: fat.vencimento || venc, itens: _mapItens(fat.itens), ctx: ctx };
        desenharFatura();
      }).catch(function (err) {
        panel.innerHTML = _toolbarFat("rascunho", _fatSource) + '<div class="empty"><h2>Não foi possível carregar a fatura</h2><p>' + esc(String(err.message || err)) + "</p></div>";
        $("#btnVoltarFat").onclick = function () { view = "detail"; render(); };
      });
  }
  function _mapItens(arr) {
    return (arr || []).map(function (it) {
      return { cte: it.cte || "", serie: it.serie || "", tipo: it.tipo || "", emissao: it.emissao || "", origem: it.origem || "",
               destino: it.destino || "", nfe: it.nfe || "", icms: (it.icms == null ? null : it.icms), valor: (it.valor == null ? null : it.valor) };
    });
  }

  function desenharFatura() {
    var c = _fatCtx, ctx = c.ctx || {}, f = ctx.filial || {}, s = ctx.sacado || null;
    var razao = ctx.razao || "", site = ctx.site || "";
    var sacNome = s ? s.nome : "—", sacEnd = s ? (s.endereco + " - " + s.cidade) : "—",
        sacCnpj = s ? s.cnpj : (ctx.cnpjEmb || "—"), sacIe = s ? s.ie : (ctx.ieEmb || "—"),
        sacPraca = s ? s.praca : "—", sacCep = s ? s.cep : "—";
    var emitida = c.status === "emitida";
    var numeroTxt = c.numero ? esc(c.numero) : "(ao gerar)";
    var emissaoCell = emitida ? esc(c.dataEmissao)
      : '<input type="text" class="ft-inp ft-date" id="ftEmissao" value="' + esc(c.dataEmissao) + '" placeholder="dd/mm/aaaa">';
    var vencCell = emitida ? esc(c.venc || "—")
      : '<input type="text" class="ft-inp ft-date" id="ftVenc" value="' + esc(c.venc || "") + '" placeholder="dd/mm/aaaa">';

    panel.innerHTML = _toolbarFat(c.status, _fatSource) +
      (emitida ? '<div class="ft-emitida-bar no-print">Fatura nº <b>' + esc(c.numero) + "</b> — emitida em " + esc((c.emitida_em || "").slice(0, 10).split("-").reverse().join("/")) + "</div>" : "") +
      '<div class="fatura" id="fatura">' +
        '<div class="ft-top">' +
          '<div class="ft-logo"><img src="/static/logo-coopertruni.png" alt="Coopertruni"></div>' +
          '<div class="ft-emit"><div class="ft-razao">' + esc(razao) + "</div><div class=\"ft-emit-det\">" +
            "TELEFAX: " + esc(f.telefax || "") + " &nbsp; " + esc(f.endereco || "") + "<br>" +
            "CEP: " + esc(f.cep || "") + " - " + esc(f.cidade || "") + " &nbsp;·&nbsp; CNPJ: " + esc(f.cnpj || "") + " &nbsp;·&nbsp; I.E.: " + esc(f.ie || "") + "<br>" +
            esc(site) + " &nbsp;·&nbsp; " + esc(f.email || "") + "</div></div>" +
          '<div class="ft-emissao"><span>DATA EMISSÃO</span><strong>' + emissaoCell + "</strong></div>" +
        "</div>" +
        '<div class="ft-dup"><div class="ft-dup-main"><table class="ft-kgrid">' +
          "<tr class='lbl'><td>VALOR DA PRESTAÇÃO</td><td>NÚMERO / SÉRIE</td><td>VALOR A RECEBER</td><td>NÚMERO ORDEM</td><td>VENCIMENTO</td></tr>" +
          "<tr class='val'><td id='ftVprest'></td><td class='mono'>" + numeroTxt + "</td><td id='ftVreceb'></td><td class='mono'>" + numeroTxt + "</td><td class='mono'>" + vencCell + "</td></tr>" +
          "<tr class='lbl'><td>TAXA ADM</td><td>VALOR LÍQUIDO A RECEBER</td><td>VALOR NÃO TRIBUTADO</td><td>BASE DE CÁLCULO IRRF</td><td>IRRF</td></tr>" +
          "<tr class='val'><td>0,00</td><td id='ftVliq'></td><td id='ftVnt'></td><td>R$ 0,00</td><td>R$ 0,00</td></tr>" +
        "</table></div><div class=\"ft-dup-inst\"><div class=\"ft-inst-lbl\">PARA USO DA INSTITUIÇÃO FINANCEIRA</div><div class=\"ft-inst-body\">" + esc(razao) + "</div></div></div>" +
        '<div class="ft-cond">DESCONTO DE R$ 0,00.<br>CONDIÇÕES ESPECIAIS:</div>' +
        '<div class="ft-sacado"><div class="ft-side">' + esc(razao) + "</div><div class=\"ft-sacado-body\">" +
          "<div><b>SACADO:</b> " + esc(sacNome) + "</div><div><b>ENDEREÇO:</b> " + esc(sacEnd) + "</div>" +
          "<div><b>CNPJ:</b> <span class='mono'>" + esc(sacCnpj) + "</span> &nbsp;/&nbsp; <b>IE:</b> <span class='mono'>" + esc(sacIe) + "</span></div>" +
          "<div><b>PRAÇA PAGAMENTO:</b> " + esc(sacPraca) + " &nbsp;·&nbsp; <b>CEP:</b> " + esc(sacCep) + "</div>" +
          '<div class="ft-extenso"><b>VALOR POR EXTENSO:</b> <span id="ftExtenso"></span></div>' +
          '<div class="ft-legal">Reconheço(emos) a exatidão desta fatura de venda mercantil, na importância acima que pagarei(emos) à ' + esc(razao) + ", ou à sua ordem, na praça e vencimento indicado(s).</div>" +
          '<div class="ft-assin"><div><div class="ft-line"></div>DATA DO ACEITE</div><div><div class="ft-line"></div>ASSINATURA DO SACADO</div></div>' +
        "</div></div>" +
        '<div class="table-wrap ft-itens"><table class="grid">' +
          "<thead><tr><th>CTe</th><th>Série</th><th>Tipo</th><th>Emissão</th><th>Origem</th><th>Destino</th><th>NF-e</th><th class='num'>ICMS</th><th class='num'>Valor total</th><th class='no-print ft-acao-h'></th></tr></thead>" +
          '<tbody id="ftBody"></tbody>' +
          "<tfoot><tr><td colspan='8'>QTD: <span id='ftQtd'></span></td><td class='num' id='ftFootTotal'></td><td class='no-print'></td></tr></tfoot>" +
        "</table></div>" +
        '<div class="ft-add no-print"><button type="button" class="btn btn-secondary btn-sm" id="btnAddLinha">+ Adicionar linha</button></div>' +
        '<div id="ftDiverg" class="ft-diverg no-print" hidden></div>' +
      "</div>";

    $("#btnVoltarFat").onclick = function () {
      if (_fatSource && _fatSource.tipo === "emitida") { view = "emitidas"; render(); }
      else { view = "detail"; render(); }
    };
    $("#btnImprimirFat").onclick = function () { salvarFatura().then(function () { window.print(); }); };
    var g = $("#btnGerar"); if (g) g.onclick = emitirFatura;
    $("#btnAddLinha").onclick = adicionarLinha;
    var em = $("#ftEmissao"); if (em) em.addEventListener("change", function () { _fatCtx.dataEmissao = em.value.trim(); _agendarSalvar(); });
    var vc = $("#ftVenc"); if (vc) vc.addEventListener("change", function () { _fatCtx.venc = vc.value.trim(); _agendarSalvar(); });
    renderItensBody(); recomputeTotais();
  }

  function _cellText(i, campo, val, ph) {
    return '<td><input type="text" class="ft-inp" data-i="' + i + '" data-campo="' + campo + '" value="' + esc(val) + '" placeholder="' + ph + '"></td>';
  }
  function _cellMoney(i, campo, cents) {
    return '<td class="num"><input type="text" class="ft-inp ft-num" inputmode="decimal" data-i="' + i + '" data-campo="' + campo + '" value="' + (cents == null ? "" : num2(cents)) + '" placeholder="0,00"></td>';
  }
  function renderItensBody() {
    var body = $("#ftBody"), its = _fatCtx.itens;
    if (!its.length) { body.innerHTML = '<tr><td colspan="10" class="table-empty">Nenhuma linha. Use “+ Adicionar linha”.</td></tr>'; return; }
    body.innerHTML = its.map(function (it, i) {
      return '<tr data-i="' + i + '">' +
        _cellText(i, "cte", it.cte, "nº CTe") + _cellText(i, "serie", it.serie, "série") + _cellText(i, "tipo", it.tipo, "tipo") +
        _cellText(i, "emissao", it.emissao, "dd/mm/aaaa") + _cellText(i, "origem", it.origem, "cidade/UF") + _cellText(i, "destino", it.destino, "cidade/UF") +
        _cellText(i, "nfe", it.nfe, "NF-e") + _cellMoney(i, "icms", it.icms) + _cellMoney(i, "valor", it.valor) +
        '<td class="no-print ft-acao"><button type="button" class="ft-del" data-i="' + i + '" title="Remover linha" aria-label="Remover linha">×</button></td>' + "</tr>";
    }).join("");
    Array.prototype.forEach.call(body.querySelectorAll("input.ft-inp"), function (inp) {
      inp.addEventListener("input", _onInput); inp.addEventListener("blur", _onBlur);
    });
    Array.prototype.forEach.call(body.querySelectorAll(".ft-del"), function (btn) {
      btn.addEventListener("click", function () { _removerLinha(+btn.getAttribute("data-i")); });
    });
  }
  function _onInput(ev) {
    var inp = ev.target;
    if (inp.classList.contains("ft-num")) { _setStatus("editando…"); return; }
    _fatCtx.itens[+inp.getAttribute("data-i")][inp.getAttribute("data-campo")] = inp.value;
    _agendarSalvar();
  }
  function _onBlur(ev) {
    var inp = ev.target;
    if (!inp.classList.contains("ft-num")) return;
    var i = +inp.getAttribute("data-i"), campo = inp.getAttribute("data-campo"), cents = _parseCents(inp.value);
    _fatCtx.itens[i][campo] = cents; inp.value = (cents == null ? "" : num2(cents)); recomputeTotais(); _agendarSalvar();
  }
  function recomputeTotais() {
    var its = _fatCtx.itens, total = its.reduce(function (a, it) { return a + (it.valor || 0); }, 0), fmt = money(total);
    ["ftVprest", "ftVreceb", "ftVliq", "ftVnt", "ftFootTotal"].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = fmt; });
    var q = $("#ftQtd"); if (q) q.textContent = its.length;
    var ex = $("#ftExtenso"); if (ex) ex.textContent = extenso(total);
    var dv = $("#ftDiverg");
    if (dv) {
      var pt = _fatCtx.ctx && _fatCtx.ctx.prefaturaTotal;
      if (_fatCtx.status !== "emitida" && pt != null && total !== pt) {
        dv.hidden = false;
        dv.textContent = "Atenção: a soma das linhas (" + money(total) + ") difere do total da pré-fatura (" + money(pt) + ").";
      } else { dv.hidden = true; }
    }
  }
  function adicionarLinha() {
    _fatCtx.itens.push({ cte: "", serie: "", tipo: "", emissao: "", origem: "", destino: "", nfe: "", icms: null, valor: null });
    renderItensBody(); recomputeTotais(); _agendarSalvar();
    var inps = $("#ftBody").querySelectorAll("tr:last-child input"); if (inps.length) inps[0].focus();
  }
  function _removerLinha(i) { _fatCtx.itens.splice(i, 1); renderItensBody(); recomputeTotais(); _agendarSalvar(); }

  function _setStatus(txt, erro) { var el = $("#ftStatus"); if (!el) return; el.textContent = txt; el.className = "ft-status" + (erro ? " erro" : ""); }
  function _agendarSalvar() { _setStatus("editando…"); if (_saveTimer) clearTimeout(_saveTimer); _saveTimer = setTimeout(salvarFatura, 700); }
  function salvarFatura() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    var c = _fatCtx; if (!c) return Promise.resolve();
    _setStatus("salvando…");
    return fetch("/api/fatura/salvar", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave: c.chave, emissao: c.dataEmissao, vencimento: c.venc, itens: c.itens, contexto: c.ctx }) })
      .then(function (r) { return r.json(); }).then(function (res) { _setStatus(res && res.erro ? "falha ao salvar" : "salvo ✓", res && res.erro); })
      .catch(function () { _setStatus("falha ao salvar", true); });
  }
  function emitirFatura() {
    var c = _fatCtx; if (!c) return;
    _setStatus("gerando…");
    salvarFatura().then(function () {
      return fetch("/api/fatura/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave: c.chave }) });
    }).then(function (r) { return r.json(); }).then(function (fat) {
      if (fat.erro) { _setStatus("falha ao gerar", true); return; }
      carregarPrefaturas(function () {
        carregarEmitidas(function () {
          view = "emitidas"; _fatSource = null; render();
          setBanner("ok", "Fatura nº " + fat.numero + " gerada e enviada para Faturas emitidas.");
        });
      });
    }).catch(function () { _setStatus("falha ao gerar", true); });
  }

  // ---------- faturas emitidas ----------
  function _filtEmit() {
    if (!filtroEmit) return emitidas;
    var f = filtroEmit.toLowerCase();
    return emitidas.filter(function (r) {
      var c = r.contexto || {}, s = c.sacado || {};
      return [r.numero, s.nome, s.cnpj, c.cnpjEmb, c.prefaturaNumero].join(" ").toLowerCase().indexOf(f) >= 0;
    });
  }
  function renderEmitidas() {
    var its = _filtEmit(), total = its.length;
    var soma = its.reduce(function (a, r) { return a + (r.total || 0); }, 0);
    if (!emitidas.length) {
      panel.innerHTML = '<div class="empty"><h2>Nenhuma fatura emitida ainda</h2><p>Gere uma fatura a partir de uma pré-fatura (aba Pré-Faturas → abrir → Gerar fatura).</p></div>';
      return;
    }
    var linhas = its.map(function (r) {
      var c = r.contexto || {}, s = c.sacado || {};
      return '<tr class="clickable" tabindex="0" data-chave="' + esc(r.chave) + '">' +
        '<td class="cell-strong mono">' + esc(r.numero) + "</td>" +
        "<td>" + esc(r.emissao || "—") + "</td>" +
        "<td>" + traco(s.nome) + "</td>" +
        '<td class="mono">' + traco(c.prefaturaNumero) + "</td>" +
        "<td>" + esc(r.vencimento || "—") + "</td>" +
        '<td class="num cell-strong">' + num2(r.total) + "</td>" +
        '<td class="cell-muted">' + esc((r.emitida_em || "").slice(0, 10).split("-").reverse().join("/")) + "</td>" +
        '<td class="acao-col"><button type="button" class="row-del" title="Excluir fatura" aria-label="Excluir">×</button></td>' +
      "</tr>";
    }).join("");
    var corpo = total ? linhas : '<tr><td colspan="8" class="table-empty">Nenhuma fatura corresponde ao filtro.</td></tr>';

    panel.innerHTML =
      '<div class="filterbar">' +
        '<div class="searchwrap"><input type="search" id="buscaEmit" placeholder="Filtrar por nº, sacado, CNPJ, pré-fatura…" value="' + esc(filtroEmit) + '" autocomplete="off"></div>' +
        '<div class="fb-right"><span class="result-count">' + total + (total === 1 ? " fatura" : " faturas") + " · " + money(soma) + "</span>" +
        '<button type="button" class="btn btn-secondary btn-sm" id="btnCsv">Exportar CSV</button></div>' +
      "</div>" +
      '<div class="table-wrap"><table class="grid">' +
        "<thead><tr><th>Número</th><th>Emissão</th><th>Sacado</th><th>Pré-fatura</th><th>Vencimento</th><th class='num'>Valor (R$)</th><th>Emitida em</th><th class='acao-col'></th></tr></thead>" +
        "<tbody>" + corpo + "</tbody></table></div>";

    var busca = $("#buscaEmit");
    busca.oninput = function () { filtroEmit = busca.value; var pos = busca.selectionStart; renderEmitidas(); var b = $("#buscaEmit"); if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (e) {} } };
    $("#btnCsv").onclick = exportarCSV;
    Array.prototype.forEach.call(panel.querySelectorAll("tr.clickable"), function (tr) {
      var ch = tr.getAttribute("data-chave");
      tr.onclick = function (ev) { if (ev.target.closest(".row-del")) return; abrirEmitida(ch); };
      tr.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrirEmitida(ch); } };
      var del = tr.querySelector(".row-del"); if (del) del.onclick = function (ev) { ev.stopPropagation(); excluirFatura(ch); };
    });
  }
  function abrirEmitida(chave) {
    var rec = emitidas.filter(function (x) { return x.chave === chave; })[0];
    if (!rec) return;
    _fatSource = { tipo: "emitida", rec: rec }; view = "fatura"; render(); window.scrollTo(0, 0);
  }
  function excluirFatura(chave) {
    var rec = emitidas.filter(function (x) { return x.chave === chave; })[0];
    if (!rec) return;
    if (!window.confirm("Excluir a fatura nº " + rec.numero + "?\nA pré-fatura volta a ficar disponível para gerar de novo.")) return;
    fetch("/api/fatura/excluir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave: chave }) })
      .then(function () { carregarPrefaturas(function () { carregarEmitidas(function () { view = "emitidas"; render(); }); }); });
  }
  function exportarCSV() {
    var head = ["Numero", "Emissao", "Sacado", "CNPJ", "Pre-fatura", "Vencimento", "Valor", "Emitida em"];
    var rows = [head];
    emitidas.forEach(function (r) {
      var c = r.contexto || {}, s = c.sacado || {};
      rows.push([r.numero, r.emissao, s.nome || "", s.cnpj || c.cnpjEmb || "", c.prefaturaNumero || "", r.vencimento || "",
                 (r.total == null ? "" : num2(r.total).replace(/\./g, "")), (r.emitida_em || "").slice(0, 10)]);
    });
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(";"); }).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "faturas-emitidas.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- modal registros técnicos ----------
  function abrirModalTecnico(entry) {
    var regs = (entry && entry.registros) || [];
    var html = regs.map(function (r) {
      var linhas = (r.campos || []).map(function (cp) { return "<tr><td>" + esc(cp.nome) + '</td><td class="val">' + (cp.valor === "" ? "—" : esc(cp.valor)) + "</td></tr>"; }).join("");
      return '<div class="rec"><div class="rec-h"><span class="rt">' + esc(r.tipo) + '</span><span class="rd">' + esc(r.titulo) + "</span></div><table><tbody>" + linhas + "</tbody></table></div>";
    }).join("");
    $("#modalTitulo").textContent = "Registros do arquivo — " + (entry ? entry.arquivo : "");
    $("#modalBody").innerHTML = html || '<p class="cell-muted">Sem registros.</p>';
    abrirModal();
  }
  var modalRoot = $("#modalRoot");
  function abrirModal() { lastFocus = document.activeElement; modalRoot.hidden = false; $(".modal", modalRoot).focus(); }
  function fecharModal() { modalRoot.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  Array.prototype.forEach.call(modalRoot.querySelectorAll("[data-close]"), function (el) { el.addEventListener("click", fecharModal); });
  $("#modalFechar").addEventListener("click", fecharModal);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modalRoot.hidden) fecharModal(); });

  // ---------- ligações fixas ----------
  $("#btnImportar").addEventListener("click", function () { $("#fileInput").click(); });
  $("#fileInput").addEventListener("change", function (e) { importar(e.target.files); e.target.value = ""; });
  Array.prototype.forEach.call(document.querySelectorAll(".nav-item[data-nav]"), function (a) {
    a.addEventListener("click", function (ev) {
      ev.preventDefault();
      var nav = a.getAttribute("data-nav");
      limparBanner();
      if (nav === "emitidas") { view = "loading"; render(); carregarEmitidas(function () { view = "emitidas"; render(); }); }
      else { view = "loading"; render(); carregarPrefaturas(function () { pagina = 1; view = db.length ? "list" : "empty"; render(); }); }
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".nav-item.is-disabled"), function (a) { a.addEventListener("click", function (ev) { ev.preventDefault(); }); });

  // ---------- início ----------
  render();
  carregarPrefaturas(function () { view = db.length ? "list" : "empty"; render(); });
})();
