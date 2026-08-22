const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "troque-este-token-admin";
const PORT = process.env.PORT || 3000;

function checarAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ erro: "Token de administrador inválido." });
  }
  next();
}

// ---------------------------------------------------------------------
// Rota pública — é essa que o app Vendas chama ao abrir, pra conferir se
// a licença da empresa está ativa antes de liberar o uso.
// ---------------------------------------------------------------------
app.post("/api/validar-licenca", (req, res) => {
  const { chave, deviceId } = req.body || {};
  if (!chave || !deviceId) {
    return res.status(400).json({ valido: false, motivo: "Faltou a chave de licença ou o identificador do aparelho." });
  }
  const resultado = db.registrarAcesso(chave, deviceId);
  res.json({ valido: resultado.permitido, motivo: resultado.motivo, empresa: resultado.empresa });
});

// ---------------------------------------------------------------------
// Rotas administrativas — protegidas por token simples (cabeçalho
// x-admin-token). Fase 1 não tem login de verdade ainda; isso chega na
// Fase 3 (painel administrativo completo).
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

// Painel administrativo simples (HTML estático) — pede o token de admin
// e conversa com as rotas acima via fetch.
app.use("/admin", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.type("text/plain").send("Vendas — API de licenciamento no ar. Painel em /admin");
});

app.listen(PORT, () => {
  console.log(`API de licenciamento rodando na porta ${PORT}`);
});
