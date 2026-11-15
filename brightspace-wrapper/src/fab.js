/* On every other Brightspace page: a small floating button back to Lumen. */
(function () {
  if (window.top !== window) return; // skip iframes (content viewers, quizzes…)
  if (document.documentElement.classList.contains('lumen')) return; // Lumen itself is showing
  const ou = new URLSearchParams(location.search).get('ou') || (location.pathname.match(/\/d2l\/(?:le\/content|home|le)\/(\d+)/) || [])[1];
  const a = document.createElement('a');
  a.className = 'lumen-fab';
  a.href = ou ? `/d2l/home/${ou}?lumen=on` : '/d2l/home?lumen=on';
  a.title = 'Back to Lumen';
  a.innerHTML = `<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="${window.Lumen.ICONS['school-fill']}"/></svg><span>Lumen</span>`;
  const add = () => document.body && document.body.append(a);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
})();
