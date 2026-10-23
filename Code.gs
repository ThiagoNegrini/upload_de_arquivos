/*******************************************************
 * SISTEMA DE ENVIO DE ARQUIVOS
 * Google Apps Script
 *
 * FUNCIONAMENTO:
 * - recebe um ou vários arquivos;
 * - mantém o arquivo ORIGINAL;
 * - NÃO converte para PDF;
 * - NÃO faz união de arquivos;
 * - cria/utiliza a pasta informada;
 * - salva cada arquivo individualmente;
 * - preserva a ordem recebida;
 * - registra os arquivos e logs na planilha.
 *
 * IMPLANTAÇÃO:
 * - Executar como: Eu
 * - Quem tem acesso: Qualquer pessoa
 *******************************************************/


const CONFIG = {

  // ID da planilha EXCLUSIVA DE CONTROLE DE USUÁRIOS
  ID_PLANILHA_USUARIOS:
    '1EmQf8JzBwF5986QKJx-JS3EqZM8N70ph977BTFQmk1k',

  // ID da planilha EXCLUSIVA DE CONTROLE DE ENVIO
  ID_PLANILHA_ENVIO:
    '172D3An9lJ6fD2QFg0POx-q140Owj9oSjo6q3dZ99v24',

  // ID da pasta principal do Google Drive
  ID_PASTA_PRINCIPAL:
    '1Ru36cNd_nX7xDaAz28qcXycLoVkkhkB7',

  // Aba dos usuários
  ABA_USUARIOS:
    'Usuarios',

  // Aba de registros dos arquivos
  ABA_REGISTROS:
    'Registros',

  // Aba de logs
  ABA_LOGS:
    'Logs',

  // Aba configurável com documentos obrigatórios por grupo
  ABA_REQUISITOS: 'Requisitos',

  // Aba de CPFs autorizados a administrar o sistema na planilha base de cadastro
  ABA_ADM: 'adm',

  // Aba de prazos e abertura/fechamento dos envios, na planilha de controle de envio
  ABA_PRAZOS: 'Prazos',

  // Prazo final por grupo (horário local do projeto Apps Script).
  // Atualize estas datas quando a UESP publicar novos prazos.
  PRAZOS_GRUPOS: {
    'GRUPO ESPECIAL DE BAIRROS': '2026-10-21T23:59:59',
    'ACESSO DE BLOCOS': '2026-10-21T23:59:59',
    'BLOCOS ESPECIAIS': '2026-10-21T23:59:59',
    'GRUPO ACESSO I': '2026-10-21T23:59:59',
    'GRUPO ACESSO II': '2026-10-21T23:59:59',
    'GRUPO ACESSO III': '2026-10-21T23:59:59'
  },

  // Mantido para compatibilidade
  ROOT_FOLDER_ID:
    '1Ru36cNd_nX7xDaAz28qcXycLoVkkhkB7'
};

// =====================================================
// PASTAS DE CATEGORIA JÁ EXISTENTES NO GOOGLE DRIVE
// =====================================================

const PASTAS_CATEGORIAS = {

  'GRUPO ESPECIAL DE BAIRROS':
    '1Vas3yq8W4fqmePkFNJumyEYIkdTgw6D1',

  'GRUPO ACESSO I':
    '1S_LIuQ1mp2hRpNZU5kF5HnbexeJE-6nn',

  'GRUPO ACESSO II':
    '1rIfwCIK5Nyr8Ul_YnORP9788uT987uhO',

  'GRUPO ACESSO III':
    '1UUWH9Ie9jyZttip3TgVT7FAX2tRA3M6i',

  'ACESSO DE BLOCOS':
    '1DahyDMb5jvThsqF-WLlmbK51OCcz2lMe',

  'BLOCOS ESPECIAIS':
    '1mNRWjVwsYrbQPaf4-F4el7cAmNfM8iHM'

};


/* =====================================================
   WEB APP
===================================================== */


/**
 * Localiza o pavilhão na pasta do Drive organizada por grupo.
 * Prioridade: JPG/JPEG da escola; alternativa: BMP da escola.
 * A imagem é devolvida como data URI para não depender de compartilhamento público.
 */
const LOGOTIPOS_ROOT_FOLDER_ID = '1lnl6ZHRSRQwUssDPJ-sgyURJ5FgSLn4c';

