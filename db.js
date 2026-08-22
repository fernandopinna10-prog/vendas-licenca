// Banco de dados simples baseado em arquivo JSON — suficiente para o volume
// de clientes esperado nesta fase (dezenas de empresas, não milhões).
// Evita depender de um banco de verdade (Postgres etc.) para manter a Fase 1
// simples de rodar e implantar. Pode ser trocado por um banco real mais
// tarde sem mudar o formato das rotas da API.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

function nowISO() {
  return new Date().toISOString();
}

function loadRaw() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { nextId: 1, empresas: [], dispositivos: [] };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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

module.exports = {
  listarEmpresas,
  buscarEmpresaPorChave,
  buscarEmpresaPorId,
  criarEmpresa,
  atualizarEmpresa,
  removerEmpresa,
  listarDispositivos,
  regenerarChave,
  registrarAcesso,
};
