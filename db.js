// Banco de dados simples baseado em arquivo JSON — suficiente para o volume
// de clientes esperado nesta fase (dezenas de empresas, não milhões).
// Pode ser trocado por um banco real mais tarde sem mudar o formato das rotas da API.
//
// No Render o arquivo fica no disco persistente (variável DB_PATH, ex.: /data/db.json).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
// A tabela de preços (dados.json do App) fica ao lado do banco, no mesmo disco.
const TABELA_PATH = process.env.TABELA_PATH || path.join(path.dirname(DB_PATH), "tabela.json");

function nowISO() {
  return new Date().toISOString();
}

// Escrita segura: grava num arquivo temporário e troca de nome no final,
// para um corte de energia ou reinício no meio da gravação não corromper o arquivo.
function escreverAtomico(arquivo, texto) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + ".tmp";
  fs.writeFileSync(tmp, texto);
  fs.renameSync(tmp, arquivo);
}

function loadRaw() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { nextId: 1, empresas: [], dispositivos: [], leads: [] };
    escreverAtomico(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  // Se o arquivo estiver ilegível NÃO recriamos um banco vazio (isso apagaria as licenças):
  // o erro sobe e o servidor responde 500 até alguém corrigir.
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!Array.isArray(data.empresas)) data.empresas = [];
  if (!Array.isArray(data.dispositivos)) data.dispositivos = [];
  if (!Array.isArray(data.leads)) data.leads = [];
  if (!data.nextId) data.nextId = 1;
  return data;
}

function save(data) {
  escreverAtomico(DB_PATH, JSON.stringify(data, null, 2));
}

function gerarChaveLicenca() {
  // Formato legível, tipo "VND-8F2K-9QRT-3XZL" — fácil de digitar/conferir.
  const grupo = () => crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
  return `VND-${grupo()}-${grupo()}-${grupo()}`;
}

function listarEmpresas() {
  const data = loadRaw();
  return data.empresas.map((e) => ({
    ...e,
    dispositivos_count: data.dispositivos.filter((d) => d.empresa_id === e.id).length,
  }));
}

function buscarEmpresaPorChave(chave) {
  const data = loadRaw();
  return data.empresas.find((e) => e.chave_licenca === chave) || null;
}

function buscarEmpresaPorId(id) {
  const data = loadRaw();
  return data.empresas.find((e) => e.id === Number(id)) || null;
}

function criarEmpresa({ nome, max_dispositivos = null, expira_em = null }) {
  const data = loadRaw();
  const empresa = {
    id: data.nextId++,
    nome,
    chave_licenca: gerarChaveLicenca(),
    status: "ativa", // ativa | suspensa | cancelada
    max_dispositivos: max_dispositivos ? Number(max_dispositivos) : null,
    expira_em: expira_em || null,
    criado_em: nowISO(),
    atualizado_em: nowISO(),
  };
  data.empresas.push(empresa);
  save(data);
  return empresa;
}

function atualizarEmpresa(id, campos) {
  const data = loadRaw();
  const empresa = data.empresas.find((e) => e.id === Number(id));
  if (!empresa) return null;
  const permitidos = ["nome", "status", "max_dispositivos", "expira_em"];
  for (const k of permitidos) {
    if (campos[k] !== undefined) empresa[k] = campos[k];
  }
  empresa.atualizado_em = nowISO();
  save(data);
  return empresa;
}

function removerEmpresa(id) {
  const data = loadRaw();
  const antes = data.empresas.length;
  data.empresas = data.empresas.filter((e) => e.id !== Number(id));
  data.dispositivos = data.dispositivos.filter((d) => d.empresa_id !== Number(id));
  save(data);
  return data.empresas.length < antes;
}

function listarDispositivos(empresaId) {
  const data = loadRaw();
  return data.dispositivos.filter((d) => d.empresa_id === Number(empresaId));
}