function normalizarNomeLogo_(valor) {
  return String(valor || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(jpe?g|bmp)$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

// Busca direta primeiro; só percorre subpastas como alternativa para a estrutura antiga.
function localizarPastaGrupoLogo_(pasta, grupoNormalizado, buscaRecursiva) {
  if (normalizarNomeLogo_(pasta.getName()) === grupoNormalizado) return pasta;

  const pastasDiretas = pasta.getFolders();
  while (pastasDiretas.hasNext()) {
    const subpasta = pastasDiretas.next();
    if (normalizarNomeLogo_(subpasta.getName()) === grupoNormalizado) return subpasta;
  }
  if (buscaRecursiva === false) return null;

  const pastas = pasta.getFolders();
  while (pastas.hasNext()) {
    const encontrada = localizarPastaGrupoLogo_(pastas.next(), grupoNormalizado, true);
    if (encontrada) return encontrada;
  }
  return null;
}

// Procura arquivos na pasta atual primeiro. A busca recursiva fica como último recurso.
function localizarArquivoLogo_(pasta, nomeNormalizado, extensoes, buscaRecursiva) {
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) {
    const arquivo = arquivos.next();
    const nome = arquivo.getName();
    const ext = (nome.match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
    if (extensoes.indexOf(ext) !== -1 &&
        normalizarNomeLogo_(nome) === nomeNormalizado) {
      return arquivo;
    }
  }
  if (buscaRecursiva === false) return null;

  const pastas = pasta.getFolders();
  while (pastas.hasNext()) {
    const encontrado = localizarArquivoLogo_(pastas.next(), nomeNormalizado, extensoes, true);
    if (encontrado) return encontrado;
  }
  return null;
}

function obterLogoEscola_(p) {
  const escola = String(p.escola || p.nomeEscola || '').trim();
  const grupo = String(p.grupo || p.grupoVinculado || '').trim();
  if (!escola) return { sucesso: false, mensagem: 'Nome da escola não informado.' };

  const nomeNormalizado = normalizarNomeLogo_(escola);
  const cache = CacheService.getScriptCache();
  const chaveCache = 'logoId:' + normalizarNomeLogo_(grupo) + ':' + nomeNormalizado;

  try {
    let arquivo = null;
    const idEmCache = cache.get(chaveCache);
    if (idEmCache) {
      try {
        arquivo = DriveApp.getFileById(idEmCache);
        if (arquivo.isTrashed()) arquivo = null;
      } catch (erroCache) {
        arquivo = null;
      }
    }

    if (!arquivo) {
      const raiz = DriveApp.getFolderById(LOGOTIPOS_ROOT_FOLDER_ID);
      let pastaBusca = raiz;

      if (grupo) {
        const grupoNormalizado = normalizarNomeLogo_(grupo);
        const aliasesGrupo = {
          'grupoespecialdebairros': ['especialdebairros'],
          'acessodeblocos': ['acessoblocos'],
          'grupoacessoi': ['acessoi'],
          'grupoacessoii': ['acessoii'],
          'grupoacessoiii': ['acessoiii'],
          'especialdebairros': ['especialdebairros'],
          'acessoblocos': ['acessoblocos'],
          'acessoi': ['acessoi'],
          'acessoii': ['acessoii'],
          'acessoiii': ['acessoiii'],
          'blocosespeciais': ['blocosespeciais']
        };
        const nomesPossiveis = [grupoNormalizado].concat(aliasesGrupo[grupoNormalizado] || []);
        pastaBusca = null;

        // Os grupos costumam estar logo abaixo da pasta raiz; busca direta primeiro.
        for (let i = 0; i < nomesPossiveis.length && !pastaBusca; i++) {
          pastaBusca = localizarPastaGrupoLogo_(raiz, nomesPossiveis[i], false);
        }
        // Compatibilidade com estruturas antigas com grupos em subpastas.
        for (let i = 0; i < nomesPossiveis.length && !pastaBusca; i++) {
          pastaBusca = localizarPastaGrupoLogo_(raiz, nomesPossiveis[i], true);
        }
        if (!pastaBusca) {
          return { sucesso: false, mensagem: 'Não foi encontrada a pasta do grupo: ' + grupo };
        }
      }

      // Se o nome no cadastro já está padronizado, procura o JPG na pasta do grupo sem percorrer toda a árvore.
      arquivo = localizarArquivoLogo_(pastaBusca, nomeNormalizado, ['jpg', 'jpeg'], false);
      if (!arquivo) arquivo = localizarArquivoLogo_(pastaBusca, nomeNormalizado, ['bmp'], false);

      // Alternativas para imagens que ainda estejam dentro de subpastas.
      if (!arquivo) arquivo = localizarArquivoLogo_(pastaBusca, nomeNormalizado, ['jpg', 'jpeg'], true);
      if (!arquivo) arquivo = localizarArquivoLogo_(pastaBusca, nomeNormalizado, ['bmp'], true);

      if (!arquivo) {
        return { sucesso: false, mensagem: 'Logotipo não encontrado para "' + escola + '". Verifique o nome do arquivo e a pasta do grupo.' };
      }
      cache.put(chaveCache, arquivo.getId(), 21600); // 6 horas; guarda só o ID, não a imagem.
    }

    const blob = arquivo.getBlob();
    const bytes = blob.getBytes();
    if (bytes.length > 4 * 1024 * 1024) {
      return { sucesso: false, mensagem: 'O arquivo do logotipo excede o limite de 4 MB.' };
    }

    let mime = blob.getContentType();
    if (!mime || mime === 'application/octet-stream') {
      const extensao = (arquivo.getName().match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
      mime = extensao === 'bmp' ? 'image/bmp' : 'image/jpeg';
    }
    return {
      sucesso: true,
      nomeArquivo: arquivo.getName(),
      dataUri: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes)
    };
  } catch (erro) {
    console.error('Falha ao localizar logotipo:', erro);
    return { sucesso: false, mensagem: 'Não foi possível consultar a pasta de logotipos do Drive.' };
  }
}

function doGet(e) {

  try {

    const p =
      e && e.parameter
        ? e.parameter
        : {};

    return json_({

      sucesso: true,

      mensagem:
        'API de envio de arquivos ativa.'

    });

  } catch (erro) {

    return json_({

      sucesso: false,

      mensagem:
        erro.message ||
        String(erro)

    });
  }
}


function doPost(e) {

  try {

    const p =
      e && e.parameter
        ? e.parameter
        : {};

    const acao =
      p.acao || '';


    switch (acao) {

      case 'cadastro':

        return json_(
          cadastrarUsuario_(p)
        );

      case 'listarEscolasCadastro':
        return json_(listarEscolasCadastro_(p));


      case 'obterLogoEscola':
        return json_(obterLogoEscola_(p));

      case 'login':

        return json_(
          efetuarLogin_(p)
        );


      case 'recuperarSenha':

        return json_(
          recuperarSenha_(p)
        );

      case 'listarArquivos':
        return json_(listarArquivosUsuario_(p));

      case 'listarArquivosPastaSelecionada':
        return json_(listarArquivosPastaSelecionada_(p));

      case 'listarPendencias':
        return json_(listarPendenciasUsuario_(p));

      case 'adminListarPastas':
        return json_(adminListarPastas_(p));

      case 'adminListarArquivosPasta':
        return json_(adminListarArquivosPasta_(p));

      case 'adminExcluirArquivo':
        return json_(adminExcluirArquivo_(p));

      case 'adminSubstituirArquivo':
        return json_(adminSubstituirArquivo_(p));

      case 'adminListarPrazos':
        return json_(adminListarPrazos_(p));

      case 'adminSalvarPrazo':
        return json_(adminSalvarPrazo_(p));

      case 'baixarArquivo':
        return json_(baixarArquivoUsuario_(p));

      case 'substituirArquivo':
        return json_(substituirArquivoUsuario_(p));


      /*
       * Novo envio de arquivo.
       *
       * O arquivo é salvo exatamente
       * como foi recebido.
       */
      case 'upload':

        try {
          const resultadoUpload = receberArquivo_(p);
          return json_(resultadoUpload);
        } catch (erroUpload) {
          const mensagemErroUpload = erroUpload.message || String(erroUpload);

          // Garante auditoria mesmo quando o upload falhar antes da criação do arquivo.
          registrarLog_(
            'ERRO',
            'UPLOAD',
            String(p.usuario || ''),
            mensagemErroUpload
          );

          registrarArquivo_({
            usuario: String(p.usuario || ''),
            nome: String(p.filenameOriginal || p.filename || ''),
            status: 'ERRO',
            url: '',
            pasta: String(p.escola || ''),
            nomeEscola: String(p.escola || ''),
            grupo: String(p.categoria || ''),
            ordem: Number(p.indice || 0),
            mensagem: mensagemErroUpload
          });

          return json_({
            sucesso: false,
            mensagem: mensagemErroUpload
          });
        }


      /*
       * Mantido para compatibilidade caso
       * o HTML atual utilize iniciarLote.
       */
      case 'iniciarLote':

        return json_(
          iniciarLote_(p)
        );


      /*
       * Mantido para compatibilidade.
       */
      case 'enviarParte':

        return json_(
          enviarParte_(p)
        );


      /*
       * Mantido para compatibilidade.
       */
      case 'finalizarLote':

        return json_({
          sucesso: false,
          mensagem:
            'A união e conversão para PDF foram removidas deste sistema.'
        });


      /*
       * Mantido para compatibilidade.
       */
      case 'statusLote':

        return json_({
          sucesso: true,
          estado: 'NAO_UTILIZADO',
          mensagem:
            'O sistema atual não utiliza processamento de lotes.'
        });


      default:

        return json_({

          sucesso: false,

          mensagem:
            'Ação inválida.'

        });
    }


  } catch (erro) {

    console.error(erro);

    try {
      registrarLog_(
        'ERRO',
        String((e && e.parameter && e.parameter.acao) || 'DESCONHECIDA'),
        String((e && e.parameter && e.parameter.usuario) || ''),
        erro.message || String(erro)
      );
    } catch (erroLog) {
      console.error('Falha ao registrar erro no log:', erroLog);
    }

    return json_({

      sucesso: false,

      mensagem:
        erro.message ||
        String(erro)

    });
  }
}


function json_(obj) {

  return ContentService

    .createTextOutput(
      JSON.stringify(obj)
    )

    .setMimeType(
      ContentService.MimeType.JSON
    );
}


/* =====================================================
   CADASTRO / LOGIN / RECUPERAÇÃO DE SENHA

   Planilha EXCLUSIVA de usuários:
   CONFIG.ID_PLANILHA_USUARIOS

   Estrutura da aba "Usuarios":
   A = Nome
   B = Usuário
   C = CPF
   D = Senha
   E = Data do cadastro
===================================================== */

function obterAbaUsuarios_() {

  const planilha = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_USUARIOS);
  let aba = planilha.getSheetByName(CONFIG.ABA_USUARIOS);

  if (!aba) aba = planilha.insertSheet(CONFIG.ABA_USUARIOS);

  const CABECALHOS = [
    'Nome',
    'Usuário',
    'CPF',
    'Senha',
    'Data do cadastro',
    'Nome da Escola / Pasta',
    'Grupo Vinculado'
  ];

  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, CABECALHOS.length).setValues([CABECALHOS]);
    aba.setFrozenRows(1);
    return aba;
  }

  /*
   * A estrutura definitiva da aba Usuarios é:
   * A = Nome
   * B = Usuário
   * C = CPF
   * D = Senha
   * E = Data do cadastro
   * F = Nome da Escola / Pasta
   * G = Grupo Vinculado
   *
   * Migração:
   * - mantém A:F exatamente nas mesmas posições;
   * - move o antigo "Grupo Vinculado" da coluna M para G;
   * - caso M esteja vazio, tenta aproveitar um único vínculo
   *   existente nas antigas colunas G:L;
   * - remove as antigas colunas de grupos após a migração.
   */
  const ultimaLinha = aba.getLastRow();
  const ultimaColunaAtual = aba.getLastColumn();

  if (ultimaLinha >= 2 && ultimaColunaAtual >= 7) {
    const quantidadeColunasLeitura = Math.min(Math.max(ultimaColunaAtual, 7), 13);
    const dadosAtuais = aba
      .getRange(2, 1, ultimaLinha - 1, quantidadeColunasLeitura)
      .getValues();

    const nomesCabecalho = aba
      .getRange(1, 1, 1, quantidadeColunasLeitura)
      .getValues()[0]
      .map(v => String(v || '').trim());

    const indiceGrupoCabecalho = nomesCabecalho.findIndex(
      v => v.toLowerCase() === 'grupo vinculado'.toLowerCase()
    );

    const gruposAntigos = [
      { nome: 'GRUPO ESPECIAL DE BAIRROS', indice: 6 },
      { nome: 'GRUPO ACESSO I', indice: 7 },
      { nome: 'GRUPO ACESSO II', indice: 8 },
      { nome: 'GRUPO ACESSO III', indice: 9 },
      { nome: 'ACESSO DE BLOCOS', indice: 10 },
      { nome: 'BLOCOS ESPECIAIS', indice: 11 }
    ];

    const novos = dadosAtuais.map(linha => {
      let grupo = '';

      if (indiceGrupoCabecalho >= 0 && indiceGrupoCabecalho < linha.length) {
        grupo = String(linha[indiceGrupoCabecalho] || '').trim();
      }

      if (!grupo && linha.length >= 12) {
        const encontrados = gruposAntigos.filter(g =>
          String(linha[g.indice] || '').trim()
        );

        if (encontrados.length === 1) {
          grupo = encontrados[0].nome;
        }
      }

      return [
        linha[0] || '',
        linha[1] || '',
        linha[2] || '',
        linha[3] || '',
        linha[4] || '',
        linha[5] || '',
        grupo
      ];
    });

    aba.getRange(2, 1, novos.length, 7).setValues(novos);
  }

  // Garante a estrutura definitiva da planilha.
  aba.getRange(1, 1, 1, CABECALHOS.length).setValues([CABECALHOS]);

  // Limpa somente as colunas antigas H:M; A:G permanecem.
  const ultimaColunaDepois = aba.getLastColumn();
  if (ultimaColunaDepois > 7) {
    aba.getRange(1, 8, aba.getMaxRows(), ultimaColunaDepois - 7).clearContent();
  }

  aba.setFrozenRows(1);

  return aba;
}

function normalizarCPF_(cpf) {
  return String(cpf || '')
    .replace(/\D/g, '')
    .trim();
}


function validarCPF_(cpf) {

  const numero = normalizarCPF_(cpf);

  if (numero.length !== 11) return false;

  if (/^(\d)\1{10}$/.test(numero)) return false;

  let soma = 0;

  for (let i = 0; i < 9; i++) {
    soma += Number(numero.charAt(i)) * (10 - i);
  }

  let resto = soma % 11;
  let digito1 = resto < 2 ? 0 : 11 - resto;

  if (digito1 !== Number(numero.charAt(9))) return false;

  soma = 0;

  for (let i = 0; i < 10; i++) {
    soma += Number(numero.charAt(i)) * (11 - i);
  }

  resto = soma % 11;
  let digito2 = resto < 2 ? 0 : 11 - resto;

  return digito2 === Number(numero.charAt(10));
}


