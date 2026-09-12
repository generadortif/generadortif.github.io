/* ============================================================================
   fichas.js
   Herramienta auxiliar de "fichas de lectura". No forma parte de los
   capítulos del TIF ni se incluye en la exportación DOCX/PDF: es un banco
   de notas del autor (citas textuales, paráfrasis, resúmenes) que después
   se coteja, de forma heurística y orientativa, contra las citas en
   formato APA que aparecen en el texto del TIF y contra la lista de
   Referencias bibliográficas.

   Objetivo (a pedido del usuario): no hace falta validar el 100% de las
   citas de manera perfecta -- alcanza con avisar, para cada cita
   detectada, si tiene (o no) una ficha de lectura y una referencia que la
   respalden. El autor decide cuántas fichas cargar.
   ========================================================================== */

function uid() {
  return 'f_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Normalización de texto (para comparar apellidos sin depender de acentos,
// mayúsculas o pequeñas variaciones de tipeo).
// ---------------------------------------------------------------------------
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normWord(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z]/g, '');
}

// Palabras de enlace/discurso que, al aparecer justo antes de una cita
// narrativa ("Además, Pressman y Maxim (2019)..."), el regex puede llegar a
// confundir con un apellido más. Se filtran para reducir falsos positivos.
const STOPWORDS_CONECTORES = new Set([
  'ademas', 'asimismo', 'tambien', 'sinembargo', 'segun', 'entonces', 'luego',
  'finalmente', 'mientras', 'aunque', 'cuando', 'porotraparte', 'porultimo',
  'cabedestacar', 'esimportante', 'esnecesario', 'asu', 'endefinitiva',
]);

// Extrae los apellidos "reales" de una cadena de autores, descartando
// iniciales (K., J. P., etc.) y conectores (y, &, et al., en).
function extractSurnames(authorsText) {
  const cleaned = String(authorsText || '').replace(/\bet al\.?\b/gi, '');
  const tokens = cleaned.split(/,|&|\by\b|\bY\b/).map((t) => t.trim()).filter(Boolean);
  const surnames = [];
  tokens.forEach((tok) => {
    const compact = tok.replace(/[.\s]/g, '');
    // se descartan tokens que son solo iniciales (1-2 letras, todas mayúsculas)
    if (compact.length <= 2 && compact === compact.toUpperCase()) return;
    const w = normWord(tok);
    if (w.length >= 3 && !STOPWORDS_CONECTORES.has(w)) surnames.push(w);
  });
  return Array.from(new Set(surnames));
}

function extractYear(text) {
  const m = String(text || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  if (m) return m[1];
  if (/s\.?\s?f\.?/i.test(text || '')) return 's.f.';
  return null;
}

// ---------------------------------------------------------------------------
// Recolecta el texto "narrativo" del TIF (todas las secciones/campos donde
// el autor puede haber escrito una cita), junto con su ubicación, para
// poder informarle en qué capítulo aparece cada cita detectada.
// ---------------------------------------------------------------------------
function collectTextBlocks(state) {
  const blocks = [];
  const push = (sectionShort, fieldLabel, text) => {
    if (text && String(text).trim()) blocks.push({ sectionShort, fieldLabel, text: String(text) });
  };
  window.TIF_SCHEMA.SECTIONS.forEach((section) => {
    const data = state[section.id] || {};
    section.fields.forEach((field) => {
      const value = data[field.key];
      switch (field.type) {
        case 'text':
        case 'textarea':
          push(section.short, field.label, value);
          break;
        case 'list':
          (value || []).forEach((item) => push(section.short, field.label, item));
          break;
        case 'group':
          field.fields.forEach((sf) => push(section.short, `${field.label} — ${sf.label}`, (value || {})[sf.key]));
          break;
        case 'table':
          (value || []).forEach((row, idx) => {
            field.columns.forEach((col) => {
              if (col.type === 'textarea' || !col.type) push(section.short, `${field.label} (fila ${idx + 1})`, row[col.key]);
            });
          });
          break;
        // 'select', 'checkboxes', 'foda' y 'refs' no suelen contener citas
        // narrativas propias del autor: se omiten para reducir falsos positivos.
        default:
          break;
      }
    });
  });
  return blocks;
}

// Dos formatos habituales de cita en APA:
//   (Laudon & Laudon, 2016)   ->  cita entre paréntesis
//   Laudon y Laudon (2016)    ->  cita narrativa
const RE_PARENTESIS = /\(([A-ZÁÉÍÓÚÑ][^()]{2,80}?,\s*(?:\d{4}|s\.?\s?f\.?))\)/g;
const RE_NARRATIVA = /([A-ZÁÉÍÓÚÑ][\wÀ-ÿ.'-]+(?:\s*(?:,|&|\by\b)\s*[A-ZÁÉÍÓÚÑ][\wÀ-ÿ.'-]+)*)\s*\((\d{4}|s\.?\s?f\.?)\)/g;