// Libera uma vaga: remove um aparelho da empresa (ex.: vendedor trocou de celular).
function removerDispositivo(empresaId, dispositivoId) {
  const data = loadRaw();
  const antes = data.dispositivos.length;
  data.dispositivos = data.dispositivos.filter(
    (d) => !(d.empresa_id === Number(empresaId) && d.id === Number(dispositivoId))
  );
  save(data);
  return data.dispositivos.length < antes;
}

function regenerarChave(id) {
  const data = loadRaw();
  const empresa = data.empresas.find((e) => e.id === Number(id));
  if (!empresa) return null;
  empresa.chave_licenca = gerarChaveLicenca();
  empresa.atualizado_em = nowISO();
  save(data);
  return empresa;
}

// Registra (ou atualiza) o acesso de um aparelho para uma empresa.
// Retorna { permitido, motivo, empresa } — a checagem de limite de
// aparelhos só bloqueia um aparelho NOVO; um aparelho já conhecido sempre
// pode continuar acessando mesmo que o limite tenha sido reduzido depois.
function registrarAcesso(chave, deviceId) {
  const data = loadRaw();
  const empresa = data.empresas.find((e) => e.chave_licenca === chave);
  if (!empresa) {
    return { permitido: false, motivo: "Chave de licença não encontrada." };
  }
  if (empresa.status === "suspensa") {
    return { permitido: false, motivo: "Assinatura suspensa. Fale com o administrador." };
  }
  if (empresa.status === "cancelada") {
    return { permitido: false, motivo: "Licença cancelada. Fale com o administrador." };
  }
  if (empresa.expira_em && new Date(empresa.expira_em).getTime() < Date.now()) {
    return { permitido: false, motivo: "Assinatura vencida. Fale com o administrador." };
  }

  const existente = data.dispositivos.find(
    (d) => d.empresa_id === empresa.id && d.device_id === deviceId
  );

  if (!existente && empresa.max_dispositivos) {
    const count = data.dispositivos.filter((d) => d.empresa_id === empresa.id).length;
    if (count >= empresa.max_dispositivos) {
      return {
        permitido: false,
        motivo: `Limite de ${empresa.max_dispositivos} aparelho(s) ativo(s) atingido para esta licença.`,
      };
    }
  }

  if (existente) {
    existente.ultimo_acesso = nowISO();
  } else {
    data.dispositivos.push({
      id: data.nextId++,
      empresa_id: empresa.id,
      device_id: deviceId,
      primeiro_acesso: nowISO(),
      ultimo_acesso: nowISO(),
    });
  }
  save(data);

  return {
    permitido: true,
    empresa: { nome: empresa.nome, status: empresa.status },
  };
}

// ---- Leads (página de captação) -----------------------------------------
function criarLead({ nome, telefone, cidade, tipoCriacao, interesse, quantidade, mensagem, origem }) {
  const data = loadRaw();
  const corta = (v, n) => (v == null ? null : String(v).slice(0, n));
  const lead = {
    id: data.nextId++,
    nome: corta(nome, 120),
    telefone: corta(telefone, 40),
    cidade: corta(cidade, 80),
    tipoCriacao: corta(tipoCriacao, 80),
    interesse: corta(interesse, 200),
    quantidade: corta(quantidade, 40),
    mensagem: corta(mensagem, 1000),
    origem: corta(origem, 80),
    status: "novo",
    criado_em: nowISO(),
    atualizado_em: nowISO(),
  };
  data.leads.push(lead);
  save(data);
  return lead;
}

function listarLeads() {
  return loadRaw().leads.slice().reverse();
}

function atualizarLead(id, campos) {
  const data = loadRaw();
  const lead = data.leads.find((l) => l.id === Number(id));
  if (!lead) return null;
  const permitidos = ["status", "observacao", "notas", "nome", "telefone", "cidade", "interesse", "quantidade"];
  for (const k of permitidos) {
    if (campos[k] !== undefined) lead[k] = campos[k];
  }
  lead.atualizado_em = nowISO();
  save(data);
  return lead;
}

