// Работа веб-версии без интернета. Страница — сначала из сети (чтобы сразу получать новые версии),
// при отсутствии сети — из сохранённой копии. Файлы программы с хешем в имени не меняются — берём из копии.
const APP_URL = self.registration.scope
const CACHE = `spin-trainer:${APP_URL}:v1`

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './favicon.png'].map((path) => new URL(path, APP_URL).href))))
  self.skipWaiting()
})

const LEGACY_CACHE = 'spin-trainer-v1'

/** До версии 0.13 копия называлась одинаково для всех. Удаляем её, только если она принадлежит этому приложению
 *  (в ней лежит страница с нашим адресом) — чужую (основную или тестовую версию рядом) не трогаем. */
async function dropOwnLegacyCache() {
  if (!(await caches.has(LEGACY_CACHE))) return
  const old = await caches.open(LEGACY_CACHE)
  if (await old.match(APP_URL)) await caches.delete(LEGACY_CACHE)
}

self.addEventListener('activate', (e) => {
  // Не удаляем кеш других приложений и основной версии на том же домене.
  e.waitUntil(
    dropOwnLegacyCache()
      .catch(() => {})
      .then(() => self.clients.claim()),
  )
})

/** Удалить из офлайн-копии файлы программы (assets/…), которых нет в свежей странице. */
async function cleanOldAssets(html) {
  const used = new Set((html.match(/assets\/[A-Za-z0-9._-]+/g) || []).map((p) => p.split('/').pop()))
  if (!used.size) return
  const c = await caches.open(CACHE)
  for (const req of await c.keys()) {
    const m = new URL(req.url).pathname.match(/\/assets\/([^/]+)$/)
    // Основные файлы страницы оставляем; дополнительные куски (подгружаются позже) имеют тот же срок жизни, что и версия.
    if (m && !used.has(m[1]) && /^index-/.test(m[1])) await c.delete(req)
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(APP_URL)) return
  // Вложенное приложение (тестовая версия в папке preview/) обслуживает себя само. Пока его собственный
  // обработчик не включился, такие запросы приходят сюда — пропускаем, иначе чужая страница
  // сохранится как наша офлайн-копия.
  if (url.href.startsWith(APP_URL + 'preview/')) return
  // Установщик и файл обновлений не кешируем.
  if (url.pathname.includes('/download/')) return

  if (req.mode === 'navigate') {
    // Офлайн-копия — только сама страница приложения (с любыми параметрами, например окно чарта).
    const page = url.origin + url.pathname
    if (page !== APP_URL && page !== APP_URL + 'index.html') return
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          const forClean = res.clone()
          caches.open(CACHE).then((c) => c.put(APP_URL, copy))
          // Пришла свежая страница — убираем из СВОЕЙ копии файлы прошлых версий, на которые она больше не ссылается.
          if (res.ok) forClean.text().then(cleanOldAssets).catch(() => {})
          return res
        })
        .catch(() => caches.open(CACHE).then((c) => c.match(APP_URL))),
    )
    return
  }

  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req)).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
