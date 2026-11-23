const SITE_KEY = 'sgh_active_site_id';

export function getActiveSiteId() {
  try { return localStorage.getItem(SITE_KEY) || ''; } catch { return ''; }
}

export function setActiveSiteId(siteId) {
  try {
    if (siteId) localStorage.setItem(SITE_KEY, siteId);
    else localStorage.removeItem(SITE_KEY);
  } catch {
    // El contexto seguirá activo en memoria aunque el navegador bloquee almacenamiento.
  }
}