function scanCitationsInText(text) {
  const found = [];
  let m;
  RE_PARENTESIS.lastIndex = 0;
  while ((m = RE_PARENTESIS.exec(text))) {
    const inner = m[1];
    const year = extractYear(inner);
    const authorsPart = inner.replace(/,\s*(\d{4}|s\.?\s?f\.?)\s*$/, '');
    found.push({ raw: m[0], authorsPart, year });
  }
  RE_NARRATIVA.lastIndex = 0;
  while ((m = RE_NARRATIVA.exec(text))) {
    found.push({ raw: m[0], authorsPart: m[1], year: extractYear(m[2]) || m[2] });
  }
  return found;
}

function citationKey(surnames, year) {
  return `${Array.from(surnames).sort().join('+')}__${year || '????'}`;
}

// ---------------------------------------------------------------------------
// Escanea todo el TIF y agrupa las citas detectadas por autor+año.
// ---------------------------------------------------------------------------
function scanAllCitations(state) {
  const blocks = collectTextBlocks(state);
  const grouped = new Map();
  blocks.forEach((block) => {
    scanCitationsInText(block.text).forEach((c) => {
      const surnames = extractSurnames(c.authorsPart);
      if (surnames.length === 0 || !c.year) return; // descartamos matches ambiguos
      const key = citationKey(surnames, c.year);
      if (!grouped.has(key)) {
        const display = `${surnames.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' y ')}, ${c.year}`;
        grouped.set(key, { key, surnames, year: c.year, display, occurrences: [] });
      }
      const entry = grouped.get(key);
      const already = entry.occurrences.find((o) => o.sectionShort === block.sectionShort && o.fieldLabel === block.fieldLabel);
      if (already) already.count += 1;
      else entry.occurrences.push({ sectionShort: block.sectionShort, fieldLabel: block.fieldLabel, count: 1 });
    });
  });
  return Array.from(grouped.values()).sort((a, b) => a.display.localeCompare(b.display, 'es'));
}

function referenceKey(ref) {
  const surnames = extractSurnames(ref.autores);
  const year = extractYear(ref.anio) || (ref.anio || '').trim() || null;
  return { surnames, year };
}

function fichaKey(ficha, referencias) {
  if (ficha.refIndex !== null && ficha.refIndex !== undefined && referencias[ficha.refIndex]) {
    return referenceKey(referencias[ficha.refIndex]);
  }
  const surnames = extractSurnames(ficha.autorAnio);
  const year = extractYear(ficha.autorAnio);
  return { surnames, year };
}

function keysOverlap(a, b) {
  if (!a.year || !b.year || a.year !== b.year) return false;
  return a.surnames.some((s) => b.surnames.includes(s));
}

// ---------------------------------------------------------------------------
// Cruza las citas detectadas con la bibliografía y las fichas de lectura.
// ---------------------------------------------------------------------------
function buildTrazabilidad(state) {
  const citations = scanAllCitations(state);
  const referencias = state.referencias.referencias || [];
  const fichas = state.fichasLectura || [];

  const refKeys = referencias.map(referenceKey);
  const fichaKeys = fichas.map((f) => fichaKey(f, referencias));

  const rows = citations.map((cit) => {
    const citKeyObj = { surnames: cit.surnames, year: cit.year };
    const hasRef = refKeys.some((rk) => keysOverlap(citKeyObj, rk));
    const hasFicha = fichaKeys.some((fk) => keysOverlap(citKeyObj, fk));
    let status;
    if (hasRef && hasFicha) status = 'ok';
    else if (hasRef && !hasFicha) status = 'sin-ficha';
    else status = 'sin-referencia';
    return { ...cit, hasRef, hasFicha, status };
  });

  const fichasNoCitadas = fichas.filter((f, idx) => {
    const fk = fichaKeys[idx];
    if (!fk.year || fk.surnames.length === 0) return false; // no se pudo interpretar, no se informa
    return !citations.some((c) => keysOverlap(fk, { surnames: c.surnames, year: c.year }));
  });

  return { rows, fichasNoCitadas, totalCitas: rows.length, totalFichas: fichas.length };
}

