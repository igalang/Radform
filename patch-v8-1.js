/* Radform UX patch v8.1: clearer PWA install card on iOS/Android. */

const q = (selector, root = document) => root.querySelector(selector);

const iconDownload = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 3v11m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 15v3.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
</svg>`;

const iconShareIOS = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 15V3m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7 10H5.8A1.8 1.8 0 0 0 4 11.8v7.4A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8v-7.4a1.8 1.8 0 0 0-1.8-1.8H17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const iconAddHome = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/>
  <path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
</svg>`;

const iconMenuAndroid = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>
</svg>`;

const iconInstallAndroid = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 4v10m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="4" y="17" width="16" height="3" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
</svg>`;

function installCardMarkup() {
  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  if (isiOS) {
    return `
      <span class="install-v81-leading">${iconDownload}</span>
      <span class="install-v81-copy">
        <strong>Instalar Radform</strong>
        <span class="install-v81-steps">
          <span>Pulsa</span>
          <span class="install-v81-symbol" title="Compartir" aria-label="Compartir">${iconShareIOS}</span>
          <span>y luego</span>
          <span class="install-v81-symbol" title="Añadir a pantalla de inicio" aria-label="Añadir a pantalla de inicio">${iconAddHome}</span>
        </span>
      </span>`;
  }

  if (isAndroid) {
    return `
      <span class="install-v81-leading">${iconDownload}</span>
      <span class="install-v81-copy">
        <strong>Instalar Radform</strong>
        <span class="install-v81-steps">
          <span>Abre</span>
          <span class="install-v81-symbol" title="Menú">${iconMenuAndroid}</span>
          <span>y pulsa</span>
          <span class="install-v81-symbol" title="Instalar">${iconInstallAndroid}</span>
        </span>
      </span>`;
  }

  return `
    <span class="install-v81-leading">${iconDownload}</span>
    <span class="install-v81-copy">
      <strong>Instalar Radform</strong>
      <span class="install-v81-subtitle">Ábrela como una app desde tu dispositivo.</span>
    </span>`;
}

function upgradeInstallCard() {
  const card = q('#radformInstallCard');
  if (!card || card.dataset.v81 === '1') return;
  card.dataset.v81 = '1';
  card.classList.add('radform-install-card-v81');
  card.innerHTML = installCardMarkup();
}

function watchInstallCard() {
  upgradeInstallCard();
  const observer = new MutationObserver(() => upgradeInstallCard());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchInstallCard, { once: true });
} else {
  watchInstallCard();
}
