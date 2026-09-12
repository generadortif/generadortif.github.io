/* ============================================================================
   app.js
   Punto de entrada: arma la navegación, conecta el formulario con el
   estado, la barra de progreso, el autoguardado, la vista previa y las
   exportaciones a DOCX / PDF.
   ========================================================================== */

(function () {
  const { SECTIONS } = window.TIF_SCHEMA;
  const { loadState, saveStateToStorage, clearStateStorage, exportStateAsJSONFile, importStateFromJSONFile } = window.TIF_STATE_UTILS;
  const { validateAll, getMissingSummary } = window.TIF_VALIDATE;

  let state = loadState();
  let currentIndex = 0;
  let saveTimer = null;
  let backupHandle = null; // File System Access API: handle del archivo de respaldo (ver filebackup.js)

  const navList = document.getElementById('navList');
  const formRoot = document.getElementById('formRoot');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const saveStatus = document.getElementById('saveStatus');

  // ---------------- Navegación móvil (cajón desplegable de secciones) ----------------
  const sidebarEl = document.getElementById('sidebar');
  const mobileNavLabel = document.getElementById('mobileNavLabel');
  const btnMobileNav = document.getElementById('btnMobileNav');
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  function openMobileSidebar() { sidebarEl.classList.add('sidebar-open'); }
  function closeMobileSidebar() { sidebarEl.classList.remove('sidebar-open'); }
  btnMobileNav.addEventListener('click', openMobileSidebar);
  btnCloseSidebar.addEventListener('click', closeMobileSidebar);

  function scheduleAutosave() {
    saveStatus.textContent = 'Guardando…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveStateToStorage(state);
      if (backupHandle) {
        try {
          await window.TIF_FILEBACKUP.writeBackup(backupHandle, state);
          saveStatus.textContent = `Borrador guardado · 📁 ${backupHandle.name}`;
          updateFileBackupUI('active');
        } catch (err) {
          console.warn('No se pudo escribir el respaldo en archivo:', err);
          saveStatus.textContent = 'Borrador guardado (falló el respaldo en archivo)';
          updateFileBackupUI('error');
        }
      } else {
        saveStatus.textContent = 'Borrador guardado';
      }
      setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    }, 500);
  }

  function renderNav() {
    const { results, progress } = validateAll(state);
    navList.innerHTML = '';
    SECTIONS.forEach((section, idx) => {
      const li = document.createElement('li');
      li.className = 'nav-item' + (idx === currentIndex ? ' active' : '');
      const ok = results[section.id].valid;
      li.innerHTML = `<span class="nav-badge ${ok ? 'ok' : 'pending'}">${ok ? '✓' : idx + 1}</span><span>${section.short}</span>`;
      li.addEventListener('click', () => { currentIndex = idx; renderAll(); closeMobileSidebar(); });
      navList.appendChild(li);
    });
    progressFill.style.width = `${progress}%`;
    progressLabel.textContent = `${progress}% completo`;
    mobileNavLabel.textContent = `${currentIndex + 1}. ${SECTIONS[currentIndex].short.replace(/^\d+\.\s*/, '')}`;
  }

  function renderForm() {
    const section = SECTIONS[currentIndex];
    window.TIF_RENDER_FORM.renderSectionForm(formRoot, section, state, () => {
      renderNav();
      scheduleAutosave();
    });
    btnPrev.disabled = currentIndex === 0;
    btnNext.textContent = currentIndex === SECTIONS.length - 1 ? 'Finalizar' : 'Siguiente →';
    const scroller = document.getElementById('contentScroll');
    if (scroller) scroller.scrollTop = 0;
  }

  function renderAll() {
    renderNav();
    renderForm();
  }

  btnPrev.addEventListener('click', () => {
    if (currentIndex > 0) { currentIndex -= 1; renderAll(); }
  });
  btnNext.addEventListener('click', () => {
    if (currentIndex < SECTIONS.length - 1) { currentIndex += 1; renderAll(); }
    else openPreview();
  });

  // ---------------- Toolbar: nuevo / guardar / abrir proyecto ----------------
  document.getElementById('btnNuevo').addEventListener('click', () => {
    if (!confirm('¿Empezar un TIF nuevo? Se perderá el borrador actual guardado en este navegador (podés exportarlo antes como JSON).')) return;
    clearStateStorage();
    state = loadState();
    currentIndex = 0;
    renderAll();
  });

  document.getElementById('btnGuardarJson').addEventListener('click', () => {
    exportStateAsJSONFile(state);
  });

  const fileInput = document.getElementById('fileInputJson');
  document.getElementById('btnAbrirJson').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state = await importStateFromJSONFile(file);
      currentIndex = 0;
      renderAll();
      saveStateToStorage(state);
    } catch (err) {
      alert('El archivo no es un proyecto TIF válido (JSON).');
    }
    fileInput.value = '';
  });

  // ---------------- Vista previa ----------------
  const previewOverlay = document.getElementById('previewOverlay');
  const previewRoot = document.getElementById('previewRoot');

  function openPreview() {
    const blocks = window.TIF_DOCUMENT_MODEL.buildDocumentModel(state);
    previewRoot.innerHTML = `<div class="apa-page">${window.TIF_PREVIEW.renderPreviewHTML(blocks)}</div>`;
    previewOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closePreview() {
    previewOverlay.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('btnVistaPrevia').addEventListener('click', openPreview);
  document.getElementById('btnCerrarPreview').addEventListener('click', closePreview);

  // ---------------- Fichas de lectura ----------------
  const fichasOverlay = document.getElementById('fichasOverlay');
  const fichasRoot = document.getElementById('fichasRoot');
  function openFichas() {
    window.TIF_FICHAS.renderFichasPanel(fichasRoot, state, scheduleAutosave);
    fichasOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  document.getElementById('btnFichas').addEventListener('click', openFichas);
  document.getElementById('btnCerrarFichas').addEventListener('click', () => {
    fichasOverlay.hidden = true;
    document.body.style.overflow = '';
  });
  document.getElementById('btnImprimirPdf').addEventListener('click', () => window.print());
  document.getElementById('btnPreviewExportDocx').addEventListener('click', () => handleExportDocx());

  // ---------------- Chequeo de completitud + exportación DOCX ----------------
  const modal = document.getElementById('readinessModal');
  const missingList = document.getElementById('missingList');

  function fileNameBase() {
    const t = (state.portada.titulo || 'TIF').replace(/[^\w\sÀ-ÿ-]/g, '').trim().replace(/\s+/g, '_');
    return t.slice(0, 60) || 'TIF';
  }

  async function doExportDocx() {
    const blocks = window.TIF_DOCUMENT_MODEL.buildDocumentModel(state);
    const btn = document.getElementById('btnExportarDocx');
    const btn2 = document.getElementById('btnPreviewExportDocx');
    [btn, btn2].forEach((b) => { if (b) { b.disabled = true; b.dataset.orig = b.textContent; b.textContent = 'Generando…'; } });
    try {
      await window.TIF_EXPORT_DOCX.exportToDocx(blocks, fileNameBase());
    } catch (err) {
      console.error(err);
      alert('Ocurrió un error al generar el DOCX. Revisá la consola para más detalles.');
    } finally {
      [btn, btn2].forEach((b) => { if (b) { b.disabled = false; b.textContent = b.dataset.orig; } });
    }
  }

  function handleExportDocx() {
    const missing = getMissingSummary(state);
    if (missing.length === 0) {
      doExportDocx();
      return;
    }
    missingList.innerHTML = missing.map((m) => `<li><b>${m.sectionTitle}</b> — ${m.fieldLabel}: ${m.message}</li>`).join('');
    modal.hidden = false;
  }

  document.getElementById('btnExportarDocx').addEventListener('click', handleExportDocx);
  document.getElementById('btnModalCancelar').addEventListener('click', () => { modal.hidden = true; });
  document.getElementById('btnModalIrAFaltantes').addEventListener('click', () => {
    modal.hidden = true;
    const missing = getMissingSummary(state);
    if (missing.length) {
      const idx = SECTIONS.findIndex((s) => s.id === missing[0].sectionId);
      if (idx >= 0) { currentIndex = idx; renderAll(); }
    }
  });
  document.getElementById('btnModalExportarIgual').addEventListener('click', () => {
    modal.hidden = true;
    doExportDocx();
  });

  // ---------------- Respaldo automático en archivo local ----------------
  const btnFileBackup = document.getElementById('btnFileBackup');
  const fileBackupModal = document.getElementById('fileBackupModal');
  const fileBackupStatus = document.getElementById('fileBackupStatus');
  const btnFbElegir = document.getElementById('btnFbElegir');
  const btnFbReactivar = document.getElementById('btnFbReactivar');
  const btnFbDesactivar = document.getElementById('btnFbDesactivar');

  function updateFileBackupUI(mode) {
    // mode: 'unset' | 'active' | 'paused' | 'error'
    btnFbReactivar.hidden = mode !== 'paused';
    btnFbDesactivar.hidden = mode === 'unset';
    if (mode === 'active') {
      btnFileBackup.textContent = `📁 Respaldo activo: ${backupHandle.name}`;
      fileBackupStatus.innerHTML = `✅ Escribiendo automáticamente en <b>${backupHandle.name}</b> en cada autoguardado.`;
    } else if (mode === 'paused') {
      btnFileBackup.textContent = `⚠️ Respaldo pausado: ${backupHandle.name}`;
      fileBackupStatus.innerHTML = `⚠️ El navegador revocó el permiso de escritura sobre <b>${backupHandle.name}</b>. Hacé clic en "Reactivar permiso" para retomar el respaldo automático.`;
    } else if (mode === 'error') {
      btnFileBackup.textContent = `⚠️ Respaldo con error: ${backupHandle.name}`;
      fileBackupStatus.innerHTML = `⚠️ No se pudo escribir en <b>${backupHandle.name}</b> (¿se movió, se renombró o se borró el archivo?). Elegí el archivo de nuevo si hace falta.`;
    } else {
      btnFileBackup.textContent = '📁 Activar respaldo en archivo';
      fileBackupStatus.textContent = 'Todavía no configuraste un archivo de respaldo.';
    }
  }

  async function initFileBackup() {
    if (!window.TIF_FILEBACKUP.isSupported()) return; // deja el botón oculto (Firefox/Safari)
    btnFileBackup.hidden = false;
    updateFileBackupUI('unset');
    const stored = await window.TIF_FILEBACKUP.getStoredHandle();
    if (!stored) return;
    const perm = await window.TIF_FILEBACKUP.queryPermission(stored);
    backupHandle = stored;
    updateFileBackupUI(perm === 'granted' ? 'active' : 'paused');
  }

  btnFileBackup.addEventListener('click', () => { fileBackupModal.hidden = false; });
  document.getElementById('btnFbCerrar').addEventListener('click', () => { fileBackupModal.hidden = true; });

  btnFbElegir.addEventListener('click', async () => {
    try {
      const suggested = `${fileNameBase()}_autoguardado.json`;
      const handle = await window.TIF_FILEBACKUP.pickBackupFile(suggested);
      backupHandle = handle;
      await window.TIF_FILEBACKUP.writeBackup(backupHandle, state);
      updateFileBackupUI('active');
    } catch (err) {
      if (err && err.name === 'AbortError') return; // el usuario canceló el selector
      console.error(err);
      alert('No se pudo configurar el archivo de respaldo.');
    }
  });

  btnFbReactivar.addEventListener('click', async () => {
    if (!backupHandle) return;
    const perm = await window.TIF_FILEBACKUP.requestPermission(backupHandle);
    if (perm === 'granted') {
      await window.TIF_FILEBACKUP.writeBackup(backupHandle, state);
      updateFileBackupUI('active');
    } else {
      alert('No se otorgó el permiso de escritura, el respaldo sigue pausado.');
    }
  });

  btnFbDesactivar.addEventListener('click', async () => {
    if (!confirm('¿Desactivar el respaldo automático en archivo? El archivo elegido no se borra, solo dejamos de escribirle.')) return;
    await window.TIF_FILEBACKUP.clearStoredHandle();
    backupHandle = null;
    updateFileBackupUI('unset');
  });

  // ---------------- Init ----------------
  renderAll();
  initFileBackup();
})();