function listarEscolasCadastro_(p) {
  const grupoSolicitado = String(p.grupo || '').trim();
  const planilha = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_USUARIOS);
  const aba = planilha.getSheetByName('COMPOSICAO DE GRUPOS');
  if (!aba) {
    return { sucesso:false, mensagem:'A aba "COMPOSICAO DE GRUPOS" não foi encontrada na planilha de controle.' };
  }

  const ultimaLinha = aba.getLastRow();
  const ultimaColuna = aba.getLastColumn();
  if (ultimaLinha < 2 || ultimaColuna < 1) return { sucesso:true, escolas:[] };

  const dados = aba.getRange(1, 1, ultimaLinha, ultimaColuna).getDisplayValues();
  let colunaGrupo = -1;
  for (let c = 0; c < dados[0].length; c++) {
    if (String(dados[0][c] || '').trim().toLocaleUpperCase('pt-BR') === grupoSolicitado.toLocaleUpperCase('pt-BR')) {
      colunaGrupo = c;
      break;
    }
  }
  if (colunaGrupo < 0) return { sucesso:false, mensagem:'Grupo não encontrado na composição oficial.' };

  const escolas = [];
  const vistos = {};
  for (let r = 1; r < dados.length; r++) {
    const escola = String(dados[r][colunaGrupo] || '').trim();
    const chave = normalizarNomeLogo_(escola);
    if (!escola || !chave || vistos[chave]) continue;
    vistos[chave] = true;
    escolas.push(escola);
  }
  escolas.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { sucesso:true, escolas:escolas };
}


function cadastrarUsuario_(p) {

  const nome =
    String(p.nome || '').trim();

  const usuario =
    String(p.usuario || '').trim();

  const cpf =
    normalizarCPF_(p.cpf);

  const senha =
    String(p.senha || '').trim();

  if (!nome || !usuario || !cpf || !senha) {
    return {
      sucesso: false,
      mensagem: 'Preencha todos os campos.'
    };
  }

  if (!validarCPF_(cpf)) {
    return {
      sucesso: false,
      mensagem: 'Informe um CPF válido.'
    };
  }

  if (senha.length < 6) {
    return {
      sucesso: false,
      mensagem: 'A senha deve possuir pelo menos 6 caracteres.'
    };
  }

  const aba = obterAbaUsuarios_();
  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    const ultimaLinha = aba.getLastRow();

    if (ultimaLinha >= 2) {

      // Lê também as colunas de escola (F) e grupo (G) para impedir
      // que uma mesma escola receba um segundo cadastro de responsável.
      const dados = aba
        .getRange(2, 1, ultimaLinha - 1, 7)
        .getValues();

      const chaveUsuario = usuario.toLowerCase();
      const escolaSolicitada = normalizarNomeLogo_(p.nomeEscola || p.escola || '');

      for (let i = 0; i < dados.length; i++) {
        const nomeExistente = String(dados[i][0] || '').trim();
        const usuarioExistente = String(dados[i][1] || '').trim().toLowerCase();
        const cpfExistente = normalizarCPF_(dados[i][2]);
        const escolaExistente = String(dados[i][5] || '').trim();
        const escolaExistenteNormalizada = normalizarNomeLogo_(escolaExistente);

        if (usuarioExistente === chaveUsuario) {
          return {
            sucesso: false,
            mensagem: 'Este usuário já está cadastrado.'
          };
        }

        if (cpfExistente && cpfExistente === cpf) {
          return {
            sucesso: false,
            mensagem: 'Este CPF já está cadastrado. Se você já possui acesso, utilize seu login ou a recuperação de senha.'
          };
        }

        if (escolaSolicitada && escolaExistenteNormalizada &&
            escolaSolicitada === escolaExistenteNormalizada) {
          return {
            sucesso: false,
            mensagem: 'Esta escola já está vinculada ao cadastro de "' +
              nomeExistente + '". Por favor, procure ' + nomeExistente +
              ' para solicitar acesso. Não é necessário criar outro cadastro para esta escola.'
          };
        }
      }
    }

    /*
     * Formata o CPF como texto para preservar zeros à esquerda.
     */
    aba.getRange(aba.getLastRow() + 1, 3).setNumberFormat('@');

    aba.appendRow([
      nome,
      usuario,
      cpf,
      senha,
      new Date(),
      ''
    ]);

    return {
      sucesso: true,
      mensagem: 'Cadastro realizado com sucesso.'
    };

  } finally {
    lock.releaseLock();
  }
}


function efetuarLogin_(p) {

  const usuario =
    String(p.usuario || '').trim();

  const senha =
    String(p.senha || '').trim();

  if (!usuario || !senha) {
    return {
      sucesso: false,
      mensagem: 'Informe usuário e senha.'
    };
  }

  const aba = obterAbaUsuarios_();
  const ultimaLinha = aba.getLastRow();

  if (ultimaLinha < 2) {
    return {
      sucesso: false,
      mensagem: 'Nenhum usuário cadastrado.'
    };
  }

  const dados = aba
    .getRange(2, 1, ultimaLinha - 1, 7)
    .getValues();

  const chave = usuario.toLowerCase();

  for (let i = 0; i < dados.length; i++) {

    const nome = String(dados[i][0] || '').trim();
    const usuarioPlanilha = String(dados[i][1] || '').trim();
    const senhaPlanilha = String(dados[i][3] || '').trim();
    const nomeEscola = String(dados[i][5] || '').trim();
    const escolasPorGrupo = obterEscolasPorGrupoDaLinha_(dados[i]);

    if (usuarioPlanilha.toLowerCase() === chave) {

      if (senhaPlanilha !== senha) {
        return {
          sucesso: false,
          mensagem: 'Usuário ou senha inválidos.'
        };
      }

      const vinculo = obterVinculoUsuario_(usuarioPlanilha);
      const ehAdministrador = cpfUsuarioEhAdmin_(aba.getRange(i + 2, 3).getDisplayValue());
      const tokenSessao = Utilities.getUuid();
      CacheService.getScriptCache().put('painel_sessao_' + tokenSessao, usuarioPlanilha, 21600);

      return {
        sucesso: true,
        token: tokenSessao,
        usuario: usuarioPlanilha,
        nome: nome,
        // A conta ADM não recebe vínculo de grupo/pasta de entidade.
        nomeEscola: ehAdministrador ? '' : (vinculo.escola || nomeEscola),
        grupoVinculado: ehAdministrador ? '' : (vinculo.grupo || ''),
        nomeEscolaVinculada: ehAdministrador ? '' : (vinculo.escola || nomeEscola),
        escolasPorGrupo: ehAdministrador ? {} : escolasPorGrupo,
        ehAdministrador: ehAdministrador,
        prazosGrupos: obterPrazosPublicos_()
      };
    }
  }

  return {
    sucesso: false,
    mensagem: 'Usuário ou senha inválidos.'
  };
}


