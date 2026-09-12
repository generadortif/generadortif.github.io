/* ============================================================================
   theme.js
   Modo oscuro. Por defecto sigue la preferencia del sistema operativo
   (prefers-color-scheme, resuelto en css/app.css); el botón 🌙/☀️ de la
   barra superior permite forzar un tema y lo recuerda en localStorage
   (clave "tif_theme"). El script inline en <head> de index.html aplica
   esa preferencia guardada antes de pintar la página, para evitar el
   parpadeo de un tema incorrecto al cargar.
   ========================================================================== */

(function () {
  const STORAGE_KEY = 'tif_theme';
  const btn = document.getElementById('btnThemeToggle');
  if (!btn) return;

  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

  function storedTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function effectiveTheme() {
    return storedTheme() || (prefersDark && prefersDark.matches ? 'dark' : 'light');
  }

  function updateButton() {
    const eff = effectiveTheme();
    btn.textContent = eff === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro';
    btn.title = eff === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    btn.setAttribute('aria-label', btn.title);
  }

  btn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* sigue funcionando sin persistir */ }
    document.documentElement.setAttribute('data-theme', next);
    updateButton();
  });

  // Si el usuario no forzó un tema, seguir reflejando cambios del sistema
  // operativo en vivo (por ejemplo, si Windows pasa a modo oscuro a la
  // noche automáticamente).
  if (prefersDark && prefersDark.addEventListener) {
    prefersDark.addEventListener('change', () => {
      if (!storedTheme()) updateButton();
    });
  }

  updateButton();
})();
