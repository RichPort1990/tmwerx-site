/* Start the office app: load the company's data, draw the frame, then show the screen in the address bar. */
'use strict';
(async () => {
  try {
    await reboot();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="msg err" style="margin:40px">${esc(e.message)}</div>`;
    return;
  }
  drawShell();
  window.addEventListener('hashchange', route);
  route();
  // keep the badges fresh
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const j = await api('GET', '/boot');
      B.boot = j;
      drawNav();
    } catch (e) {
      /* offline for a moment */
    }
  }, 120000);
})();
