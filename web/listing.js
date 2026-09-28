// Detail page for a single listing. Reads the msg_id from the URL path
// (/listing/<id>), fetches /api/listing/<id>, and renders it.
// Prev/Next navigate through the list stored in sessionStorage by app.js.

(function () {
  'use strict';

  var path = window.location.pathname.replace(/\/+$/, '');
  var parts = path.split('/');
  var msgId = parts[parts.length - 1];

  var content = document.getElementById('content');
  var lightbox = document.getElementById('lightbox');
  var lightboxContent = document.getElementById('lightbox-content');
  var lightboxClose = document.getElementById('lightbox-close');
  var navBar = document.getElementById('nav-bar');
  var navPrev = document.getElementById('nav-prev');
  var navNext = document.getElementById('nav-next');
  var navPos = document.getElementById('nav-pos');

  // ---------- Prev/Next navigation state ----------

  var navList = [];
  var navIndex = -1;

  function loadNavList() {
    try {
      var raw = sessionStorage.getItem('navList');
      if (!raw) return;
      navList = JSON.parse(raw);
      if (!Array.isArray(navList)) navList = [];
      navIndex = navList.indexOf(msgId);
    } catch (e) {
      navList = [];
      navIndex = -1;
    }
  }

  function wireNav() {
    if (navIndex < 0 || navList.length === 0) {
      navBar.style.display = 'none';
      return;
    }
    navBar.style.display = 'flex';
    navPos.textContent = (navIndex + 1) + ' / ' + navList.length;

    if (navIndex > 0) {
      navPrev.href = '/listing/' + encodeURIComponent(navList[navIndex - 1]);
      navPrev.classList.remove('disabled');
    } else {
      navPrev.removeAttribute('href');
      navPrev.classList.add('disabled');
    }

    if (navIndex < navList.length - 1) {
      navNext.href = '/listing/' + encodeURIComponent(navList[navIndex + 1]);
      navNext.classList.remove('disabled');
    } else {
      navNext.removeAttribute('href');
      navNext.classList.add('disabled');
    }
  }

  // ---------- Helpers ----------

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtPrice(n, text) {
    if (text) return text;
    if (!n) return '';
    return n.toLocaleString('pt-PT') + ' Kz';
  }

  // Renders a meta field. Always emits the wrapper so the grid keeps the
  // same shape regardless of which fields are empty. Empty values get "—".
  function metaItem(label, valueHtml) {
    var v = (valueHtml && valueHtml !== '') ? valueHtml : '<span class="dash">—</span>';
    return '<div class="meta-item"><div class="label">' + esc(label) + '</div>' +
           '<div class="value">' + v + '</div></div>';
  }

  // ---------- Render ----------

  function render(data) {
    var priceStr = fmtPrice(data.price, data.price_text);
    var priceHtml = priceStr
      ? '<div class="price-banner">' + esc(priceStr) + '</div>'
      : '<div class="price-banner no-price">Sem preço indicado</div>';

    var mediaHtml = '';
    if (data.media && data.media.length > 0) {
      mediaHtml = '<div class="card"><h2>Média (' + data.media.length + ')</h2><div class="media-grid">';
      for (var i = 0; i < data.media.length; i++) {
        var m = data.media[i];
        if (m.type === 'video') {
          mediaHtml += '<div class="media-item" data-type="video" data-src="' + esc(m.url) + '">' +
            '<video src="' + esc(m.url) + '" muted preload="metadata"></video>' +
            '</div>';
        } else {
          mediaHtml += '<div class="media-item" data-type="image" data-src="' + esc(m.url) + '">' +
            '<img src="' + esc(m.url) + '" loading="lazy" alt="">' +
            '</div>';
        }
      }
      mediaHtml += '</div></div>';
    }

    // Build each meta field — always emitted, empty values render as "—".
    var typologyVal = data.typology ? esc(data.typology) : '';

    var locationVal = '';
    if (data.location || data.location_raw) {
      locationVal = esc(data.location || '');
      if (data.location_raw && data.location_raw !== data.location) {
        locationVal += '<br><span class="loc-sub">' + esc(data.location_raw) + '</span>';
      }
    }

    var phoneVal = data.phone ? esc(data.phone) : '';
    var publishedVal = esc(fmtDate(data.timestamp));
    var groupVal = data.chat_name ? esc(data.chat_name) : '';
    var authorVal = data.sender ? esc(data.sender) : '';

    var html =
      '<div class="card">' +
        '<span class="badge">' + esc(data.category || '') + '</span>' +
        '<h1>' + (data.title ? esc(data.title) : '<em style="color:var(--muted)">Sem título</em>') + '</h1>' +
        priceHtml +
        '<div class="meta">' +
          metaItem('Tipologia', typologyVal) +
          metaItem('Localização', locationVal) +
          metaItem('Telefone', phoneVal) +
          metaItem('Publicado', publishedVal) +
          metaItem('Grupo', groupVal) +
          metaItem('Autor', authorVal) +
        '</div>' +
        '<div class="actions">' +
          '<a class="btn primary" href="/">Voltar à lista</a>' +
          '<button class="btn" id="copy-raw">Copiar texto</button>' +
          '<button class="btn" id="copy-id">Copiar ID</button>' +
        '</div>' +
      '</div>' +

      mediaHtml +

      '<div class="card">' +
        '<h2>Texto original</h2>' +
        '<div class="raw">' + esc(data.raw_text || '—') + '</div>' +
      '</div>';

    content.innerHTML = html;

    var copyRaw = document.getElementById('copy-raw');
    if (copyRaw) {
      copyRaw.addEventListener('click', function () {
        navigator.clipboard.writeText(data.raw_text || '').then(function () {
          copyRaw.textContent = 'Copiado!';
          setTimeout(function () { copyRaw.textContent = 'Copiar texto'; }, 1500);
        });
      });
    }
    var copyId = document.getElementById('copy-id');
    if (copyId) {
      copyId.addEventListener('click', function () {
        navigator.clipboard.writeText(data.msg_id || '').then(function () {
          copyId.textContent = 'Copiado!';
          setTimeout(function () { copyId.textContent = 'Copiar ID'; }, 1500);
        });
      });
    }

    var items = content.querySelectorAll('.media-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function () {
        openLightbox(this.getAttribute('data-type'), this.getAttribute('data-src'));
      });
    }
  }

  // ---------- Lightbox ----------

  function openLightbox(type, src) {
    if (type === 'video') {
      lightboxContent.innerHTML = '<video src="' + esc(src) + '" controls autoplay></video>';
    } else {
      lightboxContent.innerHTML = '<img src="' + esc(src) + '" alt="">';
    }
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lightboxContent.innerHTML = '';
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  // ---------- Keyboard shortcuts ----------

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowLeft' && navIndex > 0) {
      window.location.href = '/listing/' + encodeURIComponent(navList[navIndex - 1]);
    } else if (e.key === 'ArrowRight' && navIndex >= 0 && navIndex < navList.length - 1) {
      window.location.href = '/listing/' + encodeURIComponent(navList[navIndex + 1]);
    }
  });

  // ---------- Error handling ----------

  function showError(msg) {
    content.innerHTML = '<div class="card"><h1>Erro</h1><p>' + esc(msg) + '</p>' +
      '<div class="actions"><a class="btn primary" href="/">Voltar à lista</a></div></div>';
  }

  // ---------- Boot ----------

  loadNavList();
  wireNav();

  if (!msgId) {
    showError('ID em falta no URL.');
    return;
  }

  fetch('/api/listing/' + encodeURIComponent(msgId))
    .then(function (r) {
      if (r.status === 404) throw new Error('Anúncio não encontrado.');
      if (!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function (err) {
      showError(err.message || 'Falha ao carregar.');
    });
})();