function recuperarSenha_(p) {

  const usuario =
    String(p.usuario || '').trim();

  const ultimosCpf =
    String(p.ultimosCpf || '')
      .replace(/\D/g, '')
      .slice(-5);

  const novaSenha =
    String(p.novaSenha || '').trim();

  if (!usuario || !ultimosCpf || !novaSenha) {
    return {
      sucesso: false,
      mensagem: 'Preencha todos os campos.'
    };
  }

  if (ultimosCpf.length !== 5) {
    return {
      sucesso: false,
      mensagem: 'Informe os 5 últimos números do CPF.'
    };
  }

  if (novaSenha.length < 6) {
    return {
      sucesso: false,
      mensagem: 'A nova senha deve possuir pelo menos 6 caracteres.'
    };
  }

  const aba = obterAbaUsuarios_();
  const ultimaLinha = aba.getLastRow();

  if (ultimaLinha < 2) {
    return {
      sucesso: false,
      mensagem: 'Nenhum usuário cadastrado.'
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {

    const dados = aba
      .getRange(2, 1, ultimaLinha - 1, 5)
      .getValues();

    const chaveUsuario = usuario.toLowerCase();

    for (let i = 0; i < dados.length; i++) {

      const usuarioPlanilha = String(
        dados[i][1] || ''
      ).trim();

      if (usuarioPlanilha.toLowerCase() !== chaveUsuario) {
        continue;
      }

      const cpf = normalizarCPF_(dados[i][2]);

      if (!cpf || cpf.length !== 11) {
        return {
          sucesso: false,
          mensagem:
            'Este cadastro ainda não possui CPF registrado. Procure o responsável pelo cadastro.'
        };
      }

      if (cpf.slice(-5) !== ultimosCpf) {
        return {
          sucesso: false,
          mensagem: 'Usuário ou dados de recuperação inválidos.'
        };
      }

      /* Senha continua visível na planilha, conforme solicitado. */
      aba.getRange(i + 2, 4).setValue(novaSenha);

      return {
        sucesso: true,
        mensagem: 'Senha alterada com sucesso.'
      };
    }

    return {
      sucesso: false,
      mensagem: 'Usuário ou dados de recuperação inválidos.'
    };

  } finally {
    lock.releaseLock();
  }
}


/* =====================================================
   REGISTROS E LOGS
===================================================== */


function obterAbaAuditoria_(
  nome,
  cabecalhos
) {

  const planilha =
    SpreadsheetApp.openById(
      CONFIG.ID_PLANILHA_ENVIO
    );


  let aba =
    planilha.getSheetByName(
      nome
    );


  if (!aba) {

    aba =
      planilha.insertSheet(
        nome
      );
  }


  if (
    aba.getLastRow() === 0
  ) {

    aba
      .getRange(
        1,
        1,
        1,
        cabecalhos.length
      )
      .setValues([
        cabecalhos
      ]);


    aba.setFrozenRows(1);

  }


  return aba;
}


function obterAbaRegistros_() {
  const aba = obterAbaAuditoria_(CONFIG.ABA_REGISTROS, [
    'Data/Hora', 'Usuário', 'Arquivo', 'Status', 'URL', 'Pasta',
    'Nome da Escola / Pasta', 'Ordem', 'Mensagem'
  ]);
  // Coluna adicional compatível com registros antigos.
  if (String(aba.getRange(1, 10).getValue() || '') !== 'Grupo') {
    aba.getRange(1, 10).setValue('Grupo');
  }
  return aba;
}


function obterAbaLogs_() {

  return obterAbaAuditoria_(
    CONFIG.ABA_LOGS,
    [
      'Data/Hora',
      'Nível',
      'Ação',
      'Usuário',
      'Mensagem'
    ]
  );
}


function registrarLog_(
  nivel,
  acao,
  usuario,
  mensagem
) {

  try {

    obterAbaLogs_()
      .appendRow([

        new Date(),

        String(
          nivel || 'INFO'
        ),

        String(
          acao || ''
        ),

        String(
          usuario || ''
        ),

        String(
          mensagem || ''
        )

      ]);

  } catch (erro) {

    console.error(
      'Falha ao gravar log:',
      erro
    );

  }
}


function registrarArquivo_(dados) {

  try {

    obterAbaRegistros_()
      .appendRow([

        new Date(),

        String(
          dados.usuario || ''
        ),

        String(
          dados.nome || ''
        ),

        String(
          dados.status || ''
        ),

        String(
          dados.url || ''
        ),

        String(
          dados.pasta || ''
        ),

        String(
          dados.nomeEscola || ''
        ),

        Number(
          dados.ordem || 0
        ),

        String(
          dados.mensagem || ''
        ),

        String(dados.grupo || dados.categoria || '')

      ]);

  } catch (erro) {

    console.error(
      'Falha ao gravar registro:',
      erro
    );

  }
}


/* =====================================================
   ENVIO DE ARQUIVO
===================================================== */

/*
 * Esta é a função principal do novo sistema.
 *
 * O arquivo:
 *
 * 1. é recebido em Base64;
 * 2. é convertido novamente em bytes;
 * 3. é criado como Blob;
 * 4. é salvo diretamente no Drive.
 *
 * NÃO existe:
 *
 * - conversão para PDF;
 * - união de PDFs;
 * - pdf-lib;
 * - Google Docs;
 * - Google Sheets para conversão;
 * - Google Slides para conversão.
 *
 * Portanto, o arquivo permanece no formato original.
 */

function obterEscolasPorGrupoDaLinha_(linha) {
  const mapa = {};
  const grupo = String(linha[6] || '').trim();
  const escola = String(linha[5] || '').trim();

  if (grupo && escola) {
    mapa[grupo] = escola;
  }

  return mapa;
}


function obterVinculoUsuario_(usuario) {
  const chave = String(usuario || '').trim().toLowerCase();
  if (!chave) return { grupo: '', escola: '', linha: 0 };

  const aba = obterAbaUsuarios_();
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return { grupo: '', escola: '', linha: 0 };

  const dados = aba.getRange(2, 1, ultimaLinha - 1, 7).getValues();

  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim().toLowerCase() === chave) {
      const escola = String(dados[i][5] || '').trim();
      const grupo = String(dados[i][6] || '').trim();
      return { grupo: grupo, escola: escola, linha: i + 2 };
    }
  }

  return { grupo: '', escola: '', linha: 0 };
}


function vincularUsuarioAoGrupo_(usuario, categoria, nomeEscola) {
  const chave = String(usuario || '').trim().toLowerCase();
  const grupo = String(categoria || '').trim();
  const escola = limparNome_(String(nomeEscola || '').trim());

  if (!chave || !grupo || !escola || !PASTAS_CATEGORIAS[grupo]) {
    throw new Error('Usuário, grupo ou nome da escola inválido.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const vinculo = obterVinculoUsuario_(chave);

    if (vinculo.linha === 0) {
      throw new Error('Usuário não encontrado.');
    }

    if (vinculo.grupo) {
      if (vinculo.grupo !== grupo) {
        throw new Error(
          'Este usuário já está vinculado ao grupo "' + vinculo.grupo + '". ' +
          'Não é permitido enviar arquivos para outro grupo.'
        );
      }

      if (vinculo.escola && vinculo.escola.toLowerCase() !== escola.toLowerCase()) {
        throw new Error(
          'O nome da escola informado não corresponde à escola vinculada ao usuário.'
        );
      }

      return { grupo: vinculo.grupo, escola: vinculo.escola || escola };
    }

    const aba = obterAbaUsuarios_();
    aba.getRange(vinculo.linha, 6).setValue(escola);
    aba.getRange(vinculo.linha, 7).setValue(grupo);

    return { grupo: grupo, escola: escola };
  } finally {
    lock.releaseLock();
  }
}


function obterNomeEscolaDoUsuario_(usuario) {
  const chave = String(usuario || '').trim().toLowerCase();
  if (!chave) return '';

  const aba = obterAbaUsuarios_();
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return '';

  const dados = aba.getRange(2, 1, ultimaLinha - 1, 7).getValues();
  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim().toLowerCase() === chave) {
      return String(dados[i][5] || '').trim();
    }
  }
  return '';
}


function obterEscolasPorGrupoDoUsuario_(usuario) {
  const chave = String(usuario || '').trim().toLowerCase();
  if (!chave) return {};

  const aba = obterAbaUsuarios_();
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return {};

  const dados = aba.getRange(2, 1, ultimaLinha - 1, 7).getValues();
  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim().toLowerCase() === chave) {
      return obterEscolasPorGrupoDaLinha_(dados[i]);
    }
  }

  return {};
}

function gerarNomeSemSubstituicao_(pasta, nomeDesejado) {
  const nome = limparNome_(String(nomeDesejado || '').trim());
  if (!nome) throw new Error('Nome do arquivo inválido.');

  if (!pasta.getFilesByName(nome).hasNext()) return nome;

  const agora = new Date();
  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const base = nome.replace(/(\.[^.]*)$/, '');
  const ext = (nome.match(/(\.[^.]*)$/) || ['',''])[1];
  const marca = Utilities.formatDate(agora, tz, 'yyyyMMdd_HHmmss_SSS');
  let candidato = base + '_' + marca + ext;
  let n = 2;
  while (pasta.getFilesByName(candidato).hasNext()) {
    candidato = base + '_' + marca + '_' + n + ext;
    n++;
  }
  return candidato;
}

/* =====================================================
   PRAZOS E PENDÊNCIAS
===================================================== */

function obterAbaPrazos_() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_ENVIO);
  let aba = ss.getSheetByName(CONFIG.ABA_PRAZOS);
  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_PRAZOS);
    aba.getRange(1, 1, 1, 5).setValues([['Grupo', 'Prazo final', 'Envios habilitados', 'Atualizado em', 'Atualizado por']]);
    aba.setFrozenRows(1);
    const grupos = Object.keys(PASTAS_CATEGORIAS);
    const linhas = grupos.map(function(grupo) {
      return [grupo, CONFIG.PRAZOS_GRUPOS[grupo] || '', 'SIM', new Date(), 'MIGRAÇÃO INICIAL'];
    });
    if (linhas.length) aba.getRange(2, 1, linhas.length, 5).setValues(linhas);
  } else if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, 5).setValues([['Grupo', 'Prazo final', 'Envios habilitados', 'Atualizado em', 'Atualizado por']]);
    aba.setFrozenRows(1);
  }
  return aba;
}

