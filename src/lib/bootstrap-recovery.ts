// Runs before hydration: a missing initial script can leave React waiting before
// its error boundary is available. Append an independent notice; never replace
// the app DOM, reload, reset a form, or suppress the original error.
export const bootstrapRecoveryScript = `(() => {
  let pending = false;
  function showRecovery() {
    if (!/^\\/admin(?:\\/|$)/.test(location.pathname)) return;
    if (!document.body) {
      if (!pending) {
        pending = true;
        document.addEventListener('DOMContentLoaded', showRecovery, { once: true });
      }
      return;
    }
    if (document.getElementById('tips-script-recovery') || document.querySelector('[data-page-recovery]')) return;
    const notice = document.createElement('aside');
    notice.id = 'tips-script-recovery';
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;max-width:440px;margin:auto;padding:20px;box-sizing:border-box;border:1px solid #737373;border-radius:12px;background:#fff;color:#171717;font:16px/1.6 system-ui,sans-serif;box-shadow:0 4px 24px #0002';
    const title = document.createElement('h2');
    title.textContent = '화면을 불러오지 못했습니다';
    title.style.cssText = 'font-size:20px;margin:0 0 8px';
    const message = document.createElement('p');
    message.textContent = '현재 탭은 그대로 두고 새 탭에서 다시 열어 주세요. 저장 여부를 확인한 뒤 작업을 이어가세요.';
    message.style.cssText = 'margin:0 0 8px';
    const link = document.createElement('a');
    const url = new URL(location.href);
    url.searchParams.set('_tips_recovery', String(Date.now()));
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '새 탭에서 다시 열기';
    link.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;color:inherit;text-underline-offset:4px';
    const previousFocus = document.activeElement;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '닫기';
    close.setAttribute('aria-label', '오류 안내 닫기');
    close.style.cssText = 'min-height:44px;margin-left:16px;padding:0 12px;border:1px solid #737373;border-radius:6px;background:#fff;color:#171717;font:inherit;cursor:pointer';
    close.addEventListener('click', () => {
      notice.remove();
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
    });
    notice.append(title, message, link, close);
    document.body.appendChild(notice);
  }
  function isAppScript(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js');
    } catch { return false; }
  }
  window.addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement && isAppScript(target.src)) showRecovery();
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error && error.name === 'ChunkLoadError' && isAppScript(error.request)) showRecovery();
  });
  // Stylesheets can delay this inline script until a cached 404 has already
  // fired its error event. Inspect completed responses after installing listeners.
  for (const entry of performance.getEntriesByType?.('resource') || []) {
    if (entry.initiatorType === 'script' && entry.responseStatus >= 400 && isAppScript(entry.name)) showRecovery();
  }
})();`;