function removerLead(id) {
  const data = loadRaw();
  const antes = data.leads.length;
  data.leads = data.leads.filter((l) => l.id !== Number(id));
  save(data);
  return data.leads.length < antes;
}

// ---- Tabela de preços (entregue só a licenças ativas) ---------------------
const num = (v) => typeof v === "number" && isFinite(v);

function validarTabela(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "arquivo inválido";
  if (typeof d.versao !== "string" || !/^\d{4}-\d{2}-\d{2}(\.\d+)?$/.test(d.versao)) return "versão inválida (use AAAA-MM-DD.N)";
  if (!Array.isArray(d.produtos) || d.produtos.length < 1) return "sem produtos";
  const cods = new Set();
  for (const p of d.produtos) {
    if (!p || typeof p.cod !== "string" || !p.cod || typeof p.nome !== "string" || !p.nome) return "produto sem código ou nome";
    if (cods.has(p.cod)) return "código repetido: " + p.cod;
    cods.add(p.cod);
    if (p.peso !== 25 && p.peso !== 30) return "peso do saco inválido em " + p.nome;
    for (const k of ["vista", "d30", "d3060", "d306090"]) {
      if (!num(p[k]) || p[k] <= 0) return "preço inválido em " + p.nome + " (" + k + ")";
    }
    if (p.vista > p.d30 || p.d30 > p.d3060 || p.d3060 > p.d306090) return "prazos fora de ordem em " + p.nome;
  }
  if (!Array.isArray(d.termos) || d.termos.length < 4) return "faltam os prazos de pagamento (termos)";
  if (!Array.isArray(d.descontos) || d.descontos.length < 1) return "faltam os descontos";
  if (!d.frete || typeof d.frete !== "object" || Array.isArray(d.frete) || Object.keys(d.frete).length < 1) return "falta a tabela de frete";
  return "";
}

function lerTabela() {
  if (!fs.existsSync(TABELA_PATH)) return null;
  return JSON.parse(fs.readFileSync(TABELA_PATH, "utf8"));
}

function cmpVersao(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  if (pa[0] !== pb[0]) return pa[0] > pb[0] ? 1 : -1;
  return (parseInt(pa[1], 10) || 0) - (parseInt(pb[1], 10) || 0);
}

function salvarTabela(d) {
  const erro = validarTabela(d);
  if (erro) return { ok: false, erro };
  // não deixa publicar uma versão mais antiga (ou outra tabela com o mesmo número de versão)
  const atual = lerTabela();
  if (atual) {
    const c = cmpVersao(d.versao, atual.versao);
    if (c < 0) return { ok: false, erro: "a versão " + d.versao + " é mais antiga que a publicada (" + atual.versao + ")" };
    if (c === 0 && JSON.stringify(atual) !== JSON.stringify(d)) {
      return { ok: false, erro: "já existe uma tabela com a versão " + d.versao + " e conteúdo diferente; gere uma versão nova" };
    }
  }
  escreverAtomico(TABELA_PATH, JSON.stringify(d));
  return { ok: true, meta: metaTabela() };
}

function metaTabela() {
  const t = lerTabela();
  if (!t) return { existe: false };
  return {
    existe: true,
    versao: t.versao,
    titulo: t.titulo || "",
    vigenteDesde: t.vigenteDesde || "",
    produtos: t.produtos.length,
    atualizadoEm: fs.statSync(TABELA_PATH).mtime.toISOString(),
  };
}

module.exports = {
  listarEmpresas,
  buscarEmpresaPorChave,
  buscarEmpresaPorId,
  criarEmpresa,
  atualizarEmpresa,
  removerEmpresa,
  listarDispositivos,
  removerDispositivo,
  regenerarChave,
  registrarAcesso,
  criarLead,
  listarLeads,
  atualizarLead,
  removerLead,
  lerTabela,
  salvarTabela,
  metaTabela,
};
