const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const app = express();
app.set("trust proxy", 1); // atrás do proxy do Render: usa o IP real do visitante
app.use(cors());

// Corpo das requisições: pequeno em geral; a tabela de preços (admin) pode ser maior.
app.use((req, res, next) => {
  const limite = req.path === "/api/admin/tabela" ? "6mb" : "50kb";
  express.json({ limit: limite })(req, res, next);
});

// A senha do painel vem SÓ da variável de ambiente ADMIN_TOKEN (configurada no Render).
// Sem ela, as rotas de administrador ficam desligadas — nunca há uma senha padrão.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const PORT = process.env.PORT || 3000;

function hashar(t) {
  return crypto.createHash("sha256").update(String(t)).digest();
}

function checarAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ erro: "Painel desligado: defina ADMIN_TOKEN no servidor." });
  }
  const token = req.headers["x-admin-token"];
  if (!token || !crypto.timingSafeEqual(hashar(token), hashar(ADMIN_TOKEN))) {
    return res.status(401).json({ erro: "Token de administrador inválido." });
  }
  next();
}

// Limitador simples por IP (em memória): protege contra tentativas repetidas.
function limitar(max, janelaMs) {
  const mapa = new Map();
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, v] of mapa) if (v.fim < agora) mapa.delete(ip);
  }, janelaMs).unref();
  return (req, res, next) => {
    const agora = Date.now();
    let v = mapa.get(req.ip);
    if (!v || v.fim < agora) {
      v = { n: 0, fim: agora + janelaMs };
      mapa.set(req.ip, v);
    }
    v.n++;
    if (v.n > max) {
      return res.status(429).json({ valido: false, erro: "Muitas tentativas. Aguarde um pouco e tente de novo.", motivo: "Muitas tentativas. Aguarde um pouco e tente de novo." });
    }
    next();
  };
}
const limiteLicenca = limitar(60, 60 * 1000);
const limiteLeads = limitar(8, 10 * 60 * 1000);

function textoCurto(v, n) {
  return typeof v === "string" && v.length > 0 && v.length <= n;
}

// ---------------------------------------------------------------------
// Rota pública — é essa que o app Vendas chama ao abrir, pra conferir se
// a licença da empresa está ativa antes de liberar o uso.
// ---------------------------------------------------------------------
app.post("/api/validar-licenca", limiteLicenca, (req, res) => {
  const { chave, deviceId } = req.body || {};
  if (!textoCurto(chave, 64) || !textoCurto(deviceId, 64)) {
    return res.status(400).json({ valido: false, motivo: "Faltou a chave de licença ou o identificador do aparelho." });
  }
  const resultado = db.registrarAcesso(chave, deviceId);
  res.json({ valido: resultado.permitido, motivo: resultado.motivo, empresa: resultado.empresa });
});

// ---------------------------------------------------------------------
// Tabela de preços — só é entregue para licença ativa (mesma checagem acima).
// O arquivo do app, sozinho, não traz preço nenhum.
// ---------------------------------------------------------------------
app.post("/api/tabela", limiteLicenca, (req, res) => {
  const { chave, deviceId } = req.body || {};
  if (!textoCurto(chave, 64) || !textoCurto(deviceId, 64)) {
    return res.status(400).json({ valido: false, motivo: "Faltou a chave de licença ou o identificador do aparelho." });
  }
  const r = db.registrarAcesso(chave, deviceId);
  if (!r.permitido) {
    return res.status(403).json({ valido: false, motivo: r.motivo });
  }
  const tabela = db.lerTabela();
  if (!tabela) {
    return res.status(404).json({ valido: true, motivo: "A tabela de preços ainda não foi publicada no servidor." });
  }
  res.set("Cache-Control", "no-store");
  res.json(tabela);
});

// ---------------------------------------------------------------------
// Rota pública — recebe os contatos da página de captação de clientes
// (public/captacao.html). Não exige token de admin, senão o formulário
// público não funciona. Tem limite de envios por IP contra spam.
// ---------------------------------------------------------------------
app.post("/api/leads", limiteLeads, (req, res) => {
  const { nome, telefone, cidade, tipoCriacao, interesse, quantidade, mensagem, origem } = req.body || {};
  if (!nome || !telefone) {
    return res.status(400).json({ erro: "Informe ao menos nome e telefone." });
  }
  const lead = db.criarLead({ nome, telefone, cidade, tipoCriacao, interesse, quantidade, mensagem, origem });
  res.status(201).json({ ok: true, id: lead.id });
});

// ---------------------------------------------------------------------
// Rotas administrativas — protegidas por token (cabeçalho x-admin-token).
// ---------------------------------------------------------------------
app.get("/api/admin/empresas", checarAdmin, (req, res) => {
  res.json(db.listarEmpresas());
});

