// Detail page for a single listing.

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

  // Top price line: only shown when price_ok = 1.
  // Format: "350 000 Kz". No mil/milhões, no preço, no valor.
  function fmtPriceTop(n, ok) {
    if (ok !== 1 || !n || n <= 0) return '';
    return n.toLocaleString('pt-PT').replace(/\u00a0/g, ' ') + ' Kz';
  }

  function metaItem(label, valueHtml) {
    var v = (valueHtml && valueHtml !== '') ? valueHtml : '<span class="dash">—</span>';
    return '<div class="meta-item"><div class="label">' + esc(label) + '</div>' +
           '<div class="value">' + v + '</div></div>';
  }

  function render(data) {
    var topPrice = fmtPriceTop(data.price, data.price_ok);
    var priceHtml;
    if (topPrice) {
      priceHtml = '<div class="price-banner">' + esc(topPrice) + '</div>';
    } else {
      priceHtml = '<div class="price-banner no-price">Preço não reconhecido</div>';
    }
    // Raw price string below, always shown when present, muted.
    if (data.price_text && data.price_text.trim() !== '') {
      priceHtml += '<div class="price-raw">' + esc(data.price_text.trim()) + '</div>';
    }

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

    var sendLabel = (data.sender || data.sender_jid || '').replace(/'/g, '&#39;');
    var sendJid = (data.sender_jid || '').replace(/'/g, '&#39;');
    var sendChat = (data.chat_jid || '').replace(/'/g, '&#39;');

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
          '<button class="btn send-action" onclick="openSendDialog(\'' + sendJid + '\',\'' + sendLabel + '\',\'' + esc(data.msg_id) + '\',\'' + sendChat + '\')">Enviar mensagem</button>' +
        '</div>' +
      '</div>' +

      mediaHtml +

      '<div class="card">' +
        '<h2>Texto original</h2>' +
        '<div class="raw">' + esc(data.raw_text || '—') + '</div>' +
      '</div>';

    content.innerHTML = html;

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
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowLeft' && navIndex > 0) {
      window.location.href = '/listing/' + encodeURIComponent(navList[navIndex - 1]);
    } else if (e.key === 'ArrowRight' && navIndex >= 0 && navIndex < navList.length - 1) {
      window.location.href = '/listing/' + encodeURIComponent(navList[navIndex + 1]);
    }
  });

  function showError(msg) {
    content.innerHTML = '<div class="card"><h1>Erro</h1><p>' + esc(msg) + '</p>' +
      '<div class="actions"><a class="btn primary" href="/">Voltar à lista</a></div></div>';
  }

  themeInit();
  loadNavList();
  wireNav();
  initSendDialog();

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