function obterConfiguracaoPrazoGrupo_(grupo) {
  const nome = String(grupo || '').trim();
  const padrao = CONFIG.PRAZOS_GRUPOS[nome] || '';
  try {
    const aba = obterAbaPrazos_();
    const ultima = aba.getLastRow();
    if (ultima >= 2) {
      const dados = aba.getRange(2, 1, ultima - 1, 5).getValues();
      for (let i = 0; i < dados.length; i++) {
        if (String(dados[i][0] || '').trim() !== nome) continue;
        const prazoRaw = dados[i][1];
        let prazo = '';
        if (prazoRaw instanceof Date && !isNaN(prazoRaw.getTime())) {
          prazo = Utilities.formatDate(prazoRaw, Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
        } else {
          prazo = String(prazoRaw || '').trim();
        }
        const habilitadoTxt = String(dados[i][2] == null ? 'SIM' : dados[i][2]).trim().toUpperCase();
        return { grupo:nome, prazoTexto:prazo || padrao, habilitado:!['NAO','NÃO','FALSE','0','DESABILITADO','FECHADO'].includes(habilitadoTxt) };
      }
    }
  } catch (e) {
    console.error('Falha ao consultar aba Prazos: ' + e);
    return { grupo:nome, prazoTexto:'', habilitado:false };
  }
  return { grupo:nome, prazoTexto:padrao, habilitado:true };
}

function obterPrazoGrupoServidor_(grupo) {
  const cfg = obterConfiguracaoPrazoGrupo_(grupo);
  const valor = cfg.prazoTexto;
  if (!valor) return null;
  try {
    if (valor instanceof Date) return valor;
    return Utilities.parseDate(String(valor), Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
  } catch (e) {
    return null;
  }
}

function validarEnvioPermitido_(grupo) {
  const cfg = obterConfiguracaoPrazoGrupo_(grupo);
  const prazo = obterPrazoGrupoServidor_(grupo);
  if (!cfg.habilitado) return { permitido:false, mensagem:'Os envios para ' + grupo + ' estão desabilitados pela administração.' };
  if (!prazo) return { permitido:false, mensagem:'Não há prazo final válido configurado para ' + grupo + '.' };
  if (Date.now() > prazo.getTime()) return { permitido:false, mensagem:'O prazo para envio/substituição de documentos do ' + grupo + ' expirou em ' + formatarPrazoServidor_(prazo) + '.' };
  return { permitido:true, prazo:prazo };
}

function normalizarCpfAdmin_(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function cpfUsuarioEhAdmin_(cpf) {
  const alvo = normalizarCpfAdmin_(cpf);
  if (alvo.length !== 11) return false;
  const ss = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_USUARIOS);
  const aba = ss.getSheetByName(CONFIG.ABA_ADM);
  if (!aba || aba.getLastRow() < 1) return false;
  const dados = aba.getDataRange().getDisplayValues();
  let colunaCpf = 0;
  const cab = (dados[0] || []).map(function(v) { return String(v || '').trim().toLowerCase(); });
  const idx = cab.findIndex(function(v) { return v === 'cpf' || v === 'documento' || v === 'cpf administrador'; });
  if (idx >= 0) colunaCpf = idx;
  for (let i = (idx >= 0 ? 1 : 0); i < dados.length; i++) {
    if (normalizarCpfAdmin_(dados[i][colunaCpf]) === alvo) return true;
  }
  return false;
}

function exigirAdministrador_(p) {
  const usuario = String(p.usuario || '').trim();
  if (!validarSessaoPainel_(usuario, p.token)) return { ok:false, mensagem:'Sessão expirada. Entre novamente.' };
  const aba = obterAbaUsuarios_();
  const ultima = aba.getLastRow();
  if (ultima < 2) return { ok:false, mensagem:'Usuário não encontrado.' };
  const dados = aba.getRange(2, 1, ultima - 1, 7).getValues();
  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim().toLowerCase() === usuario.toLowerCase()) {
      if (cpfUsuarioEhAdmin_(dados[i][2])) return { ok:true, usuario:usuario };
      break;
    }
  }
  registrarLog_('ALERTA', 'ACESSO_ADMIN_NEGADO', usuario, 'CPF não autorizado na aba adm.');
  return { ok:false, mensagem:'Acesso administrativo não autorizado. O CPF da conta não consta na aba adm.' };
}