app.post("/api/admin/empresas", checarAdmin, (req, res) => {
  const { nome, max_dispositivos, expira_em } = req.body || {};
  if (!nome) return res.status(400).json({ erro: "Informe o nome da empresa." });
  const empresa = db.criarEmpresa({ nome, max_dispositivos, expira_em });
  res.status(201).json(empresa);
});

app.patch("/api/admin/empresas/:id", checarAdmin, (req, res) => {
  const empresa = db.atualizarEmpresa(req.params.id, req.body || {});
  if (!empresa) return res.status(404).json({ erro: "Empresa não encontrada." });
  res.json(empresa);
});

app.delete("/api/admin/empresas/:id", checarAdmin, (req, res) => {
  const ok = db.removerEmpresa(req.params.id);
  if (!ok) return res.status(404).json({ erro: "Empresa não encontrada." });
  res.status(204).send();
});

app.post("/api/admin/empresas/:id/regenerar-chave", checarAdmin, (req, res) => {
  const empresa = db.regenerarChave(req.params.id);
  if (!empresa) return res.status(404).json({ erro: "Empresa não encontrada." });
  res.json(empresa);
});

app.get("/api/admin/empresas/:id/dispositivos", checarAdmin, (req, res) => {
  const empresa = db.buscarEmpresaPorId(req.params.id);
  if (!empresa) return res.status(404).json({ erro: "Empresa não encontrada." });
  res.json(db.listarDispositivos(req.params.id));
});

// Libera uma vaga de aparelho (ex.: o vendedor trocou de celular).
app.delete("/api/admin/empresas/:id/dispositivos/:did", checarAdmin, (req, res) => {
  const ok = db.removerDispositivo(req.params.id, req.params.did);
  if (!ok) return res.status(404).json({ erro: "Aparelho não encontrado." });
  res.status(204).send();
});

app.get("/api/admin/leads", checarAdmin, (req, res) => {
  res.json(db.listarLeads());
});

app.patch("/api/admin/leads/:id", checarAdmin, (req, res) => {
  const lead = db.atualizarLead(req.params.id, req.body || {});
  if (!lead) return res.status(404).json({ erro: "Lead não encontrado." });
  res.json(lead);
});

app.delete("/api/admin/leads/:id", checarAdmin, (req, res) => {
  const ok = db.removerLead(req.params.id);
  if (!ok) return res.status(404).json({ erro: "Lead não encontrado." });
  res.status(204).send();
});

// Tabela de preços: ver qual versão está publicada e publicar uma nova.
app.get("/api/admin/tabela", checarAdmin, (req, res) => {
  res.json(db.metaTabela());
});

app.put("/api/admin/tabela", checarAdmin, (req, res) => {
  const r = db.salvarTabela(req.body);
  if (!r.ok) return res.status(400).json({ erro: "Tabela recusada: " + r.erro + "." });
  res.json(r.meta);
});

// Tratamento de erro: corpo inválido ou grande demais, ou falha ao ler o banco.
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ erro: "Arquivo grande demais." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "JSON inválido." });
  }
  console.error(err);
  res.status(500).json({ erro: "Erro interno no servidor." });
});

// Painel administrativo simples (HTML estático) — pede o token de admin
// e conversa com as rotas acima via fetch.
app.use("/admin", express.static(path.join(__dirname, "public")));

// Cópias hospedadas do app "Vendas" para cada cliente — cada uma é o arquivo
// gerado no Editor (já com a chave de licença daquele cliente embutida),
// subida em public/app/<nome-do-cliente>/index.html. Hospedar assim (em vez
// de mandar o arquivo solto) permite que o celular do cliente reconheça o
// app como instalável de verdade, com ícone próprio na tela inicial.
app.use("/app", express.static(path.join(__dirname, "public", "app")));

// PDFs dos materiais técnicos (catálogos) exibidos dentro do app Vendas em
// "Meu Desempenho" — o app guarda só o link (public/materiais/<arquivo>.pdf),
// então basta trocar o arquivo aqui e o link continua funcionando.
app.use("/materiais", express.static(path.join(__dirname, "public", "materiais")));

// Página pública de captação de clientes (formulário de leads) — link para
// divulgar no WhatsApp/Instagram/etc. Sem token, sem login: qualquer visitante
// pode abrir e preencher.
app.get("/captacao", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "captacao.html"));
});

app.get("/", (req, res) => {
  res.type("text/plain").send("Vendas — API de licenciamento no ar. Painel em /admin");
});

app.listen(PORT, () => {
  console.log(`API de licenciamento rodando na porta ${PORT}`);
  if (!ADMIN_TOKEN) console.warn("ATENÇÃO: ADMIN_TOKEN não definido — rotas de administrador desligadas.");
});
