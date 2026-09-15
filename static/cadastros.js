/* Cadastros usados na emissão da fatura.
   Editar aqui se mudar endereço, IE, contato ou entrar uma nova filial/sacado.
   O estado (ES/SP) é decidido pelo CNPJ do embarcador (registro 391 do arquivo). */
window.CADASTROS = {

  // Cooperativa emitente — Coopertruni, por filial/estado
  emitente: {
    razao: "COOPERATIVA DOS TRANSPORTADORES UNIDOS LTDA",
    site: "www.coopertruni.com.br",
    filiais: {
      ES: {
        uf: "ES",
        cnpj: "08.029.379/0005-06",
        ie: "082897760",
        endereco: "Rua Aristides Borges de Aguiar, 581",
        cidade: "Castelo/ES",
        cep: "29360-000",
        telefax: "(27) 3273-2817",
        email: "coopertruni@coopertruni.com.br"
      },
      SP: {
        uf: "SP",
        cnpj: "08.029.379/0002-55",
        ie: "206493190119",
        endereco: "Avenida Prefeito João Vilallobo Quero, 1505",
        cidade: "Barueri/SP",
        cep: "06422-122",
        telefax: "(16) 3335-3187",
        email: "SA.ASSESSORIA@TECHS.COM.BR"
      }
    }
  },

  // Sacado (quem paga) — indexado pelo CNPJ do embarcador que vem no arquivo (391)
  sacados: {
    "04.429.377/0009-79": {
      uf: "ES",
      nome: "HERSHEY DO BRASIL LTDA",
      cnpj: "04.429.377/0009-79",
      ie: "083643893",
      endereco: "Avenida Civit I, 1795 - Barro Branco",
      cidade: "Serra/ES",
      cep: "29170-740",
      praca: "Serra/ES"
    },
    "04.429.377/0001-11": {
      uf: "SP",
      nome: "HERSHEY DO BRASIL LTDA",
      cnpj: "04.429.377/0001-11",
      ie: "653104989110",
      endereco: "Rua Cleide Lurdes Agostinho, 150 - Marmeleiro",
      cidade: "São Roque/SP",
      cep: "18131-747",
      praca: "São Roque/SP"
    }
  }
};
