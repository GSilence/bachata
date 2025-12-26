// Пустой service worker для предотвращения 404 ошибок
// Запросы к этому файлу могут идти от расширений браузера или кэша

// Минимальная реализация для совместимости
self.addEventListener('install', (event) => {
  // Пропускаем установку
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Очищаем старые кэши
  event.waitUntil(self.clients.claim());
});

// Не обрабатываем fetch события - просто игнорируем

