// Detail page for a single listing. Reads the msg_id from the URL path
// (/listing/<id>), fetches /api/listing/<id>, and renders it.

(function () {
  'use strict';

  // Extract msg_id from /listing/<id>
  var path = window.location.pathname.replace(/\/+$/, '');
  var parts = path.split('/');
  var msgId = parts[parts.length - 1];

  var content = document.getElementById('content');
  var lightbox = document.getElementById('lightbox');
  var lightboxContent = document.getElementById('lightbox-content');
  var lightboxClose = document.getElementById('lightbox-close');

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

    var phoneHtml = data.phone
      ? '<div class="meta-item"><div class="label">Telefone</div><div class="value">' + esc(data.phone) + '</div></div>'
      : '';

    var locationHtml = (data.location || data.location_raw)
      ? '<div class="meta-item"><div class="label">Localização</div><div class="value">' +
        esc(data.location || '') +
        (data.location_raw && data.location_raw !== data.location
          ? '<br><span style="color:var(--muted);font-size:12px">' + esc(data.location_raw) + '</span>'
          : '') +
        '</div></div>'
      : '';

    var typologyHtml = data.typology
      ? '<div class="meta-item"><div class="label">Tipologia</div><div class="value">' + esc(data.typology) + '</div></div>'
      : '';

    var html =
      '<div class="card">' +
        '<span class="badge">' + esc(data.category || '') + '</span>' +
        '<h1>' + (data.title ? esc(data.title) : '<em style="color:var(--muted)">Sem título</em>') + '</h1>' +
        priceHtml +
        '<div class="meta">' +
          typologyHtml +
          locationHtml +
          phoneHtml +
          '<div class="meta-item"><div class="label">Publicado</div><div class="value">' + esc(fmtDate(data.timestamp)) + '</div></div>' +
          '<div class="meta-item"><div class="label">Grupo</div><div class="value">' + esc(data.chat_name || '—') + '</div></div>' +
          '<div class="meta-item"><div class="label">Autor</div><div class="value">' + esc(data.sender || '—') + '</div></div>' +
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

    // Wire up copy buttons
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

    // Wire up media clicks → lightbox
    var items = content.querySelectorAll('.media-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function () {
        openLightbox(this.getAttribute('data-type'), this.getAttribute('data-src'));
      });
    }
  }

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
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });

  function showError(msg) {
    content.innerHTML = '<div class="card"><h1>Erro</h1><p>' + esc(msg) + '</p>' +
      '<div class="actions"><a class="btn primary" href="/">Voltar à lista</a></div></div>';
  }

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