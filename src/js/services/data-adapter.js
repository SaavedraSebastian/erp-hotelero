import { createClient } from '@supabase/supabase-js';
import { createInitialERPState } from '../data/seed-data.js';

const LEGACY_STORAGE_KEYS = ['sgh_erp_demo_state_v1', 'sgh_erp_current_user_v1'];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseInstance = null;

export function purgeLegacyLocalStorage() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage access issues
  }
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && String(SUPABASE_URL).startsWith('http'));
}

/**
 * Cliente Supabase reservado exclusivamente para Supabase Auth
 * (signIn, signOut, refresh y sesión). Ninguna operación de negocio
 * ni tabla ERP debe consultarse directamente desde el navegador.
 */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseInstance;
}

export async function fetchEstablishmentConfig() {
  try {
    const res = await fetch('/api/v1/configuracion/establecimiento', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function getPersistenceStatus(lastSyncedAt) {
  return {
    mode: 'api_express',
    label: 'Backend Express + PostgreSQL',
    description: 'Datos operativos en memoria temporal solo para módulos aún en transición; sin PII ni finanzas en localStorage.',
    supabaseConfigured: isSupabaseConfigured(),
    lastSyncedAt,
  };
}

export async function loadERPState() {
  purgeLegacyLocalStorage();
  return { state: createInitialERPState(), source: 'memory_sandbox' };
}

export async function saveERPState(_state) {
  purgeLegacyLocalStorage();
  const syncedAt = new Date().toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return { ok: true, syncedAt, source: 'memory_sandbox' };
}

export function resetDemoState() {
  purgeLegacyLocalStorage();
  return createInitialERPState();
}