// ---------------------------------------------------------------------------
// UI: administrador de fichas de lectura + panel de trazabilidad.
// ---------------------------------------------------------------------------
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
  }
  (children || []).forEach((c) => { if (c) node.appendChild(c); });
  return node;
}

const TIPOS_FICHA = ['Cita textual', 'Paráfrasis', 'Resumen', 'Comentario'];

function renderFichaForm(container, state, onChange, rerender) {
  const referencias = state.referencias.referencias || [];
  const tipoSelect = el('select', {});
  TIPOS_FICHA.forEach((t) => tipoSelect.appendChild(el('option', { value: t, text: t })));

  const refSelect = el('select', {});
  refSelect.appendChild(el('option', { value: '-1', text: '— Escribir autor/año manualmente —' }));
  referencias.forEach((r, idx) => {
    refSelect.appendChild(el('option', { value: String(idx), text: `${r.autores} (${r.anio}) — ${r.titulo}`.slice(0, 90) }));
  });

  const autorAnioInput = el('input', { type: 'text', placeholder: 'Ej: Laudon y Laudon, 2016' });
  refSelect.addEventListener('change', () => {
    const idx = parseInt(refSelect.value, 10);
    if (idx >= 0 && referencias[idx]) {
      autorAnioInput.value = `${referencias[idx].autores}, ${referencias[idx].anio}`;
      autorAnioInput.disabled = true;
    } else {
      autorAnioInput.disabled = false;
    }
  });

  const paginasInput = el('input', { type: 'text', placeholder: 'Ej: p. 45 o pp. 45-47' });
  const temaInput = el('input', { type: 'text', placeholder: 'Tema / palabra clave' });
  const contenidoInput = el('textarea', { rows: '3', placeholder: 'Cita textual, paráfrasis o resumen de la fuente' });
  const comentarioInput = el('textarea', { rows: '2', placeholder: '(Opcional) Análisis o comentario propio' });

  const grid = el('div', { class: 'ficha-form-grid' }, [
    el('div', { class: 'group-field' }, [el('label', { text: 'Tipo de ficha' }), tipoSelect]),
    el('div', { class: 'group-field' }, [el('label', { text: 'Referencia vinculada' }), refSelect]),
    el('div', { class: 'group-field' }, [el('label', { text: 'Autor y año (como aparece en el texto)' }), autorAnioInput]),
    el('div', { class: 'group-field' }, [el('label', { text: 'Página(s)' }), paginasInput]),
    el('div', { class: 'group-field' }, [el('label', { text: 'Tema / palabra clave' }), temaInput]),
  ]);

  const addBtn = el('button', { type: 'button', class: 'btn-primary btn-small', text: '+ Agregar ficha de lectura' });
  addBtn.addEventListener('click', () => {
    if (!autorAnioInput.value.trim() || !contenidoInput.value.trim()) {
      alert('Completá al menos el autor/año y el contenido de la ficha.');
      return;
    }
    const refIdx = parseInt(refSelect.value, 10);
    state.fichasLectura.push({
      id: uid(),
      tipo: tipoSelect.value,
      refIndex: refIdx >= 0 ? refIdx : null,
      autorAnio: autorAnioInput.value.trim(),
      paginas: paginasInput.value.trim(),
      tema: temaInput.value.trim(),
      contenido: contenidoInput.value.trim(),
      comentario: comentarioInput.value.trim(),
    });
    onChange();
    rerender();
  });

  container.appendChild(el('h4', { text: 'Agregar nueva ficha' }));
  container.appendChild(grid);
  container.appendChild(el('div', { class: 'group-field' }, [el('label', { text: 'Contenido (cita/paráfrasis/resumen)' }), contenidoInput]));
  container.appendChild(el('div', { class: 'group-field' }, [el('label', { text: 'Comentario propio (opcional)' }), comentarioInput]));
  container.appendChild(addBtn);
}

function renderFichasList(container, state, onChange, rerender) {
  const fichas = state.fichasLectura || [];
  container.appendChild(el('h4', { text: `Fichas cargadas (${fichas.length})` }));
  if (fichas.length === 0) {
    container.appendChild(el('p', { class: 'field-help', text: 'Todavía no cargaste ninguna ficha de lectura.' }));
    return;
  }
  const list = el('div', { class: 'fichas-grid' });
  fichas.forEach((f) => {
    const removeBtn = el('button', { type: 'button', class: 'btn-icon', title: 'Eliminar ficha', text: '✕' });
    removeBtn.addEventListener('click', () => {
      const idx = state.fichasLectura.indexOf(f);
      if (idx >= 0) state.fichasLectura.splice(idx, 1);
      onChange();
      rerender();
    });
    const card = el('div', { class: 'ficha-card' }, [
      el('div', { class: 'ficha-card-head' }, [
        el('span', { class: 'ficha-tipo-badge', text: f.tipo }),
        el('strong', { text: f.autorAnio }),
        removeBtn,
      ]),
      f.paginas ? el('p', { class: 'ficha-meta', text: `Páginas: ${f.paginas}` }) : null,
      f.tema ? el('p', { class: 'ficha-meta', text: `Tema: ${f.tema}` }) : null,
      el('p', { class: 'ficha-contenido', text: f.contenido }),
      f.comentario ? el('p', { class: 'ficha-comentario', text: `💭 ${f.comentario}` }) : null,
    ]);
    list.appendChild(card);
  });
  container.appendChild(list);
}

