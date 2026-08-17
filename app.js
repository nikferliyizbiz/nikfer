import {
  getSections, getSectionWithContent,
  getFeaturedSections, getRecentComments,
  getSiteSettings, getStatCounts,
  getApprovedComments, submitComment,
  getObitYearCounts, getObitsPaged
} from './db.js';

// ── CACHE ──────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000; // 5 dakika
const cache = {};

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { delete cache[key]; return null; }
  return entry.data;
}

function setCached(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ── XSS KORUMASI ───────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let currentSlug   = null;
let currentDetail = null;

// ── INIT ───────────────────────────────────────────────────
async function init() {
  await loadSectionsGrid();
  loadStats();
  loadFeaturedSections();
  loadRecentComments();
  await loadComments();
  loadMiniSozluk();
  loadGununBilmecesi();
  loadPageGrids();
  loadTarihPreviewCards();
  handleDeepLink();
}

// ── SECTIONS GRID ──────────────────────────────────────────
// ── İSTATİSTİKLER ────────────────────────────────────────────
async function loadStats() {
  try {
    // Paralel çek
    const [settings, counts] = await Promise.all([
      getSiteSettings(),
      getStatCounts(),
    ]);

    // Nüfus — admin'den düzenlenebilir
    const nufusEl = document.getElementById('stat-nufus');
    if (nufusEl) {
      const nufus = settings['nufus']?.value || '—';
      nufusEl.textContent = Number(nufus).toLocaleString('tr-TR');
    }

    // Muhtar sayısı — otomatik
    const muhtarEl = document.getElementById('stat-muhtar');
    if (muhtarEl) muhtarEl.textContent = counts.muhtarCount || '—';

    // Şehit sayısı — otomatik
    const sehitEl = document.getElementById('stat-sehit');
    if (sehitEl) sehitEl.textContent = counts.sehitCount || '—';

  } catch(e) {
    // Hata durumunda sabit değerleri göster
    const fallbacks = {
      'stat-nufus':  '5.250',
      'stat-muhtar': '15',
      'stat-sehit':  '12',
    };
    Object.entries(fallbacks).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
  }
}

// ── ÖĞNE ÇIKAN BÖLÜMLER ──────────────────────────────────────
async function loadFeaturedSections() {
  const wrap = document.getElementById('featured-wrap');
  if (!wrap) return;
  try {
    const sections = await getFeaturedSections();
    if (!sections.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <div class="sec-title" style="margin-top:16px">
        <i class="ti ti-star" style="color:var(--accent);margin-right:5px;font-size:13px"></i>
        Öne Çıkan Bölümler
      </div>
      <div class="menu-grid" style="margin-bottom:0">
        ${sections.map(s => `
          <div class="menu-item" onclick="openSection('${s.slug}')">
            <i class="ti ti-${s.icon || 'book'}"></i>
            <span>${s.title}</span>
          </div>`).join('')}
      </div>`;
  } catch(e) {
    wrap.innerHTML = '';
  }
}

// ── SON YORUMLAR ──────────────────────────────────────────────
async function loadRecentComments() {
  const wrap = document.getElementById('recent-comments-wrap');
  if (!wrap) return;
  try {
    const comments = await getRecentComments(3);
    if (!comments.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <div class="sec-title" style="margin-top:16px">
        <i class="ti ti-message-circle" style="color:var(--primary);margin-right:5px;font-size:13px"></i>
        Son Paylaşımlar
      </div>
      <div class="card">
        <div class="card-body" style="padding:0 14px">
          ${comments.map(c => {
            const date    = new Date(c.created_at).toLocaleDateString('tr-TR');
            const section = c.sections;
            return `<div class="list-item" style="cursor:default">
              <div class="list-icon">
                <i class="ti ti-${section?.icon || 'message-circle'}"></i>
              </div>
              <div style="flex:1;min-width:0">
                <div class="list-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${c.author_name}
                  ${section ? `<span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:5px">${section.title}</span>` : ''}
                </div>
                <div class="list-sub" style="overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal">
                  ${c.content}
                </div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${date}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch(e) {
    wrap.innerHTML = '';
  }
}

async function loadSectionsGrid() {
  try {
    const sections = await getSections();
    cache.sections = sections;
    const grid = document.getElementById('sections-grid');
    grid.innerHTML = sections.map(s => `
      <div class="menu-item" onclick="openSection('${s.slug}')">
        <i class="ti ti-${s.icon || 'book'}"></i>
        <span>${s.title}</span>
      </div>`).join('');
  } catch (e) {
    document.getElementById('sections-grid').innerHTML =
      `<div class="error-msg" style="grid-column:1/-1">Bölümler yüklenemedi: ${e.message}</div>`;
  }
}

// ── OPEN SECTION ───────────────────────────────────────────
window.openSection = async function(slug) {
  currentSlug = slug;
  const overlay = document.getElementById('detail-overlay');
  const body    = document.getElementById('detail-body');
  const title   = document.getElementById('detail-title');

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const cached = getCached(slug);
    const data = cached || await getSectionWithContent(slug);
    if (!cached) setCached(slug, data);

    title.textContent = data.section.title;
    if (data.section.subtitle) {
      title.innerHTML = `${data.section.title}<br><small style="font-weight:400;font-size:11px;opacity:.8">${data.section.subtitle}</small>`;
    }

    body.innerHTML = renderSection(data);
    initBilmeceBtns();
    // Deep link
    history.pushState({ slug }, '', `#${slug}`);
  } catch (e) {
    body.innerHTML = `<div class="error-msg">İçerik yüklenemedi: ${e.message}</div>`;
  }
};

window.closeDetail = function() {
  document.getElementById('detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
  history.pushState({}, '', window.location.pathname);
  currentSlug = null;
};

window.closeDetailGoHome = function() {
  closeDetail();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-home').classList.add('active');
  document.querySelector('.bottom-nav .nav-item:first-child').classList.add('active');
};

window.closeDetailGoPage = function(pageId) {
  closeDetail();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  const navMap = {home:0, kultur:1, tarih:2, topluluk:3, obits:4};
  const idx = navMap[pageId] ?? 0;
  document.querySelectorAll('.bottom-nav .nav-item')[idx]?.classList.add('active');
};

// ── RENDER SECTION ─────────────────────────────────────────
function renderSection(data) {
  const { section, blocks, audio, links, gallery } = data;
  let html = '';

  // Tablo başlıkları (slug'a göre)
  const tableHeaders = {
    muhtarlar: ['#','Ad / Lakap','Dönem','Doğum','Ölüm'],
    canakkale: null, // Özel kart render kullanılacak
  };

  // Blokları türe göre gruplama
  let tableRows = [];
  let infoRows  = [];

  for (const b of blocks) {
    // Tablo satırlarını topla, sonra tek tablo yap
    if (b.type === 'table_row') {
      tableRows.push(b);
      continue;
    }
    // info_row'ları topla
    if (b.type === 'info_row') {
      infoRows.push(b);
      continue;
    }
    // Önceki tablo varsa kapat
    if (tableRows.length) {
      html += renderTable(tableRows, tableHeaders[section.slug]);
      tableRows = [];
    }
    if (infoRows.length) {
      html += renderInfoRows(infoRows);
      infoRows = [];
    }
    html += renderBlock(b);
  }
  // Kapanmamış tablo/info
  if (tableRows.length) html += renderTable(tableRows, tableHeaders[section.slug]);
  if (infoRows.length)  html += renderInfoRows(infoRows);

  // Audio
  if (audio.length) {
    html += `<div class="blk-heading"><i class="ti ti-volume" style="margin-right:6px;font-size:14px"></i>Sesli Anlatım</div>`;
    html += `<div class="audio-section">`;
    audio.forEach(a => {
      html += `<div class="audio-item">
        <div class="audio-title"><i class="ti ti-music" style="margin-right:5px;color:var(--primary)"></i>${a.title}</div>
        <audio controls preload="none">
          <source src="${a.file_url}" type="audio/mpeg">
          Tarayıcınız ses oynatmayı desteklemiyor.
        </audio>
      </div>`;
    });
    html += `</div>`;
  }

  // Gallery
  if (gallery.length) {
    // Tüm galeriyi global değişkende sakla — lightbox için
    window._currentGallery = gallery.map(g => ({ url: g.file_url, caption: g.caption || '' }));

    html += `<div class="blk-heading"><i class="ti ti-photo" style="margin-right:6px;font-size:14px"></i>Fotoğraflar <span style="font-size:11px;font-weight:400;opacity:.7">(${gallery.length} fotoğraf)</span></div>`;
    html += `<div class="gallery-grid">`;
    const MAX_THUMB = 8;
    gallery.slice(0, MAX_THUMB).forEach((g, idx) => {
      const isLast    = idx === MAX_THUMB - 1 && gallery.length > MAX_THUMB;
      const remaining = gallery.length - MAX_THUMB;
      html += `<div style="text-align:center">
        <div class="gallery-thumb" data-url="${g.file_url}" data-caption="${(g.caption||'').replace(/"/g,'&quot;')}"
          onclick="openLightbox('${g.file_url}','${(g.caption||'').replace(/'/g,"\\'")}')">
          <img class="gallery-img" src="${g.file_url}" alt="${g.title||''}" loading="lazy">
          ${isLast ? `<div class="gallery-thumb-count">+${remaining}</div>` : ''}
        </div>
        ${g.caption ? `<div class="gallery-caption" title="${g.caption}">${g.caption}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
    if (gallery.length > MAX_THUMB) {
      html += `<button onclick="openAllGallery()"
        style="background:none;border:1px solid var(--border);color:var(--primary);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;margin-top:4px;width:100%">
        <i class="ti ti-photo" style="margin-right:4px"></i>Tümünü Gör (${gallery.length} fotoğraf)
      </button>`;
    }
  }

  // Links
  if (links.length) {
    html += `<div class="blk-heading"><i class="ti ti-link" style="margin-right:6px;font-size:14px"></i>Kaynaklar & Linkler</div>`;
    const iconMap = { newspaper:'news', external:'external-link', document:'file', video:'player-play' };
    links.forEach(l => {
      html += `<a class="link-item" href="${l.url}" target="_blank" rel="noopener">
        <div class="link-icon"><i class="ti ti-${iconMap[l.link_type]||'external-link'}"></i></div>
        <div>
          <div class="link-title">${l.title}</div>
          ${l.description ? `<div class="link-desc">${l.description}</div>` : ''}
        </div>
        <i class="ti ti-arrow-up-right" style="margin-left:auto;color:var(--text-muted);font-size:14px"></i>
      </a>`;
    });
  }

  // Topluluk yorumları — comments_enabled kontrolü
  if (section.comments_enabled !== false) {
    html += `<div class="blk-heading" style="margin-top:24px">
      <i class="ti ti-message-circle" style="margin-right:6px;font-size:14px"></i>Bu bölüme yorumlar
    </div>`;
    // Yorum formu
    html += `<div style="margin-bottom:12px">
      <input class="form-input" id="sc-name-${section.id}" placeholder="Adınız *"
        style="width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg);outline:none;margin-bottom:8px">
      <textarea class="form-input" id="sc-text-${section.id}" rows="3"
        placeholder="Bu bölüm hakkında bir anınızı veya düşüncenizi paylaşın..."
        style="width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg);outline:none;resize:none;min-height:72px;margin-bottom:8px"></textarea>
      <button onclick="submitSectionComment('${section.id}')"
        style="background:var(--primary);color:#FFF;border:none;border-radius:9px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;width:100%">
        <i class="ti ti-send" style="margin-right:5px"></i>Yorum Yap
      </button>
    </div>`;
    html += `<div id="section-comments-${section.id}"><div class="loading"><div class="spinner"></div></div></div>`;
    // Async yorum yükle
    setTimeout(() => loadSectionComments(section.id), 100);
  } else {
    html += `<div style="background:rgba(139,69,19,.05);border-radius:10px;padding:12px 14px;margin-top:20px;display:flex;align-items:center;gap:8px">
      <i class="ti ti-message-off" style="color:var(--text-muted);font-size:18px"></i>
      <span style="font-size:12px;color:var(--text-muted)">Bu bölüm için yorum kapalıdır.</span>
    </div>`;
  }

  return html;
}

function renderBlock(b) {
  const m = b.meta || {};
  switch (b.type) {
    case 'paragraph': {
      // Eski Quill'den gelen <p>...</p> sarmalayıcıları temizle
      let txt = b.content || '';
      txt = txt.replace(/^<p>([\s\S]*)<\/p>$/i, '$1').trim();
      // Çoklu paragraf varsa her birini ayrı render et
      if (txt.includes('</p><p>')) {
        return txt.split('</p><p>')
          .filter(p => p.trim())
          .map(p => `<p class="blk-paragraph">${p}</p>`)
          .join('');
      }
      return `<p class="blk-paragraph">${txt}</p>`;
    }
    case 'heading':
      return `<div class="blk-heading">${b.content}</div>`;
        case 'quote':
      return `<div class="blk-quote">${b.content}${m.author ? `<div class="blk-quote-author">— ${m.author}${m.year ? `, ${m.year}` : ''}</div>` : ''}</div>`;
    case 'poem':
      return `<div class="blk-poem">${b.content}${m.author ? `<div class="blk-poem-author">— ${m.author}${m.year ? `, ${m.year}` : ''}</div>` : ''}</div>`;
    case 'note':
      return `<div class="blk-note">${b.content}${m.author ? `<div class="blk-note-author">— ${m.author}</div>` : ''}
	  </div>`;
    case 'list_item':
      if (m.answer !== undefined) {
        // Bilmece — bullet + column layout
        const bid = `b-${b.id}`;
        return `<div class="blk-list-item bilmece" data-bid="${bid}">
          <span class="blk-list-bullet">•</span>
          <div style="flex:1">
            <div class="bilmece-q">${b.content}</div>
            <div class="bilmece-a" id="${bid}">Cevap: ${m.answer}</div>
            <button class="bilmece-btn" onclick="toggleBilmece('${bid}',this)">Cevabı gör</button>
          </div>
        </div>`;
      }
      if (m.desc) {
        // İsim listesi — bullet + column layout
        return `<div class="blk-list-item with-desc">
          <span class="blk-list-bullet">•</span>
          <div style="flex:1">
            <div style="font-weight:600">${b.content}</div>
            <div style="font-size:11px;color:var(--text-muted)">${m.desc}</div>
          </div>
        </div>`;
      }
      // Normal madde
      return `<div class="blk-list-item"><span class="blk-list-bullet">•</span><span>${b.content}</span></div>`;
    case 'divider':
      return `<hr class="blk-divider">`;
    default:
      return '';
  }
}

function renderTable(rows, headers) {
  // headers null ise kart formatında render et (Çanakkale gibi geniş tablolar)
  if (headers === null) {
    return renderCardsFromTable(rows);
  }

  const cols = rows[0]?.meta?.cols || [];
  const colCount = cols.length;
  let th = headers
    ? headers.map(h => `<th>${h}</th>`).join('')
    : Array(colCount).fill('').map((_,i) => `<th>${i}</th>`).join('');

  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${th}</tr></thead><tbody>
    ${rows.map(r => `<tr>${(r.meta.cols||[]).map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

// Geniş tablolar için kart formatı — mobilde taşmaz
function renderCardsFromTable(rows) {
  return `<div style="display:flex;flex-direction:column;gap:8px;margin:12px 0">
    ${rows.map(r => {
      const c = r.meta.cols || [];
      // cols: [no, ad, baba, lakap, dogum, tarih, yer, birlik]
      const [no, ad, baba, lakap, dogum, tarih, yer, birlik] = c;
      return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;position:relative">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
          <div>
            <span style="font-size:15px;font-weight:700;color:var(--text)">${ad || '—'}</span>
            <span style="font-size:12px;color:var(--text-muted);margin-left:5px">${baba ? baba + ' oğlu' : ''}</span>
          </div>
          <span style="background:rgba(139,20,20,.08);color:#8B1A1A;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;flex-shrink:0;margin-left:8px">${no || ''}</span>
        </div>
        ${lakap && lakap !== '—' ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-style:italic">${lakap}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          ${tarih ? `<div style="font-size:11px"><span style="color:var(--text-muted)">Tarih: </span><span style="font-weight:500;color:#8B1A1A">${tarih}</span></div>` : ''}
          ${dogum ? `<div style="font-size:11px"><span style="color:var(--text-muted)">Doğum: </span><span>${dogum}</span></div>` : ''}
          ${yer && yer !== '—' ? `<div style="font-size:11px;grid-column:1/-1"><span style="color:var(--text-muted)">Yer: </span><span>${yer}</span></div>` : ''}
          ${birlik ? `<div style="font-size:11px;grid-column:1/-1"><span style="color:var(--text-muted)">Birlik: </span><span>${birlik}</span></div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderInfoRows(rows) {
  return `<div>
    ${rows.map(r => `<div class="blk-info-row"><span class="blk-info-key">${r.content}</span><span class="blk-info-val">${r.meta.value||'—'}</span></div>`).join('')}
  </div>`;
}

// ── BİLMECE ───────────────────────────────────────────────
window.toggleBilmece = function(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
  btn.textContent = el.classList.contains('open') ? 'Gizle' : 'Cevabı gör';
};
function initBilmeceBtns() {} // hooks handled via onclick in HTML

// ── SAYFA GRİDLERİ (Kültür / Tarih) ─────────────────────────
async function loadPageGrids() {
  try {
    const sections = cache.sections || [];
    ['kultur', 'tarih'].forEach(page => {
      const grid = document.getElementById(`${page}-grid`);
      if (!grid) return;
      const items = sections.filter(s => s.page === page);
      if (!items.length) { grid.innerHTML = ''; return; }
      grid.innerHTML = items.map(s => `
        <div class="menu-item" onclick="openSection('${s.slug}')">
          <i class="ti ti-${s.icon || 'book'}"></i>
          <span>${s.title}</span>
        </div>`).join('');
    });
  } catch(e) {
    console.error('loadPageGrids hatası:', e);
  }
}

// ── TARİH ÖNIZLEME KARTLARI ──────────────────────────────────
async function loadTarihPreviewCards() {
  const wrap = document.getElementById('tarih-preview-cards');
  if (!wrap) return;
  try {
    const [kronoloji, canakkale, muhtarlar, koklere] = await Promise.all([
      getSectionWithContent('kronoloji'),
      getSectionWithContent('canakkale'),
      getSectionWithContent('muhtarlar'),
      getSectionWithContent('koklere'),
    ]);

    // Kronoloji — ilk 6 list_item
    const kronoHTML = kronoloji.blocks
      .filter(b => b.type === 'list_item')
      .slice(0, 9)
      .map(b => {
        // Önce meta.year'a bak, yoksa içerikten parse et
        let year = b.meta?.year || '';
        let text = b.content;
        if (!year) {
          const match = text.match(/^(\d{3,4}(?:\s*[–—-]\s*\d{2,4})?)\s*[–—-]\s*/);
          if (match) {
            year = match[1];
            text = text.slice(match[0].length).trim();
          }
        } else {
          text = text.replace(/^\d[\d\s\.–—-]*—?\s*/, '').trim();
        }
        return `<div class="tc-tl-item">
          <span class="tc-tl-year">${year}</span>
          <span class="tc-tl-text">${text}</span>
        </div>`;
      }).join('');

    // Çanakkale — ilk 6 table_row
    const sehitHTML = canakkale.blocks
      .filter(b => b.type === 'table_row')
      .slice(0, 9)
      .map(b => {
        const cols = b.meta?.cols || [];
        return `<div class="tc-sehit-item">
          <span class="tc-sehit-name">${cols[1] || '—'}</span>
          <span class="tc-sehit-date">${cols[5] || ''}</span>
        </div>`;
      }).join('');

    // Muhtarlar — ilk 6 table_row
    const muhtarHTML = muhtarlar.blocks
      .filter(b => b.type === 'table_row')
      .slice(0, 9)
      .map(b => {
        const cols = b.meta?.cols || [];
        return `<div class="tc-muhtar-item">
          <span class="tc-muhtar-name">${cols[1] || '—'}</span>
          <span class="tc-muhtar-donem">${cols[2] || ''}</span>
        </div>`;
      }).join('');

    // Köklerimiz — ilk 6 list_item
    const koklereHTML = koklere.blocks
      .filter(b => b.type === 'list_item')
      .slice(0, 9)
      .map(b => {
        let year = b.meta?.year || '';
        let text = b.content;
        if (!year) {
          // · veya — veya - ayraçlarını destekle, M.Ö. gibi önekleri de yakala
          const match = text.match(/^([A-ZÖa-zö\.\s~]*\d[\d\s\.]*)\s*[·–—-]\s*/);
          if (match) { year = match[1].trim(); text = text.slice(match[0].length).trim(); }
        } else {
          // meta.year varsa içerikten yıl + ayraç kısmını temizle
          const match = text.match(/^([A-ZÖa-zö\.\s~]*\d[\d\s\.]*)\s*[·–—-]\s*/);
          if (match) { text = text.slice(match[0].length).trim(); }
          else { text = text.replace(year, '').replace(/^\s*[·–—-]\s*/, '').trim(); }
        }
        return `<div class="tc-tl-item">
          <span class="tc-tl-year">${year}</span>
          <span class="tc-tl-text">${text}</span>
        </div>`;
      }).join('');

    wrap.innerHTML = `
      <!-- Köklerimiz Kartı -->
      <div class="tarih-card">
        <div class="tarih-card-header">
          <i class="ti ti-crown"></i><h3>Köklerimize Yolculuk</h3>
        </div>
        <div class="tarih-card-body">${koklereHTML}</div>
        <div class="tarih-card-footer">
          <button onclick="openSection('koklere')">Tüm Tarih →</button>
        </div>
      </div>
      <!-- Kronoloji Kartı -->
      <div class="tarih-card">
        <div class="tarih-card-header">
          <i class="ti ti-timeline"></i><h3>Kronoloji</h3>
        </div>
        <div class="tarih-card-body">${kronoHTML}</div>
        <div class="tarih-card-footer">
          <button onclick="openSection('kronoloji')">Tam Kronoloji →</button>
        </div>
      </div>
      <!-- Çanakkale Kartı -->
      <div class="tarih-card">
        <div class="tarih-card-header">
          <i class="ti ti-flag"></i><h3>Çanakkale Şehitlerimiz</h3>
        </div>
        <div class="tarih-card-body">${sehitHTML}</div>
        <div class="tarih-card-footer">
          <button onclick="openSection('canakkale')">Tüm Şehitler →</button>
        </div>
      </div>
      <!-- Muhtarlar Kartı -->
      <div class="tarih-card">
        <div class="tarih-card-header">
          <i class="ti ti-building-community"></i><h3>Muhtarlarımız</h3>
        </div>
        <div class="tarih-card-body">${muhtarHTML}</div>
        <div class="tarih-card-footer">
          <button onclick="openSection('muhtarlar')">Tüm Liste →</button>
        </div>
      </div>`;

  } catch(e) {
    wrap.innerHTML = '';
    console.error('loadTarihPreviewCards hatası:', e);
  }
}

// ── MİNİ SÖZLÜK ───────────────────────────────────────────
let allSozluk = [];

async function loadMiniSozluk() {
  try {
    const data = await getSectionWithContent('sozluk');
    allSozluk = data.blocks.filter(b => b.type === 'info_row');
    renderMiniSozluk(allSozluk.slice(0, 8));
  } catch(e) {}
}

function renderMiniSozluk(items) {
  document.getElementById('mini-sozluk-list').innerHTML =
    items.map(b => `<div class="blk-info-row">
      <span class="blk-info-key" style="font-weight:600;color:var(--primary)">${b.content}</span>
      <span class="blk-info-val">${b.meta.value||''}</span>
    </div>`).join('');
}

window.filterMiniSozluk = function(q) {
  const filtered = q
    ? allSozluk.filter(b =>
        b.content.toLowerCase().includes(q.toLowerCase()) ||
        (b.meta.value||'').toLowerCase().includes(q.toLowerCase())
      )
    : allSozluk.slice(0, 8);
  renderMiniSozluk(filtered.slice(0, 8));
};

// ── GÜNÜN BİLMECESİ ───────────────────────────────────────
async function loadGununBilmecesi() {
  try {
    const data = await getSectionWithContent('bilmeceler');
    const items = data.blocks.filter(b => b.type === 'list_item' && b.meta.answer);
    const b = items[Math.floor(Math.random() * items.length)];
    if (!b) return;
    const bid = `gb-${b.id}`;
    document.getElementById('gunun-bilmecesi-wrap').innerHTML = `
      <div class="card"><div class="card-body">
        <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px">GÜNÜN BİLMECESİ</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:10px;line-height:1.5">${b.content}</div>
        <div class="bilmece-a" id="${bid}">Cevap: ${b.meta.answer}</div>
        <button class="bilmece-btn" onclick="toggleBilmece('${bid}',this)">Cevabı gör</button>
      </div></div>`;
  } catch(e) {}
}

// ── COMMENTS ──────────────────────────────────────────────
async function loadComments() {
  try {
    const comments = await getApprovedComments();
    _allComments = comments;
    renderComments(comments, 'comments-wrap');
    populateCommentSelects(comments);
  } catch(e) {
    document.getElementById('comments-wrap').innerHTML =
      `<div class="error-msg">Yorumlar yüklenemedi.</div>`;
  }
}

function populateCommentSelects(comments) {
  // Bölüm seçim dropdown'larını doldur
  const sections = cache.sections || [];
  if (!sections.length) return;

  const sectionOpts = sections
    .filter(s => s.comments_enabled !== false)
    .map(s => `<option value="${s.id}">${s.title}</option>`)
    .join('');

  // Yorum formu dropdown
  const cSection = document.getElementById('c-section');
  if (cSection) {
    cSection.innerHTML =
      '<option value="">📂 Hangi bölüm hakkında? (isteğe bağlı)</option>' + sectionOpts;
  }

  // Filtre dropdown — sadece yorumu olan bölümleri göster
  const sectionIdsWithComments = [...new Set(comments.map(c => c.section_id).filter(Boolean))];
  const filterOpts = sections
    .filter(s => sectionIdsWithComments.includes(s.id))
    .map(s => {
      const count = comments.filter(c => c.section_id === s.id).length;
      return `<option value="${s.id}">${s.title} (${count})</option>`;
    }).join('');

  const cFilter = document.getElementById('c-filter');
  if (cFilter) {
    cFilter.innerHTML = `<option value="">Tümü (${comments.length})</option>` + filterOpts;
  }
}

async function loadSectionComments(sectionId) {
  const el = document.getElementById(`section-comments-${sectionId}`);
  if (!el) return;
  try {
    const comments = await getApprovedComments(sectionId);
    el.innerHTML = comments.length
      ? comments.map(c => commentHTML(c)).join('')
      : `<div style="font-size:12px;color:var(--text-muted);padding:10px 0">Bu bölüm için henüz yorum yok. İlk yorumu siz yazın!</div>`;
  } catch(e) {
    el.innerHTML = `<div class="error-msg">Yüklenemedi.</div>`;
  }
}

function renderComments(list, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px">Henüz paylaşım yok. İlk yorumu siz yazın!</div>`;
    return;
  }
  el.innerHTML = list.map(c => commentHTML(c)).join('');
}

function commentHTML(c) {
  const date = new Date(c.created_at).toLocaleDateString('tr-TR');
  const section = (cache.sections || []).find(s => s.id === c.section_id);
  const sectionTag = section
    ? `<span style="display:inline-block;background:rgba(139,69,19,.08);color:var(--primary);font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-bottom:6px">
        <i class="ti ti-book" style="font-size:11px;margin-right:3px"></i>${escapeHtml(section.title)}
       </span>`
    : '';
  return `<div class="comment-item">
    <div class="comment-meta">
      <span class="comment-name">${escapeHtml(c.author_name)}${c.is_pinned ? ' <span class="pinned-badge">Öne Çıkan</span>' : ''}</span>
      <span class="comment-date">${date}</span>
    </div>
    ${c.author_note ? `<div class="comment-note">${escapeHtml(c.author_note)}</div>` : ''}
    ${sectionTag}
    <div class="comment-text">${escapeHtml(c.content)}</div>
  </div>`;
}

// Bölüm detayından doğrudan yorum gönder
window.submitSectionComment = async function(sectionId) {
  const nameEl = document.getElementById(`sc-name-${sectionId}`);
  const textEl = document.getElementById(`sc-text-${sectionId}`);
  if (!nameEl || !textEl) return;
  const name = nameEl.value.trim();
  const text = textEl.value.trim();
  if (!name || !text) { showToast('Lütfen adınızı ve yorumunuzu girin.'); return; }
  try {
    await submitComment({ sectionId, authorName: name, authorNote: '', content: text });
    nameEl.value = '';
    textEl.value = '';
    showToast('Yorumunuz alındı. Admin onayından sonra yayınlanacak.');
  } catch(e) {
    showToast('Hata: ' + e.message);
  }
};

window.submitCommentUI = async function() {
  const name      = document.getElementById('c-name').value.trim();
  const note      = document.getElementById('c-note').value.trim();
  const text      = document.getElementById('c-text').value.trim();
  const sectionId = document.getElementById('c-section').value || null;
  if (!name || !text) { showToast('Lütfen adınızı ve yorumunuzu girin.'); return; }

  try {
    await submitComment({ sectionId, authorName: name, authorNote: note, content: text });
    document.getElementById('c-name').value    = '';
    document.getElementById('c-note').value    = '';
    document.getElementById('c-text').value    = '';
    document.getElementById('c-section').value = '';
    showToast('Yorumunuz alındı. Admin onayından sonra yayınlanacak.');
  } catch(e) {
    showToast('Hata: ' + e.message);
  }
};

// Bölüme göre filtrele
let _allComments = [];
window.filterCommentsUI = async function(sectionId) {
  const filtered = sectionId
    ? _allComments.filter(c => c.section_id === sectionId)
    : _allComments;
  renderComments(filtered, 'comments-wrap');
};

// ── KAYBETTİKLERİMİZ ─────────────────────────────────────────
const OBITS_PAGE_SIZE = 25;
let _obitsState = { page: 0, year: null, search: '', total: 0, items: [], loading: false };

async function loadObits() {
  await loadObitYearSelect();
  await fetchObits(true);
}

async function loadObitYearSelect() {
  const select = document.getElementById('obits-year-select');
  try {
    const counts = await getObitYearCounts();
    const years  = Object.keys(counts).sort((a, b) => b.localeCompare(a));
    const total  = Object.values(counts).reduce((a, b) => a + b, 0);
    select.innerHTML = `<option value="">Tüm Yıllar · ${total} kişi</option>` +
      years.map(y => `<option value="${y}">${y} · ${counts[y]} kişi</option>`).join('');
  } catch(e) {
    select.innerHTML = '<option value="">Tüm Yıllar</option>';
  }
}

async function fetchObits(reset = false) {
  if (_obitsState.loading) return;
  _obitsState.loading = true;

  if (reset) {
    _obitsState.page  = 0;
    _obitsState.items = [];
    document.getElementById('obits-list').innerHTML =
      '<div class="loading"><div class="spinner"></div></div>';
  } else {
    document.getElementById('obits-loading-more').style.display = 'block';
    document.getElementById('obits-load-more').style.display    = 'none';
  }

  try {
    const { data, count } = await getObitsPaged({
      page:     _obitsState.page,
      pageSize: OBITS_PAGE_SIZE,
      year:     _obitsState.year,
      search:   _obitsState.search || null,
    });
    _obitsState.total  = count;
    _obitsState.items  = reset ? data : [..._obitsState.items, ...data];
    _obitsState.page  += 1;
    renderObitsList(_obitsState.items);
    const hasMore = _obitsState.items.length < count;
    document.getElementById('obits-load-more').style.display    = hasMore ? 'block' : 'none';
    document.getElementById('obits-loading-more').style.display = 'none';
  } catch(e) {
    document.getElementById('obits-list').innerHTML =
      `<div class="error-msg">Veriler yüklenemedi: ${e.message}</div>`;
  } finally {
    _obitsState.loading = false;
  }
}

function renderObitsList(items) {
  const el = document.getElementById('obits-list');
  if (!items.length) {
    el.innerHTML = `<div class="obits-empty">
      <i class="ti ti-search" style="font-size:32px;display:block;margin-bottom:10px;opacity:.3"></i>
      Sonuç bulunamadı.
    </div>`;
    return;
  }
  // Yıla göre grupla
  const groups = {};
  items.forEach(o => {
    const year = o.death_date ? o.death_date.slice(0, 4) : 'Bilinmiyor';
    if (!groups[year]) groups[year] = [];
    groups[year].push(o);
  });
  const sortedYears = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  el.innerHTML = sortedYears.map(year => `
    <div class="obits-year-group">
      <div class="obits-year-header">
        <span class="obits-year-title"><i class="ti ti-calendar" style="margin-right:6px;font-size:13px"></i>${year}</span>
        <span class="obits-year-count">${groups[year].length} kişi</span>
      </div>
      ${groups[year].map(o => obitItemHTML(o)).join('')}
    </div>`).join('');
}

function obitItemHTML(o) {
  const date = o.death_date
    ? new Date(o.death_date).toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' })
    : '';
  const photoHTML = o.photo_url
    ? `<img class="obit-photo" src="${o.photo_url}" alt="${escapeHtml(o.full_name)}"
        onclick="openLightbox('${o.photo_url}','${escapeHtml(o.full_name)}')">`
    : `<div class="obit-photo-placeholder"><i class="ti ti-user"></i></div>`;
  const metaParts = [];
  if (o.funeral_place) metaParts.push(`<i class="ti ti-building" style="font-size:11px;margin-right:3px"></i>${escapeHtml(o.funeral_place)}`);
  if (o.burial_place)  metaParts.push(`<i class="ti ti-map-pin" style="font-size:11px;margin-right:3px"></i>${escapeHtml(o.burial_place)}`);
  if (o.notes)         metaParts.push(`<i class="ti ti-info-circle" style="font-size:11px;margin-right:3px"></i>${escapeHtml(o.notes)}`);
  return `<div class="obit-item">
    ${photoHTML}
    <div class="obit-info">
      <div class="obit-name">${escapeHtml(o.full_name)}</div>
      ${metaParts.length ? `<div class="obit-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>
    ${date ? `<div class="obit-date">${date}</div>` : ''}
  </div>`;
}

window.obitsYearChanged = function(year) {
  _obitsState.year   = year || null;
  _obitsState.search = '';
  document.getElementById('obits-search-input').value = '';
  fetchObits(true);
};

let _obitsSearchTimer = null;
window.obitsSearchChanged = function(val) {
  clearTimeout(_obitsSearchTimer);
  _obitsSearchTimer = setTimeout(() => {
    _obitsState.search = val.trim();
    _obitsState.year   = null;
    document.getElementById('obits-year-select').value = '';
    fetchObits(true);
  }, 400);
};

window.loadMoreObits = function() { fetchObits(false); };

window.goToObitSuggestion = function() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-topluluk').classList.add('active');
  document.querySelectorAll('.bottom-nav .nav-item')[3].classList.add('active');
  setTimeout(() => {
    const noteEl = document.getElementById('c-note');
    const textEl = document.getElementById('c-text');
    if (noteEl) noteEl.value = 'Eksik vefat kaydı bildirimi';
    if (textEl) { textEl.value = 'Ad Soyad:\nVefat Tarihi:\nEk bilgi:'; textEl.focus(); }
    document.getElementById('c-name')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
};

// ── NAVİGASYON ────────────────────────────────────────────
window.showPage = function(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'obits' && !_obitsState.items.length) loadObits();
};

// ── DEEP LINK ─────────────────────────────────────────────
function handleDeepLink() {
  const hash = window.location.hash.replace('#', '');
  if (hash) openSection(hash);
  window.addEventListener('popstate', e => {
    if (e.state?.slug) openSection(e.state.slug);
    else closeDetail();
  });
}

// ── LIGHTBOX ──────────────────────────────────────────────
// ── LIGHTBOX GALERİ ───────────────────────────────────────────
let _lbImages  = [];   // {url, caption} dizisi
let _lbIndex   = 0;    // aktif fotoğraf indexi

// Tek fotoğraf aç — tüm galeriyi yükler, seçilen fotoğraftan başlar
window.openLightbox = function(src, caption) {
  if (window._currentGallery && window._currentGallery.length) {
    _lbImages = window._currentGallery;
    const idx = _lbImages.findIndex(i => i.url === src);
    _lbIndex  = idx >= 0 ? idx : 0;
  } else {
    _lbImages = [{ url: src, caption: caption || '' }];
    _lbIndex  = 0;
  }
  lbShow(_lbIndex);
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeLightbox = function() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
  document.body.style.overflow = '';
};

// Tümünü gör butonu — ilk fotoğraftan başlar
window.openAllGallery = function() {
  if (!window._currentGallery || !window._currentGallery.length) return;
  _lbImages = window._currentGallery;
  _lbIndex  = 0;
  lbShow(0);
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
};

// İleri / geri
window.lbNav = function(dir) {
  const next = _lbIndex + dir;
  if (next < 0 || next >= _lbImages.length) return;
  lbShow(next);
};
function lbShow(idx) {
  _lbIndex = idx;
  const img  = document.getElementById('lightbox-img');
  const cap  = document.getElementById('lightbox-caption');
  const prev = document.getElementById('lb-prev');
  const next = document.getElementById('lb-next');
  const ctr  = document.getElementById('lb-counter');
  const dots = document.getElementById('lb-dots');

  // Fade animasyonu
  img.classList.add('fade');
  setTimeout(() => {
    img.src = _lbImages[idx].url;
    img.onload = () => img.classList.remove('fade');
  }, 150);

  if (cap) cap.textContent = _lbImages[idx].caption || '';

  // Ok butonları
  if (prev) prev.disabled = idx === 0;
  if (next) next.disabled = idx === _lbImages.length - 1;

  // Sayaç
  if (ctr && _lbImages.length > 1) {
    ctr.textContent = `${idx + 1} / ${_lbImages.length}`;
  }

  // Dot'lar (max 12 göster)
  if (dots && _lbImages.length > 1) {
    const maxDots = 12;
    if (_lbImages.length <= maxDots) {
      dots.innerHTML = _lbImages.map((_, i) =>
        `<button class="lightbox-dot${i===idx?' active':''}" onclick="lbShow(${i});event.stopPropagation()"></button>`
      ).join('');
    } else {
      dots.innerHTML = '';
    }
  }
}

// Klavye desteği
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowLeft')  lbNav(-1);
  if (e.key === 'ArrowRight') lbNav(1);
  if (e.key === 'Escape')     closeLightbox();
});

// Swipe desteği (dokunmatik)
(function() {
  let startX = 0;
  const wrap = document.getElementById('lb-img-wrap');
  if (!wrap) return;
  wrap.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive:true });
  wrap.addEventListener('touchend',   e => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) lbNav(diff > 0 ? 1 : -1);
  });
})();

// ── SHARE ─────────────────────────────────────────────────
window.shareApp = function() {
  const data = { title: 'Nikfer Belleği', text: 'Nikfer kasabasının dijital bellek arşivi', url: window.location.href };
  if (navigator.share) navigator.share(data);
  else navigator.clipboard?.writeText(data.url).then(() => showToast('Bağlantı kopyalandı!'));
};
window.shareDetail = function() {
  const url = window.location.href;
  if (navigator.share) navigator.share({ title: document.getElementById('detail-title').textContent, url });
  else navigator.clipboard?.writeText(url).then(() => showToast('Bağlantı kopyalandı!'));
};

// ── TOAST ─────────────────────────────────────────────────
window.showToast = function(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
};

// ── SERVICE WORKER ────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
