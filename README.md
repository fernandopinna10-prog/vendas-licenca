# Vendas — API de Licenciamento (Fase 1)

Servidor mínimo que confere, a cada abertura do app "Vendas", se a licença
da empresa está ativa. Permite suspender ou cancelar o acesso de um
cliente remotamente, sem precisar gerar nenhum código manualmente.

## O que este servidor faz

- Guarda uma lista de empresas clientes, cada uma com uma **chave de
  licença** própria (gerada automaticamente ao cadastrar).
- Toda vez que o app Vendas abre (com internet disponível), ele manda a
  chave de licença + um identificador do aparelho para este servidor.
- O servidor responde se está liberado ou não, com o motivo (assinatura
  suspensa, vencida, chave inválida, etc.).
- Um painel web simples (`/admin`) para você cadastrar empresas, ver
  quantos aparelhos estão ativos por empresa, suspender/reativar/cancelar,
  e gerar uma nova chave se precisar invalidar a antiga.

## Rodando localmente (teste)

```bash
npm install
ADMIN_TOKEN=escolha-um-token-forte PORT=3000 node server.js
```

Depois acesse `http://localhost:3000/admin/admin.html` e entre com o
mesmo `ADMIN_TOKEN` que você definiu.

## Colocando no ar de verdade (deploy)

Sugestão: [Render](https://render.com) — tem plano gratuito, suficiente
para começar.

1. Crie uma conta em render.com (gratuito).
2. Suba esta pasta inteira para um repositório no GitHub (ou use o botão
   de deploy manual do Render, subindo um `.zip`).
3. No Render, crie um novo **Web Service**, apontando para esse
   repositório/pasta.
4. Configure:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
5. Em "Environment Variables", adicione:
   - `ADMIN_TOKEN` = escolha um token forte e secreto (só você deve saber)
   - (a variável `PORT` o Render já define sozinho, não precisa mexer)
6. Clique em "Deploy". Em alguns minutos você recebe um endereço tipo
   `https://vendas-licenca.onrender.com`.

**Atenção sobre o plano gratuito do Render:** ele "dorme" depois de um
tempo sem uso e demora alguns segundos para acordar na primeira
requisição do dia — o app Vendas já tolera isso (tenta por até 6
segundos, e se a primeira tentativa falhar, o cliente só precisa tocar em
"Tentar novamente"). Se isso incomodar no dia a dia, um plano pago barato
(a partir de uns US$7/mês) resolve, mantendo o servidor sempre acordado.

## Guardando o arquivo de dados

Este servidor usa um arquivo simples (`data/db.json`) para guardar as
empresas cadastradas — não é um banco de dados de verdade, mas é
suficiente para o volume esperado (algumas dezenas de clientes). No
Render, configure um **Disk** (armazenamento persistente) apontando para
a pasta `data/`, senão os cadastros somem a cada novo deploy.

## Como usar no dia a dia

1. Acesse `/admin/admin.html`, entre com o token de administrador.
2. Cadastre uma empresa nova (nome, e opcionalmente um limite de
   aparelhos e uma data de vencimento). O painel mostra a **chave de
   licença** gerada — copie ela.
3. No app Vendas, entre no Editor (senha do editor) → "Licenciamento do
   app" → desbloqueie com a chave mestra → preencha "Endereço da API"
   (o link do Render) e "Chave de licença desta empresa" (a chave
   copiada no passo 2).
4. Clique em "Gerar e baixar novo arquivo" e mande esse arquivo para o
   cliente. A partir daí, o app dele confere a licença com o servidor
   toda vez que abrir com internet.
5. Se o cliente parar de pagar: volte no painel, clique em "Suspender" —
   o acesso dele é bloqueado na próxima vez que o app tentar abrir
   online (não precisa esperar ele "gastar" a ativação local).

## Rotas da API (referência técnica)

| Rota | Autenticação | Descrição |
|---|---|---|
| `POST /api/validar-licenca` | pública | `{chave, deviceId}` → `{valido, motivo}` |
| `GET /api/admin/empresas` | header `x-admin-token` | lista empresas |
| `POST /api/admin/empresas` | header `x-admin-token` | `{nome, max_dispositivos?, expira_em?}` → cria |
| `PATCH /api/admin/empresas/:id` | header `x-admin-token` | atualiza campos (ex: `{status:"suspensa"}`) |
| `DELETE /api/admin/empresas/:id` | header `x-admin-token` | remove empresa |
| `POST /api/admin/empresas/:id/regenerar-chave` | header `x-admin-token` | invalida a chave atual e gera outra |
| `GET /api/admin/empresas/:id/dispositivos` | header `x-admin-token` | lista aparelhos ativos daquela empresa |
