const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

export function register(config) {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
    if (publicUrl.origin !== window.location.origin) return;

    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() => {
          console.log('PWA: running in localhost with service worker.');
        });
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // 🔄 มี version ใหม่ → skip waiting แล้ว reload ทันที (กัน user เห็นโค้ดเก่า)
              if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              window.location.reload();
              if (config && config.onUpdate) config.onUpdate(registration);
            } else {
              if (config && config.onSuccess) config.onSuccess(registration);
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('Service worker registration failed:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (response.status === 404 || (contentType && !contentType.includes('javascript'))) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('No internet connection. App is running in offline mode.');
    });
}

// 🧹 ล้าง service worker + cache เก่าทิ้งให้หมด
// ⚠️ เดิมรอ navigator.serviceWorker.ready ซึ่ง "ไม่มีวัน resolve" ถ้า SW ตัวเก่าพัง
//    (โปรเจกต์นี้ไม่มี workbox → ไม่เคยมีไฟล์ service-worker.js จริง แต่โค้ดสั่ง register
//     → เบราว์เซอร์ได้หน้า 404 HTML กลับมา → SW ค้างครึ่ง ๆ กลาง ๆ
//     → ถ้าเคยลงทะเบียนสำเร็จมาก่อน จะเสิร์ฟไฟล์เก่าค้าง deploy ใหม่ไม่มีผล)
//    ใช้ getRegistrations() แทน — ได้ทุกตัวที่มีอยู่จริง ไม่ต้องรอ ready
export function unregister() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations()
    .then(regs => {
      if (regs.length === 0) return;
      console.info(`[sw] ล้าง service worker เก่า ${regs.length} ตัว`);
      return Promise.all(regs.map(r => r.unregister()));
    })
    .catch(e => console.warn('[sw] unregister failed:', e?.message || e));
  // ล้าง cache ที่ SW เก่าทิ้งไว้ด้วย — ไม่งั้นไฟล์เก่ายังค้างในเครื่อง
  if ('caches' in window) {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .catch(() => {});
  }
}