function obterPrazosPublicos_() {
  const resultado = {};
  Object.keys(PASTAS_CATEGORIAS).forEach(function(grupo) {
    const cfg = obterConfiguracaoPrazoGrupo_(grupo);
    const prazo = obterPrazoGrupoServidor_(grupo);
    resultado[grupo] = {
      prazo: prazo ? Utilities.formatDate(prazo, Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss") : '',
      habilitado: !!cfg.habilitado
    };
  });
  return resultado;
}

function adminListarPrazos_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  const aba = obterAbaPrazos_();
  const dados = aba.getLastRow() >= 2 ? aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues() : [];
  const mapa = {};
  dados.forEach(function(r) { mapa[String(r[0] || '').trim()] = r; });
  const grupos = Object.keys(PASTAS_CATEGORIAS).map(function(grupo) {
    const r = mapa[grupo];
    const prazo = r ? r[1] : (CONFIG.PRAZOS_GRUPOS[grupo] || '');
    let prazoISO = '';
    if (prazo instanceof Date && !isNaN(prazo.getTime())) prazoISO = Utilities.formatDate(prazo, Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
    else prazoISO = String(prazo || '').trim();
    const h = r ? String(r[2] == null ? 'SIM' : r[2]).trim().toUpperCase() : 'SIM';
    return { grupo:grupo, prazo: prazoISO, habilitado:!['NAO','NÃO','FALSE','0','DESABILITADO','FECHADO'].includes(h) };
  });
  return { sucesso:true, grupos:grupos, fusoHorario:Session.getScriptTimeZone() || 'America/Sao_Paulo' };
}

function adminSalvarPrazo_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  const grupo = String(p.grupo || '').trim();
  const prazo = String(p.prazo || '').trim();
  const habilitado = String(p.habilitado || '').toUpperCase() === 'SIM';
  if (!Object.prototype.hasOwnProperty.call(PASTAS_CATEGORIAS, grupo)) return { sucesso:false, mensagem:'Grupo inválido.' };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(prazo)) return { sucesso:false, mensagem:'Informe uma data e hora válidas para o prazo.' };
  let data;
  try { data = Utilities.parseDate(prazo + ':00', Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss"); }
  catch (e) { return { sucesso:false, mensagem:'Não foi possível interpretar a data no fuso horário do projeto.' }; }
  if (!(data instanceof Date) || isNaN(data.getTime())) return { sucesso:false, mensagem:'Data de prazo inválida.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const aba = obterAbaPrazos_();
    const ultima = aba.getLastRow();
    let linha = -1;
    if (ultima >= 2) {
      const grupos = aba.getRange(2, 1, ultima - 1, 1).getDisplayValues();
      for (let i = 0; i < grupos.length; i++) if (String(grupos[i][0] || '').trim() === grupo) { linha = i + 2; break; }
    }
    const valores = [grupo, data, habilitado ? 'SIM' : 'NÃO', new Date(), auth.usuario];
    if (linha > 0) aba.getRange(linha, 1, 1, 5).setValues([valores]);
    else { aba.appendRow(valores); linha = aba.getLastRow(); }
    registrarLog_('INFO', 'ADMIN_ATUALIZOU_PRAZO', auth.usuario, grupo + ' | prazo=' + formatarPrazoServidor_(data) + ' | envios=' + (habilitado ? 'habilitados' : 'desabilitados'));
    return { sucesso:true, mensagem:'Prazo e status de envio atualizados para ' + grupo + '.', grupo:grupo, prazo:Utilities.formatDate(data, Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss"), habilitado:habilitado };
  } finally { lock.releaseLock(); }
}


/* PAINEL ADMINISTRATIVO: navegação por grupos, pastas e arquivos */
function adminListarPastas_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  const grupo = String(p.grupo || '').trim();
  const idPastaGrupo = PASTAS_CATEGORIAS[grupo];
  if (!idPastaGrupo) return { sucesso:false, mensagem:'Grupo inválido.' };
  const raiz = DriveApp.getFolderById(idPastaGrupo);
  const pastas = [];
  const iter = raiz.getFolders();
  while (iter.hasNext()) {
    const pasta = iter.next();
    pastas.push({ id:pasta.getId(), nome:pasta.getName() });
  }
  pastas.sort(function(a,b){ return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return { sucesso:true, grupo:grupo, pastas:pastas };
}

function adminListarArquivosPasta_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  const grupo = String(p.grupo || '').trim();
  const pastaId = String(p.pastaId || '').trim();
  const idPastaGrupo = PASTAS_CATEGORIAS[grupo];
  if (!idPastaGrupo || !pastaId) return { sucesso:false, mensagem:'Grupo ou pasta inválidos.' };
  const raiz = DriveApp.getFolderById(idPastaGrupo);
  const pastas = raiz.getFolders();
  let pastaEncontrada = null;
  while (pastas.hasNext()) {
    const item = pastas.next();
    if (item.getId() === pastaId) { pastaEncontrada = item; break; }
  }
  if (!pastaEncontrada) return { sucesso:false, mensagem:'A pasta não pertence ao grupo selecionado.' };
  const arquivos = [];
  const iter = pastaEncontrada.getFiles();
  while (iter.hasNext()) {
    const f = iter.next();
    arquivos.push({
      id:f.getId(), nome:f.getName(), mimeType:f.getMimeType(), tamanho:f.getSize(),
      atualizado:Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone() || 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'),
      url:f.getUrl()
    });
  }
  arquivos.sort(function(a,b){ return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return { sucesso:true, grupo:grupo, pasta:pastaEncontrada.getName(), arquivos:arquivos };
}

/* Ações administrativas sobre arquivos: sempre valida CPF ADM e pertença ao grupo/pasta. */
function adminValidarPastaArquivo_(p) {
  const grupo = String(p.grupo || '').trim();
  const pastaId = String(p.pastaId || '').trim();
  const arquivoId = String(p.idArquivo || '').trim();
  const idRaiz = PASTAS_CATEGORIAS[grupo];
  if (!idRaiz || !pastaId || !arquivoId) throw new Error('Grupo, pasta ou arquivo inválidos.');
  const raiz = DriveApp.getFolderById(idRaiz);
  const itPastas = raiz.getFolders();
  let pasta = null;
  while (itPastas.hasNext()) { const item = itPastas.next(); if (item.getId() === pastaId) { pasta = item; break; } }
  if (!pasta) throw new Error('A pasta não pertence ao grupo selecionado.');
  const itArquivos = pasta.getFiles();
  let arquivo = null;
  while (itArquivos.hasNext()) { const item = itArquivos.next(); if (item.getId() === arquivoId) { arquivo = item; break; } }
  if (!arquivo) throw new Error('O arquivo não pertence à pasta selecionada.');
  return { pasta:pasta, arquivo:arquivo };
}

function adminExcluirArquivo_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  try {
    const alvo = adminValidarPastaArquivo_(p);
    alvo.arquivo.setTrashed(true);
    registrarLog_('INFO', 'ADMIN_EXCLUIR_ARQUIVO', auth.usuario, alvo.arquivo.getName() + ' | ' + alvo.pasta.getName());
    return { sucesso:true, mensagem:'Arquivo enviado para a lixeira.' };
  } catch (e) { return { sucesso:false, mensagem:e.message || String(e) }; }
}

function adminSubstituirArquivo_(p) {
  const auth = exigirAdministrador_(p);
  if (!auth.ok) return { sucesso:false, mensagem:auth.mensagem };
  try {
    const alvo = adminValidarPastaArquivo_(p);
    const nome = limparNome_(String(p.filenameOriginal || '').trim());
    const mime = String(p.mimeType || 'application/octet-stream').trim();
    const dados = String(p.data || '');
    if (!nome || !dados) return { sucesso:false, mensagem:'Selecione o novo arquivo.' };
    const bytes = Utilities.base64Decode(dados);
    const blob = Utilities.newBlob(bytes, mime, nome);
    const nova = alvo.pasta.createFile(blob);
    // Só envia o arquivo antigo para a lixeira depois que a nova cópia foi criada.
    alvo.arquivo.setTrashed(true);
    registrarLog_('INFO', 'ADMIN_SUBSTITUIR_ARQUIVO', auth.usuario, alvo.arquivo.getName() + ' -> ' + nova.getName() + ' | ' + alvo.pasta.getName());
    return { sucesso:true, mensagem:'Arquivo substituído com sucesso.', id:nova.getId(), nome:nova.getName() };
  } catch (e) { return { sucesso:false, mensagem:'Não foi possível substituir o arquivo: ' + (e.message || String(e)) }; }
}

function formatarPrazoServidor_(data) {
  return Utilities.formatDate(data, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
}

function normalizarTextoPendencia_(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function obterAbaRequisitos_() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_ENVIO);
  let aba = ss.getSheetByName(CONFIG.ABA_REQUISITOS);
  if (!aba) aba = ss.insertSheet(CONFIG.ABA_REQUISITOS);
  const cabecalhos = ['Grupo', 'Documento obrigatório', 'Prazo final (opcional)', 'Ativo'];
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, cabecalhos.length).setValues([cabecalhos]);
    aba.setFrozenRows(1);
  }
  return aba;
}

function listarPendenciasUsuario_(p) {
  const usuario = String(p.usuario || '').trim();
  if (!validarSessaoPainel_(usuario, p.token)) {
    return { sucesso:false, mensagem:'Sessão expirada. Saia e entre novamente.' };
  }
  const vinculo = obterVinculoUsuario_(usuario);
  const grupo = String(vinculo.grupo || '').trim();
  if (!grupo) {
    return { sucesso:true, grupo:'', prazo:null, prazoExpirado:false, requisitosConfigurados:false, pendencias:[], mensagem:'O grupo será definido no primeiro envio. A lista de pendências ficará disponível após o vínculo.' };
  }
  const prazo = obterPrazoGrupoServidor_(grupo);
  const configPrazo = obterConfiguracaoPrazoGrupo_(grupo);
  const abaReq = obterAbaRequisitos_();
  const ultimaReq = abaReq.getLastRow();
  const requisitos = [];
  if (ultimaReq >= 2) {
    const linhas = abaReq.getRange(2, 1, ultimaReq - 1, 4).getValues();
    linhas.forEach(function(r) {
      const grupoReq = String(r[0] || '').trim();
      const documento = String(r[1] || '').trim();
      const ativo = String(r[3] == null ? 'SIM' : r[3]).trim().toUpperCase();
      if (grupoReq === grupo && documento && !['NAO', 'NÃO', 'FALSE', '0', 'INATIVO'].includes(ativo)) {
        requisitos.push({ documento:documento, prazoFinal:r[2] instanceof Date ? formatarPrazoServidor_(r[2]) : String(r[2] || '') });
      }
    });
  }
  const abaReg = obterAbaRegistros_();
  const ultimaReg = abaReg.getLastRow();
  const arquivos = [];
  if (ultimaReg >= 2) {
    const linhas = abaReg.getRange(2, 1, ultimaReg - 1, 10).getValues();
    linhas.forEach(function(r) {
      if (String(r[1] || '').trim().toLowerCase() !== usuario.toLowerCase() || String(r[3] || '').trim() !== 'CONCLUIDO') return;
      let grupoArquivo = String(r[9] || '').trim();
      if (!grupoArquivo) {
        // Compatibilidade: identifica grupo de registros antigos pela pasta-pai no Drive.
        try {
          const id = extrairIdDrive_(r[4]);
          const file = id ? DriveApp.getFileById(id) : null;
          if (file) {
            const pais = file.getParents();
            if (pais.hasNext()) {
              const pastaEscola = pais.next();
              const paisCategoria = pastaEscola.getParents();
              if (paisCategoria.hasNext()) {
                const idCategoria = paisCategoria.next().getId();
                Object.keys(PASTAS_CATEGORIAS).some(function(nome) {
                  if (PASTAS_CATEGORIAS[nome] === idCategoria) { grupoArquivo = nome; return true; }
                  return false;
                });
              }
            }
          }
        } catch (e) {}
      }
      if (grupoArquivo !== grupo) return;
      arquivos.push(String(r[2] || ''));
    });
  }
  const nomesEnviados = arquivos.map(normalizarTextoPendencia_);
  const pendencias = requisitos.map(function(req) {
    const chave = normalizarTextoPendencia_(req.documento);
    const encontrado = nomesEnviados.some(function(nome) { return nome === chave || nome.includes(chave) || chave.includes(nome); });
    return { documento:req.documento, enviado:encontrado, status:encontrado ? 'ENVIADO' : 'PENDENTE', prazoFinal:req.prazoFinal };
  });
  return {
    sucesso:true,
    grupo:grupo,
    escola:vinculo.escola || '',
    prazo:prazo ? formatarPrazoServidor_(prazo) : '',
    prazoExpirado:!!prazo && new Date().getTime() > prazo.getTime(),
    enviosHabilitados:configPrazo.habilitado,
    requisitosConfigurados:requisitos.length > 0,
    totalRequisitos:requisitos.length,
    totalEnviados:pendencias.filter(function(x) { return x.enviado; }).length,
    totalPendentes:pendencias.filter(function(x) { return !x.enviado; }).length,
    pendencias:pendencias,
    arquivosRecebidos:arquivos.length
  };
}

/* =====================================================
   PAINEL DO USUÁRIO: LISTAR E SUBSTITUIR ARQUIVOS
===================================================== */

function extrairIdDrive_(url) {
  const valor = String(url || '');
  let m = valor.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = valor.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function validarSessaoPainel_(usuario, token) {
  const u = String(usuario || '').trim().toLowerCase();
  const t = String(token || '').trim();
  if (!u || !t) return false;
  const dono = CacheService.getScriptCache().get('painel_sessao_' + t);
  return !!dono && dono.toLowerCase() === u;
}

function listarArquivosPastaSelecionada_(p) {
  const usuario = String(p.usuario || '').trim();
  if (!validarSessaoPainel_(usuario, p.token)) {
    return { sucesso:false, mensagem:'Sessão expirada. Saia e entre novamente.' };
  }

  const grupo = String(p.grupo || '').trim();
  const nomePasta = String(p.pasta || '').trim();
  const idRaiz = PASTAS_CATEGORIAS[grupo];
  if (!idRaiz || !nomePasta) {
    return { sucesso:true, arquivos:[], mensagem:'Selecione um grupo e uma pasta para consultar os documentos.' };
  }

  const raiz = DriveApp.getFolderById(idRaiz);
  const pastas = raiz.getFoldersByName(nomePasta);
  if (!pastas.hasNext()) {
    return { sucesso:true, arquivos:[], mensagem:'Não foram encontrados documentos para a pasta selecionada.' };
  }

  const pasta = pastas.next();
  const arquivos = [];
  const iter = pasta.getFiles();
  while (iter.hasNext()) {
    const f = iter.next();
    if (f.isTrashed()) continue;
    arquivos.push({
      id:f.getId(),
      nome:f.getName(),
      url:f.getUrl(),
      downloadUrl:f.getDownloadUrl(),
      pasta:pasta.getName(),
      escola:pasta.getName(),
      data:Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss")
    });
  }
  arquivos.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return { sucesso:true, grupo:grupo, pasta:pasta.getName(), arquivos:arquivos };
}

function listarArquivosUsuario_(p) {
  const usuario = String(p.usuario || '').trim();
  if (!validarSessaoPainel_(usuario, p.token)) return { sucesso:false, mensagem:'Sessão expirada. Saia e entre novamente.' };
  const aba = obterAbaRegistros_();
  const ultima = aba.getLastRow();
  if (ultima < 2) return { sucesso:true, arquivos:[] };
  const dados = aba.getRange(2, 1, ultima - 1, 9).getValues();
  const vistos = {};
  const arquivos = [];
  // Mantém apenas o registro mais recente por ID de arquivo; não exibe falhas/substituídos.
  for (let i = dados.length - 1; i >= 0; i--) {
    const r = dados[i];
    if (String(r[1] || '').trim().toLowerCase() !== usuario.toLowerCase()) continue;
    if (String(r[3] || '').trim() !== 'CONCLUIDO') continue;
    const id = extrairIdDrive_(r[4]);
    if (!id || vistos[id]) continue;
    vistos[id] = true;
    try {
      const f = DriveApp.getFileById(id);
      if (f.isTrashed()) continue;
      arquivos.push({ id:id, nome:f.getName(), url:f.getUrl(), downloadUrl:f.getDownloadUrl(),
        pasta:String(r[5] || ''), escola:String(r[6] || ''), data:r[0] instanceof Date ? r[0].toISOString() : String(r[0] || '') });
    } catch (e) {
      // Registro sem arquivo acessível não deve interromper a lista.
    }
  }
  return { sucesso:true, arquivos:arquivos };
}

function baixarArquivoUsuario_(p) {
  const usuario = String(p.usuario || '').trim();
  const id = String(p.idArquivo || '').trim();
  if (!validarSessaoPainel_(usuario, p.token)) return { sucesso:false, mensagem:'Sessão expirada. Saia e entre novamente.' };
  if (!id) return { sucesso:false, mensagem:'Arquivo não informado.' };
  const aba = obterAbaRegistros_();
  const ultima = aba.getLastRow();
  if (ultima < 2) return { sucesso:false, mensagem:'Arquivo não encontrado.' };
  const dados = aba.getRange(2, 1, ultima - 1, 9).getValues();
  let autorizado = false;
  for (let i = dados.length - 1; i >= 0; i--) {
    const r = dados[i];
    if (String(r[1] || '').trim().toLowerCase() === usuario.toLowerCase() &&
        String(r[3] || '').trim() === 'CONCLUIDO' && extrairIdDrive_(r[4]) === id) {
      autorizado = true; break;
    }
  }
  if (!autorizado) return { sucesso:false, mensagem:'Você não tem permissão para baixar este arquivo.' };
  try {
    const arquivo = DriveApp.getFileById(id);
    if (arquivo.isTrashed()) return { sucesso:false, mensagem:'O arquivo não está mais disponível.' };
    const blob = arquivo.getBlob();
    return { sucesso:true, nome:arquivo.getName(), mimeType:blob.getContentType() || 'application/octet-stream', data:Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return { sucesso:false, mensagem:'Falha ao preparar o download: ' + (e.message || String(e)) };
  }
}

function substituirArquivoUsuario_(p) {
  const usuario = String(p.usuario || '').trim();
  const idAntigo = String(p.idArquivo || '').trim();
  const nomeOriginal = limparNome_(String(p.filenameOriginal || '').trim());
  const mimeType = String(p.mimeType || 'application/octet-stream').trim();
  const dadosBase64 = String(p.data || '');
  if (!validarSessaoPainel_(usuario, p.token)) return { sucesso:false, mensagem:'Sessão expirada. Saia e entre novamente.' };
  if (!usuario || !idAntigo || !nomeOriginal || !dadosBase64) {
    return { sucesso:false, mensagem:'Dados incompletos para substituir o arquivo.' };
  }

  const aba = obterAbaRegistros_();
  const ultima = aba.getLastRow();
  if (ultima < 2) return { sucesso:false, mensagem:'Arquivo não encontrado no registro.' };
  const dados = aba.getRange(2, 1, ultima - 1, 10).getValues();
  let linhaRegistro = -1, registro = null;
  for (let i = dados.length - 1; i >= 0; i--) {
    const r = dados[i];
    if (String(r[1] || '').trim().toLowerCase() !== usuario.toLowerCase()) continue;
    if (String(r[3] || '').trim() !== 'CONCLUIDO') continue;
    if (extrairIdDrive_(r[4]) === idAntigo) { linhaRegistro = i + 2; registro = r; break; }
  }
  if (linhaRegistro < 0 || !registro) {
    registrarLog_('ALERTA', 'SUBSTITUICAO_NEGADA', usuario, 'Tentativa de substituir arquivo não associado ao usuário.');
    return { sucesso:false, mensagem:'Você não tem permissão para substituir este arquivo.' };
  }
  const grupoSubstituicao = String(registro[9] || obterVinculoUsuario_(usuario).grupo || '').trim();
  const validacaoPrazoSubstituicao = validarEnvioPermitido_(grupoSubstituicao);
  if (!validacaoPrazoSubstituicao.permitido) return { sucesso:false, mensagem:validacaoPrazoSubstituicao.mensagem };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const antigo = DriveApp.getFileById(idAntigo);
    if (antigo.isTrashed()) return { sucesso:false, mensagem:'O arquivo original não está mais disponível.' };
    if (obterExtensaoArquivo_(nomeOriginal).toLowerCase() !== obterExtensaoArquivo_(antigo.getName()).toLowerCase()) {
      return { sucesso:false, mensagem:'Para preservar o formato do documento, selecione um arquivo com a mesma extensão do original (' + obterExtensaoArquivo_(antigo.getName()) + ').' };
    }
    const pais = antigo.getParents();
    if (!pais.hasNext()) return { sucesso:false, mensagem:'Não foi possível identificar a pasta do arquivo.' };
    const pasta = pais.next();
    const bytes = Utilities.base64Decode(dadosBase64);
    const blob = Utilities.newBlob(bytes, mimeType, antigo.getName());
    // Cria a nova versão no mesmo local e preserva o formato/extensão do arquivo enviado.
    const novo = pasta.createFile(blob);
    // Só envia o original para a lixeira após a nova versão ter sido criada com sucesso.
    antigo.setTrashed(true);
    aba.getRange(linhaRegistro, 4).setValue('SUBSTITUIDO');
    registrarArquivo_({ usuario:usuario, nome:novo.getName(), status:'CONCLUIDO', url:novo.getUrl(),
      pasta:pasta.getName(), nomeEscola:String(registro[6] || ''), grupo:String(registro[9] || ''), ordem:Number(registro[7] || 0),
      mensagem:'Substituição do arquivo ID ' + idAntigo + '; novo ID ' + novo.getId() });
    registrarLog_('INFO', 'SUBSTITUICAO', usuario, 'Arquivo "' + antigo.getName() + '" substituído por "' + novo.getName() + '".');
    return { sucesso:true, mensagem:'Arquivo substituído com sucesso.', id:novo.getId(), nome:novo.getName(), url:novo.getUrl(), downloadUrl:novo.getDownloadUrl() };
  } catch (e) {
    registrarLog_('ERRO', 'SUBSTITUICAO', usuario, e.message || String(e));
    return { sucesso:false, mensagem:'Não foi possível substituir o arquivo: ' + (e.message || String(e)) };
  } finally {
    lock.releaseLock();
  }
}

function receberArquivo_(p) {

  const usuario =
    String(
      p.usuario || ''
    ).trim();


  const categoria =
    limparNome_(
      String(
        p.categoria || ''
      ).trim()
    );


  let nomeEscola =
    limparNome_(
      String(
        p.escola || ''
      ).trim()
    );


  const mimeType =
    String(
      p.mimeType ||
      'application/octet-stream'
    ).trim();


  const dadosBase64 =
    String(
      p.data || ''
    );


  const indice =
    Number(
      p.indice || 0
    );


  const quantidade =
    Number(
      p.quantidade || 1
    );


  const nomeOriginal =
    limparNome_(
      String(
        p.filenameOriginal ||
        p.filename ||
        ''
      ).trim()
    );


  const nomeDocumento =
    limparNome_(
      String(p.nomeDocumento || '').trim()
    );


  if (!usuario) {
    throw new Error('Usuário não informado.');
  }

  if (!validarSessaoPainel_(usuario, p.token)) {
    throw new Error('Sessão expirada. Saia e entre novamente.');
  }

  if (!categoria) {

    throw new Error(
      'Grupo não informado.'
    );

  }


  if (!nomeEscola) {

    throw new Error(
      'Nome da escola não informado.'
    );

  }

  // O prazo é validado no servidor; não depende do contador do navegador.
  const validacaoPrazo = validarEnvioPermitido_(categoria);
  if (!validacaoPrazo.permitido) {
    registrarLog_('ALERTA', 'ENVIO_BLOQUEADO_POR_PRAZO', usuario, categoria + ': ' + validacaoPrazo.mensagem);
    throw new Error(validacaoPrazo.mensagem);
  }
  const prazoGrupo = validacaoPrazo.prazo;

  // No primeiro envio, grava a escola no cadastro. Nos seguintes, confere a vinculação.
  const vinculo = vincularUsuarioAoGrupo_(usuario, categoria, nomeEscola);
  nomeEscola = vinculo.escola;


  if (!nomeOriginal) {

    throw new Error(
      'Nome original do arquivo não informado.'
    );

  }


  if (!dadosBase64) {

    throw new Error(
      'Dados do arquivo não recebidos.'
    );

  }


  if (
    !Number.isInteger(indice) ||
    indice < 0
  ) {

    throw new Error(
      'Índice do arquivo inválido.'
    );

  }


  if (
    !Number.isInteger(quantidade) ||
    quantidade < 1
  ) {

    throw new Error(
      'Quantidade de arquivos inválida.'
    );

  }


  if (indice >= quantidade) {

    throw new Error(
      'Índice do arquivo incompatível com a quantidade informada.'
    );

  }


  /*
   * Localiza uma das seis pastas de categoria
   * que JÁ EXISTEM no Drive.
   *
   * O sistema não cria essas pastas.
   */

  const pastaCategoria =
    obterPastaCategoria_(
      categoria
    );


  /*
   * Dentro da categoria, localiza ou cria
   * a pasta da escola.
   */

  const pastaEscola =
    obterOuCriarPastaEscola_(
      pastaCategoria,
      nomeEscola
    );


  /*
   * Converte Base64 diretamente para bytes.
   * Não existe nenhuma conversão de formato.
   */

  const bytes =
    Utilities.base64Decode(
      dadosBase64
    );


  /*
   * Mantém a extensão do arquivo original.
   */

  const extensao =
    obterExtensaoArquivo_(
      nomeOriginal
    );


  /*
   * O nome do documento é OPCIONAL.
   *
   * Vazio: mantém exatamente o nome original.
   * Preenchido: usa o nome informado e preserva a extensão.
   * Em vários arquivos, acrescenta a numeração.
   */
  let nomeBase;

  if (nomeDocumento) {
    nomeBase = quantidade === 1
      ? nomeDocumento
      : nomeDocumento + ' ' + (indice + 1);
  } else {
    nomeBase = nomeOriginal.replace(/\.[^.]*$/, '');
  }

  const nomePretendido = limparNome_(nomeBase + extensao);

  /*
   * Nunca substitui arquivo existente.
   * Se houver conflito, usa data/hora do recebimento como base.
   */
  const lockUpload = LockService.getScriptLock();
  lockUpload.waitLock(30000);
  let nomeArquivo;
  try {
    nomeArquivo = gerarNomeSemSubstituicao_(pastaEscola, nomePretendido);
    const blob = Utilities.newBlob(bytes, mimeType, nomeArquivo);
    const arquivo = pastaEscola.createFile(blob);

    registrarArquivo_({
      usuario: usuario,
      nome: arquivo.getName(),
      mimeType: arquivo.getMimeType(),
      tamanho: arquivo.getSize(),
      status: 'CONCLUIDO',
      fileId: arquivo.getId(),
      url: arquivo.getUrl(),
      pasta: pastaEscola.getName(),
      nomeEscola: nomeEscola,
      grupo: categoria,
      ordem: indice,
      mensagem: 'Arquivo salvo sem conversão ou modificação. Nenhum arquivo existente foi substituído.'
    });

    registrarLog_('INFO', 'UPLOAD', usuario,
      'Arquivo "' + arquivo.getName() + '" salvo em "' +
      pastaCategoria.getName() + '/' + pastaEscola.getName() + '".');

    return {
      sucesso: true,
      mensagem: 'Arquivo enviado com sucesso!',
      nomeArquivo: arquivo.getName(),
      idArquivo: arquivo.getId(),
      url: arquivo.getUrl(),
      categoria: pastaCategoria.getName(),
      idCategoria: pastaCategoria.getId(),
      pasta: pastaEscola.getName(),
      idPasta: pastaEscola.getId(),
      mimeType: arquivo.getMimeType(),
      tamanho: arquivo.getSize(),
      ordem: indice
    };
  } finally {
    lockUpload.releaseLock();
  }

}


/* =====================================================
   PASTAS DE CATEGORIA / ESCOLA
===================================================== */

/*
 * Localiza uma das seis pastas de categoria
 * pelo ID configurado acima.
 *
 * Essas pastas não são criadas pelo sistema.
 */

function obterPastaCategoria_(categoria) {

  const chave =
    String(
      categoria || ''
    ).trim();


  const id =
    PASTAS_CATEGORIAS[
      chave
    ];


  if (!id) {

    throw new Error(
      'Grupo inválido: "' +
      chave +
      '".'
    );

  }


  try {

    return DriveApp.getFolderById(
      id
    );

  } catch (erro) {

    throw new Error(
      'Não foi possível acessar a pasta do grupo "' +
      chave +
      '". Verifique o ID e as permissões do Google Drive.'
    );

  }

}


/*
 * Localiza a pasta da escola dentro
 * da pasta de categoria.
 *
 * Se não existir, cria.
 */

function obterOuCriarPastaEscola_(
  pastaCategoria,
  nomeEscola
) {

  const nome =
    limparNome_(
      nomeEscola
    );


  if (!nome) {

    throw new Error(
      'Nome da escola não informado.'
    );

  }


  const existentes =
    pastaCategoria.getFoldersByName(
      nome
    );


  if (
    existentes.hasNext()
  ) {

    return existentes.next();

  }


  return pastaCategoria.createFolder(
    nome
  );

}


/*
 * Retorna a extensão original do arquivo,
 * incluindo o ponto.
 *
 * Exemplo:
 * "documento.pdf" -> ".pdf"
 */

function obterExtensaoArquivo_(
  nomeArquivo
) {

  const nome =
    String(
      nomeArquivo || ''
    );


  const ultimoPonto =
    nome.lastIndexOf('.');


  if (
    ultimoPonto <= 0
  ) {

    return '';

  }


  return nome.substring(
    ultimoPonto
  );

}


/* =====================================================
   COMPATIBILIDADE COM O FLUXO DE LOTE ANTIGO
===================================================== */

/*
 * Estas funções permitem que um HTML antigo que ainda
 * utilize iniciarLote/enviarParte continue enviando
 * arquivos sem conversão.
 *
 * Não existe mais processamento posterior.
 */


function iniciarLote_(p) {

  const usuario =
    String(
      p.usuario || ''
    ).trim();


  const pasta =
    limparNome_(
      String(
        p.pasta || ''
      ).trim()
    );


  const total =
    Number(
      p.total || 0
    );


  if (!usuario) {

    throw new Error(
      'Usuário não informado.'
    );

  }


  if (!pasta) {

    throw new Error(
      'Nome da pasta não informado.'
    );

  }


  if (
    !total ||
    total < 1
  ) {

    throw new Error(
      'Nenhum arquivo informado.'
    );

  }


  const loteId =
    Utilities.getUuid();


  /*
   * Guardamos somente as informações
   * necessárias para o lote.
   */

  const dados = {

    loteId:
      loteId,

    usuario:
      usuario,

    pasta:
      pasta,

    total:
      total,

    criadoEm:
      Date.now()

  };


  PropertiesService
    .getScriptProperties()
    .setProperty(
      'LOTE_' + loteId,
      JSON.stringify(dados)
    );


  registrarLog_(
    'INFO',
    'INICIAR_LOTE',
    usuario,
    'Lote ' +
      loteId +
      ' iniciado com ' +
      total +
      ' arquivo(s).'
  );


  return {

    sucesso:
      true,

    loteId:
      loteId

  };
}


function enviarParte_(p) {

  const loteId =
    String(
      p.loteId || ''
    ).trim();


  const lote =
    obterLote_(loteId);


  if (!lote) {

    throw new Error(
      'Lote não encontrado ou expirado.'
    );

  }


  const indice =
    Number(
      p.indice
    );


  const filename =
    limparNome_(
      String(
        p.filename ||
        'arquivo'
      )
    );


  const mimeType =
    String(
      p.mimeType ||
      'application/octet-stream'
    );


  const base64 =
    String(
      p.data || ''
    );


  if (!base64) {

    throw new Error(
      'Dados do arquivo não recebidos.'
    );

  }


  const bytes =
    Utilities.base64Decode(
      base64
    );


  /*
   * Cria o Blob ORIGINAL.
   */

  const blob =
    Utilities.newBlob(
      bytes,
      mimeType,
      filename
    );


  /*
   * Obtém/cria a pasta de destino.
   */

  const pastaDestino =
    obterOuCriarPasta_(
      lote.pasta
    );


  /*
   * Salva diretamente.
   */

  const arquivo =
    pastaDestino.createFile(
      blob
    );


  registrarArquivo_({

    usuario:
      lote.usuario,

    nome:
      arquivo.getName(),

    mimeType:
      arquivo.getMimeType(),

    tamanho:
      arquivo.getSize(),

    status:
      'CONCLUIDO',

    fileId:
      arquivo.getId(),

    url:
      arquivo.getUrl(),

    pasta:
      pastaDestino.getName(),

    ordem:
      indice,

    mensagem:
      'Arquivo salvo sem conversão ou modificação. Ordem: ' +
      (indice + 1)

  });


  registrarLog_(
    'INFO',
    'RECEBER_ARQUIVO',
    lote.usuario,
    'Arquivo "' +
      filename +
      '" salvo na posição ' +
      (indice + 1) +
      ' de ' +
      lote.total +
      '.'
  );


  /*
   * Remove o lote após o último arquivo.
   *
   * Não existe mais nenhuma etapa de
   * conversão ou união.
   */

  if (
    indice + 1 >=
    lote.total
  ) {

    PropertiesService
      .getScriptProperties()
      .deleteProperty(
        'LOTE_' + loteId
      );

  }


  return {

    sucesso:
      true,

    indice:
      indice,

    fileId:
      arquivo.getId(),

    nomeArquivo:
      arquivo.getName(),

    url:
      arquivo.getUrl(),

    pasta:
      pastaDestino.getName(),

    mimeType:
      arquivo.getMimeType(),

    tamanho:
      arquivo.getSize()

  };
}


/* =====================================================
   LOTES
===================================================== */

function obterLote_(loteId) {

  if (!loteId) {
    return null;
  }


  const texto =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        'LOTE_' + loteId
      );


  if (!texto) {
    return null;
  }


  try {

    return JSON.parse(
      texto
    );

  } catch (erro) {

    return null;

  }
}


/* =====================================================
   PASTAS
===================================================== */

function obterOuCriarPasta_(nome) {

  let raiz;


  if (
    CONFIG.ROOT_FOLDER_ID
  ) {

    raiz =
      DriveApp.getFolderById(
        CONFIG.ROOT_FOLDER_ID
      );

  } else {

    raiz =
      DriveApp.getRootFolder();

  }


  const existentes =
    raiz.getFoldersByName(
      nome
    );


  if (
    existentes.hasNext()
  ) {

    return existentes.next();

  }


  return raiz.createFolder(
    nome
  );
}


/* =====================================================
   UTILITÁRIOS
===================================================== */

function limparNome_(nome) {

  return String(
    nome || ''
  )

    .replace(
      /[\\/:*?"<>|]/g,
      '_'
    )

    .trim();
}


/* =====================================================
   TESTE DE AUTORIZAÇÃO
===================================================== */

function testarAutorizacao() {

  try {

    const planilha =
      SpreadsheetApp.openById(
        CONFIG.ID_PLANILHA_USUARIOS
      );


    console.log(
      'Planilha de usuários encontrada: ' +
      planilha.getName()
    );


    const planilhaEnvio =
      SpreadsheetApp.openById(
        CONFIG.ID_PLANILHA_ENVIO
      );


    console.log(
      'Planilha de envio encontrada: ' +
      planilhaEnvio.getName()
    );


    const pasta =
      DriveApp.getFolderById(
        CONFIG.ROOT_FOLDER_ID
      );


    console.log(
      'Pasta principal encontrada: ' +
      pasta.getName()
    );


    console.log(
      'AUTORIZAÇÃO OK'
    );


    return 'AUTORIZAÇÃO OK';


  } catch (erro) {

    console.error(
      erro
    );


    return (
      'ERRO: ' +
      erro.message
    );

  }
}