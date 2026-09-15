# Pré-Faturas — GKO Frete

Aplicação local para importar, visualizar, conferir e imprimir as pré-faturas
exportadas do GKO Frete (interface `INTPROCEDAPREFAT`, arquivo texto de largura
fixa, layout 1.2A).

Roda inteira no seu computador, pela biblioteca padrão do Python 3 — **não
precisa instalar nada** e nenhum dado sai da máquina.

## Requisitos

- Python 3.8 ou superior. Para conferir, abra o terminal e rode:
  ```
  python --version
  ```
  Se não tiver, instale em https://www.python.org/downloads/ (no Windows,
  marque "Add Python to PATH" na instalação).

## Como rodar

1. Abra o terminal (Prompt de Comando / PowerShell) **dentro desta pasta**.
2. Rode:
   ```
   python app.py
   ```
3. O navegador abre sozinho em `http://127.0.0.1:8730/`.
   (No Windows, também dá pra dar dois cliques em `iniciar.bat`.)

Para encerrar, pressione `Ctrl+C` no terminal.

### Usar em outros computadores da rede

Por padrão o sistema já fica acessível na rede local. Ao ligar, o terminal mostra
o endereço para usar nos outros PCs (algo como `http://192.168.x.x:8730/`) — basta
abrir esse endereço no navegador de qualquer máquina da mesma rede. Não precisa
instalar nada nos outros computadores.

Na primeira vez, o Windows pode pedir para liberar o Python no Firewall — permita
para redes **privadas**. Deixe este computador ligado com o `app.py` rodando; ele
é o "servidor".

Opções:
```
python app.py --porta 9000     # usa outra porta
python app.py --host 127.0.0.1 # restringe só a este computador (sem rede)
python app.py --sem-navegador  # não abre o navegador automaticamente
```

## Como usar

1. Clique em **Importar arquivos** (ou arraste os `.TXT` para a área indicada).
   Pode selecionar vários de uma vez.
2. A lista mostra as pré-faturas encontradas. Use o filtro para achar por número,
   cliente, CNPJ ou nota.
3. Clique em uma linha para abrir o detalhe.
4. Use **Imprimir pré-fatura** para gerar o documento (na janela de impressão,
   escolha "Salvar como PDF" para baixar).
5. **Ver registros técnicos** mostra os campos crus de cada registro do arquivo,
   útil para conferência.
6. **Gerar fatura** abre a fatura comercial (layout FATURA/DUPLICATA) da pré-fatura,
   já com a filial emitente pelo estado do arquivo (ES/SP) e o sacado (Hershey).
   A tabela de **CTe** (CTe, série, tipo, emissão, origem, destino, NF-e, ICMS,
   valor) e as datas de **emissão/vencimento** são **editáveis** — preencha o que
   não vem no arquivo, use **+ Adicionar linha** e o **×** para remover. Tudo
   **salva sozinho no servidor**; o total, o valor por extenso e um aviso de
   divergência (se a soma das linhas ≠ total da pré-fatura) atualizam na hora.
7. Quando estiver pronta, clique em **Gerar fatura** (botão da barra): o sistema
   atribui o **número definitivo** e envia a fatura para a aba **Faturas emitidas**.

### Faturas emitidas

Lista todas as faturas geradas (de qualquer PC), com filtro e **Exportar CSV**.
Clique numa fatura para ver/imprimir; o **×** exclui (estorna) e libera a
pré-fatura para gerar de novo.

### Cadastros e a filial emitente

A filial que emite a fatura é decidida pelo estado do embarcador que vem no
arquivo (CNPJ 04.429.377/0009-79 → ES; /0001-11 → SP). Os dados das filiais da
Coopertruni e do sacado ficam em `static/cadastros.js` — edite lá se mudar
endereço, IE, contato ou entrar um novo cliente/filial.

O arquivo do GKO **não traz** o número do CT-e nem as cidades de origem/destino;
essas colunas ficam em branco na fatura para você preencher manualmente.

### Numeração e dados

O número da fatura é atribuído **no momento em que você clica em Gerar fatura**
(emitir) — abrir a fatura só para conferir não gasta número. Formato padrão
`AA-MM-000001` (mês da emissão + sequência). Para continuar de um número já usado,
ajuste no topo do `app.py`: `NUM_INICIO`, `NUM_DIGITOS` e `NUM_PREFIXO_ANO_MES`.

Tudo (pré-faturas importadas, rascunhos e faturas emitidas) fica salvo em
`dados/dados.json`, **no computador-servidor**. Por isso as pré-faturas continuam
lá depois de recarregar a página ou reiniciar o serviço, e todos os PCs da rede
veem o mesmo. Inclua a pasta `dados/` no seu backup.

O detalhe faz uma checagem automática: soma as rubricas de frete e compara com o
total do registro 392. Se bater, mostra "Valores conferem"; se não, aponta a
diferença.

## Arquivos

```
app.py                     Servidor local (biblioteca padrão do Python)
gko_parser.py              Leitor do layout de largura fixa do GKO
static/index.html          Estrutura da interface
static/styles.css          Estilos
static/app.js              Lógica (telas, filtro, fatura, impressão)
static/cadastros.js        Cadastro das filiais e do sacado (editável)
static/logo-coopertruni.png Logo usada na fatura
dados/dados.json           Banco (pré-faturas + faturas) — criado ao rodar
iniciar.bat                Atalho de inicialização no Windows
```

## Observação

Feito sob medida para a Coopertruni. Ajustes de cadastro (filiais e sacado) em
`static/cadastros.js`.
