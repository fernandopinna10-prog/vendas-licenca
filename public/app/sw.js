// Service worker compartilhado por todos os clientes do VendaCampo
// (public/app/<cliente>/index.html). Sua única função é guardar uma cópia
// da página do app neste aparelho na primeira vez que ela abrir com
// internet, para que nas próximas vezes — mesmo sem sinal no campo — o
// vendedor consiga abrir o app normalmente, a partir dessa cópia local.
//
// Ele NÃO interfere em nada além do carregamento da própria página:
// chamadas de licença (/api/validar-licenca), fontes externas, etc.
// continuam seguindo direto para a rede, sem passar por aqui.

const CACHE_NAME = 'vendacampo-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só cuidamos do carregamento da página em si (abrir o link/instalar o
  // app). Qualquer outra coisa — chamada de API, fonte, etc. — segue o
  // caminho normal do navegador, sem passar pelo cache.
  if (req.method !== 'GET' || req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req)
      .then((resp) => {
        // Conseguiu buscar na rede — guarda essa versão mais nova para a
        // próxima vez que estiver offline, e entrega ela normalmente.
        const copia = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        return resp;
      })
      .catch(() =>
        // Sem rede — tenta entregar a última cópia salva deste mesmo link.
        caches.match(req).then((cached) => cached || caches.match(req.url))
      )
  );
});