const STATUS_META = {
  'ok': { label: 'Con referencia y ficha', cls: 'status-ok', icon: '✓' },
  'sin-ficha': { label: 'Con referencia, sin ficha de lectura', cls: 'status-warn', icon: '⚠' },
  'sin-referencia': { label: 'No está en la lista de Referencias', cls: 'status-error', icon: '✕' },
};

function renderTrazabilidad(container, state) {
  container.innerHTML = '';
  container.appendChild(el('h4', { text: 'Trazabilidad de citas detectadas en el texto' }));
  container.appendChild(el('p', { class: 'field-help', text: 'Detección heurística de citas en formato "(Autor, Año)" o "Autor (Año)". Es una ayuda orientativa: revisá siempre manualmente las citas antes de entregar.' }));

  const { rows, fichasNoCitadas } = buildTrazabilidad(state);

  if (rows.length === 0) {
    container.appendChild(el('p', { class: 'field-help', text: 'Todavía no se detectaron citas en el texto del TIF.' }));
  } else {
    const table = el('table', { class: 'trazabilidad-table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Cita detectada' }),
      el('th', { text: 'Estado' }),
      el('th', { text: 'Aparece en' }),
    ])]));
    const tbody = el('tbody');
    rows.forEach((r) => {
      const meta = STATUS_META[r.status];
      const locations = r.occurrences.map((o) => `${o.sectionShort} (${o.fieldLabel})${o.count > 1 ? ` ×${o.count}` : ''}`).join('; ');
      tbody.appendChild(el('tr', {}, [
        el('td', { text: r.display }),
        el('td', {}, [el('span', { class: `status-badge ${meta.cls}`, text: `${meta.icon} ${meta.label}` })]),
        el('td', { class: 'locations-cell', text: locations }),
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(el('div', { class: 'table-scroll' }, [table]));
  }

  if (fichasNoCitadas.length > 0) {
    container.appendChild(el('h4', { text: 'Fichas de lectura que no aparecen citadas en el texto' }));
    container.appendChild(el('p', { class: 'field-help', text: 'No es necesariamente un error: puede ser material de consulta que todavía no incorporaste al desarrollo.' }));
    const ul = el('ul', { class: 'apa-ul' });
    fichasNoCitadas.forEach((f) => ul.appendChild(el('li', { text: `${f.autorAnio} — ${f.tema || f.contenido.slice(0, 60)}` })));
    container.appendChild(ul);
  }
}

function renderFichasPanel(root, state, onChange) {
  root.innerHTML = '';
  const rerender = () => renderFichasPanel(root, state, onChange);

  const introBox = el('div', { class: 'ficha-box' }, [
    el('p', { class: 'field-help', text: 'Cargá acá las fichas de lectura que consideres necesarias (no hace falta una por cada fuente citada). El sistema las usa para avisarte, de forma orientativa, si las citas que escribiste en el TIF tienen respaldo.' }),
  ]);

  const formBox = el('div', { class: 'ficha-box' });
  renderFichaForm(formBox, state, onChange, rerender);

  const listBox = el('div', { class: 'ficha-box' });
  renderFichasList(listBox, state, onChange, rerender);

  const trazBox = el('div', { class: 'ficha-box' });
  renderTrazabilidad(trazBox, state);
  const refreshBtn = el('button', { type: 'button', class: 'btn-secondary btn-small', text: '🔍 Volver a analizar el texto' });
  refreshBtn.addEventListener('click', () => renderTrazabilidad(trazBox, state));

  root.appendChild(introBox);
  root.appendChild(formBox);
  root.appendChild(listBox);
  root.appendChild(el('hr'));
  root.appendChild(refreshBtn);
  root.appendChild(trazBox);
}

window.TIF_FICHAS = { renderFichasPanel, buildTrazabilidad, scanAllCitations };
