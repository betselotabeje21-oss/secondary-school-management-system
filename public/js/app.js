document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-submit-on-change]').forEach(function (form) {
    form.addEventListener('change', function () {
      if (form.reportValidity()) form.requestSubmit();
    });
  });

  const toggle = document.querySelector('.nav-toggle');
  const appShell = document.querySelector('.app-shell');
  const navBackdrop = document.querySelector('.nav-backdrop');
  function setNavigationOpen(isOpen) {
    if (!appShell || !toggle) return;
    appShell.classList.toggle('nav-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    if (navBackdrop) navBackdrop.hidden = !isOpen;
  }
  if (toggle && appShell) {
    toggle.addEventListener('click', function () {
      setNavigationOpen(!appShell.classList.contains('nav-open'));
    });
    if (navBackdrop) navBackdrop.addEventListener('click', function () { setNavigationOpen(false); });
    appShell.querySelectorAll('.main-nav a').forEach(function (link) {
      link.addEventListener('click', function () { setNavigationOpen(false); });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setNavigationOpen(false);
    });
  }

  const publicHeader = document.querySelector('.public-header');
  const publicNavToggle = document.querySelector('.public-nav-toggle');
  if (publicHeader && publicNavToggle) {
    publicNavToggle.addEventListener('click', function () {
      const isOpen = publicHeader.classList.toggle('nav-open');
      publicNavToggle.setAttribute('aria-expanded', String(isOpen));
      publicNavToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });

    publicHeader.querySelectorAll('.public-nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        publicHeader.classList.remove('nav-open');
        publicNavToggle.setAttribute('aria-expanded', 'false');
        publicNavToggle.setAttribute('aria-label', 'Open navigation menu');
      });
    });
  }

  const themeButtons = document.querySelectorAll('.theme-toggle');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButtons.forEach(function (button) {
      const isDark = theme === 'dark';
      const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(isDark));
    });
  }

  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  themeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      try {
        localStorage.setItem('school-theme', nextTheme);
      } catch (error) {
        console.error('Selected theme could not be saved:', error);
      }
    });
  });

  const clockDay = document.querySelector('[data-clock-day]');
  const clockDate = document.querySelector('[data-clock-date]');
  const clockTime = document.querySelector('[data-clock-time]');
  if (clockDay && clockDate && clockTime) {
    function updateClock() {
      const now = new Date();
      let dateFormatter;
      let timeFormatter;
      try {
        const locale = document.documentElement.lang || 'en';
        dateFormatter = new Intl.DateTimeFormat(locale, {
          timeZone: 'Africa/Addis_Ababa',
          weekday: 'long',
          month: 'long',
          day: '2-digit',
          year: 'numeric'
        });
        timeFormatter = new Intl.DateTimeFormat(locale, {
          timeZone: 'Africa/Addis_Ababa',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (error) {
        dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Addis_Ababa', weekday: 'long', month: 'long', day: '2-digit', year: 'numeric' });
        timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Addis_Ababa', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
      const dateParts = Object.fromEntries(dateFormatter.formatToParts(now).map(function (part) {
        return [part.type, part.value];
      }));
      clockDay.textContent = dateParts.weekday;
      clockDate.textContent = `${dateParts.month} ${dateParts.day}, ${dateParts.year}`;
      clockTime.textContent = timeFormatter.format(now);
      clockTime.dateTime = now.toISOString();
    }

    updateClock();
    window.setInterval(updateClock, 1000);
  }

  document.querySelectorAll('.password-toggle').forEach(function (passwordToggle) {
    const passwordInput = passwordToggle.closest('.password-field')?.querySelector('input');
    if (!passwordInput) return;
    passwordToggle.addEventListener('click', function () {
      const shouldShow = passwordInput.type === 'password';
      passwordInput.type = shouldShow ? 'text' : 'password';
      passwordToggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
      passwordToggle.setAttribute('aria-pressed', String(shouldShow));
      const icon = passwordToggle.querySelector('img');
      if (icon) icon.src = shouldShow ? '/icons/eye-off.svg' : '/icons/eye.svg';
    });
  });

  document.querySelectorAll('form.auth-form, form[data-auth-loading]').forEach(function (authForm) {
    authForm.addEventListener('submit', function () {
      const submitButton = authForm.querySelector('button[type="submit"]');
      if (!submitButton || !authForm.reportValidity()) return;
      const label = document.createElement('span');
      label.className = 'visually-hidden';
      label.textContent = submitButton.textContent.trim();
      const spinner = document.createElement('span');
      spinner.className = 'loading-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.replaceChildren(spinner, label);
    });
  });

  window.handleGoogleCredential = async function (googleResponse) {
    const errorBox = document.querySelector('[data-google-error]');
    try {
      const response = await fetch('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: googleResponse?.credential || '' })
      });
      const result = await response.json();
      if (!response.ok || !result.redirect) throw new Error(result.error || 'Google sign-in failed.');
      window.location.assign(result.redirect);
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
    }
  };

  const languageSelects = document.querySelectorAll('.language-selector');
  const supportedLanguages = new Set(['en', 'am', 'om', 'ti', 'so', 'ar', 'fr', 'es', 'de', 'pt', 'sw', 'it', 'zh-CN', 'hi']);
  const localeByLanguage = {
    en: 'en-ET', am: 'am-ET', om: 'om-ET', ti: 'ti-ET', so: 'so-SO', ar: 'ar',
    fr: 'fr', es: 'es', de: 'de', pt: 'pt', sw: 'sw', it: 'it', 'zh-CN': 'zh-CN', hi: 'hi'
  };
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  const translationCache = new Map();
  const languageStatus = document.querySelectorAll('[data-language-status]');
  let selectedLanguage = 'en';

  try {
    const savedLanguage = localStorage.getItem('school-language');
    if (supportedLanguages.has(savedLanguage)) selectedLanguage = savedLanguage;
    const savedTranslations = JSON.parse(localStorage.getItem('school-translations') || '{}');
    Object.entries(savedTranslations).forEach(function (entry) { translationCache.set(entry[0], entry[1]); });
  } catch (error) {
    console.warn('Saved language could not be loaded:', error);
  }

  function applyDocumentLanguage(language) {
    selectedLanguage = language;
    document.documentElement.lang = localeByLanguage[language] || 'en';
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    languageSelects.forEach(function (select) { select.value = language; });
    languageStatus.forEach(function (status) { status.hidden = true; });
    try {
      localStorage.setItem('school-language', language);
    } catch (error) {
      console.warn('Selected language could not be saved:', error);
    }
  }

  function collectTranslatableContent() {
    const records = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const value = node.textContent || '';
      if (!parent || parent.closest('script,style,noscript,svg,[data-translation-skip]') || !value.trim() || value.trim().length > 500) continue;
      if (!originalText.has(node)) originalText.set(node, value);
      const textNode = node;
      const original = originalText.get(node);
      const trimmed = original.trim();
      const leading = original.slice(0, original.indexOf(trimmed));
      const trailing = original.slice(original.indexOf(trimmed) + trimmed.length);
      records.push({ value: trimmed, apply: function (translated) { textNode.textContent = leading + translated + trailing; }, restore: function () { textNode.textContent = original; } });
    }

    document.body.querySelectorAll('[placeholder],[title],[aria-label]').forEach(function (element) {
      if (element.closest('script,style,noscript,svg,[data-translation-skip]')) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (attribute) {
        if (!element.hasAttribute(attribute)) return;
        let originals = originalAttributes.get(element);
        if (!originals) {
          originals = {};
          originalAttributes.set(element, originals);
        }
        if (originals[attribute] === undefined) originals[attribute] = element.getAttribute(attribute);
        const value = originals[attribute];
        if (!value || value.length > 500) return;
        records.push({ value: value, apply: function (translated) { element.setAttribute(attribute, translated); }, restore: function () { element.setAttribute(attribute, value); } });
      });
    });

    if (!originalText.has(document.documentElement)) originalText.set(document.documentElement, document.title);
    const originalTitle = originalText.get(document.documentElement);
    records.push({ value: originalTitle, apply: function (translated) { document.title = translated; }, restore: function () { document.title = originalTitle; } });
    return records;
  }

  async function translatePage(language) {
    const records = collectTranslatableContent();
    if (language === 'en') {
      records.forEach(function (record) { record.restore(); });
      return;
    }

    const uniqueValues = Array.from(new Set(records.map(function (record) { return record.value; })));
    const missingValues = uniqueValues.filter(function (value) { return !translationCache.has(language + ':' + value); });
    let translationFailed = false;
    const batches = [];
    let batch = [];
    let batchSize = 0;
    missingValues.forEach(function (value) {
      if (batch.length >= 30 || batchSize + value.length > 4000) {
        batches.push(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(value);
      batchSize += value.length;
    });
    if (batch.length) batches.push(batch);

    for (let index = 0; index < batches.length; index += 3) {
      await Promise.all(batches.slice(index, index + 3).map(async function (texts) {
        try {
          const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: language, texts: texts })
          });
          if (!response.ok) throw new Error('Translation service returned an error.');
          const result = await response.json();
          if (result.translations.length !== texts.length) throw new Error('Translation service returned an incomplete result.');
          texts.forEach(function (text, textIndex) { translationCache.set(language + ':' + text, result.translations[textIndex]); });
          try {
            localStorage.setItem('school-translations', JSON.stringify(Object.fromEntries(Array.from(translationCache.entries()).slice(-500))));
          } catch (error) {
            console.warn('Translated text could not be cached:', error);
          }
        } catch (error) {
          translationFailed = true;
          console.warn('Page translation could not be completed:', error);
        }
      }));
    }

    if (selectedLanguage !== language) return;
    records.forEach(function (record) {
      const translated = translationCache.get(language + ':' + record.value);
      if (translated) record.apply(translated);
      else record.restore();
    });
    if (translationFailed && missingValues.some(function (value) { return !translationCache.has(language + ':' + value); })) {
      languageStatus.forEach(function (status) {
        status.textContent = 'Translation is temporarily unavailable; untranslated text remains in English.';
        status.hidden = false;
      });
    }
  }

  applyDocumentLanguage(selectedLanguage);
  translatePage(selectedLanguage);
  languageSelects.forEach(function (select) {
    select.addEventListener('change', function () {
      const language = supportedLanguages.has(select.value) ? select.value : 'en';
      applyDocumentLanguage(language);
      translatePage(language);
    });
  });

  const profileForm = document.querySelector('[data-profile-photo-form]');
  if (profileForm) {
    const fileInput = profileForm.querySelector('[data-profile-file]');
    const saveButton = profileForm.querySelector('[data-save-photo]');
    const cancelButton = profileForm.querySelector('[data-cancel-photo]');
    const image = document.querySelector('[data-profile-image]');
    const initial = document.querySelector('[data-profile-initial]');
    const savedImage = image.getAttribute('src') || '';
    const uploadButton = profileForm.querySelector('[data-upload-photo]');
    let previewUrl = '';

    function showPhotoError(message) {
      let alert = profileForm.querySelector('[data-photo-client-error]');
      if (!alert) {
        alert = document.createElement('p');
        alert.className = 'alert error';
        alert.setAttribute('role', 'alert');
        alert.dataset.photoClientError = '';
        profileForm.prepend(alert);
      }
      alert.textContent = message;
    }

    function previewFile(file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
        fileInput.value = '';
        showPhotoError('Choose a JPG, PNG, or WEBP image under 5 MB.');
        return false;
      }
      const error = profileForm.querySelector('[data-photo-client-error]');
      if (error) error.remove();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      image.src = previewUrl;
      image.hidden = false;
      initial.hidden = true;
      saveButton.disabled = false;
      cancelButton.hidden = false;
      return true;
    }

    function cancelPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      fileInput.value = '';
      if (savedImage) {
        image.src = savedImage;
        image.hidden = false;
        initial.hidden = true;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
        initial.hidden = false;
      }
      saveButton.disabled = true;
      cancelButton.hidden = true;
    }

    uploadButton.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) previewFile(fileInput.files[0]);
    });
    cancelButton.addEventListener('click', cancelPreview);
    const removeForm = document.querySelector('[data-remove-photo-form]');
    if (removeForm) removeForm.addEventListener('submit', function (event) {
      if (!window.confirm('Remove your current profile photo?')) event.preventDefault();
    });

    const cameraDialog = document.querySelector('[data-camera-dialog]');
    const cameraVideo = cameraDialog.querySelector('[data-camera-video]');
    const cameraMessage = cameraDialog.querySelector('[data-camera-message]');
    const captureButton = cameraDialog.querySelector('[data-capture-photo]');
    let cameraStream = null;

    function stopCamera() {
      if (cameraStream) cameraStream.getTracks().forEach(function (track) { track.stop(); });
      cameraStream = null;
      cameraVideo.srcObject = null;
      captureButton.disabled = true;
    }

    profileForm.querySelector('[data-open-camera]').addEventListener('click', async function () {
      cameraMessage.textContent = 'Allow camera access to take a photo.';
      captureButton.disabled = true;
      cameraDialog.showModal();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cameraMessage.textContent = 'Camera access is not available in this browser or page context.';
        return;
      }
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (!cameraDialog.open) {
          stopCamera();
          return;
        }
        cameraVideo.srcObject = cameraStream;
        await cameraVideo.play();
        captureButton.disabled = false;
      } catch (error) {
        cameraMessage.textContent = error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
          : 'No camera is available. You can upload a photo instead.';
      }
    });

    cameraDialog.querySelector('[data-close-camera]').addEventListener('click', function () { cameraDialog.close(); });
    cameraDialog.addEventListener('cancel', stopCamera);
    cameraDialog.addEventListener('close', stopCamera);
    window.addEventListener('pagehide', stopCamera);
    captureButton.addEventListener('click', function () {
      if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = cameraVideo.videoWidth;
      canvas.height = cameraVideo.videoHeight;
      canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
      canvas.toBlob(function (blob) {
        if (!blob) {
          cameraMessage.textContent = 'The photo could not be captured. Please try again.';
          return;
        }
        const file = new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        previewFile(file);
        cameraDialog.close();
      }, 'image/jpeg', 0.92);
    });
  }
});
