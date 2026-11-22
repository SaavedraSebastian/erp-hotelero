import { apiV1Request } from './api-client.js';
import { authHeaders, getSessionToken } from './auth-client.js';
import { isSupabaseConfigured } from './data-adapter.js';

export async function requestModuleAIAnalysis(params) {
  const res = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo completar el análisis con Inteligencia Artificial.');
  }
  return data;
}

export async function sendCRMChatMessage(params) {
  // Cuando Supabase Auth está activo, consumir el endpoint persistente /api/v1/ai/asistente/consultar
  if (isSupabaseConfigured() && getSessionToken()) {
    const res = await apiV1Request('/ai/asistente/consultar', {
      method: 'POST',
      body: {
        mensaje: params.message,
        idEstadia: params.idEstadia ?? undefined,
        contextoAnonimizado: params.guestContext ?? {},
      },
    });
    const d = res?.data ?? {};
    return {
      reply: d.respuesta || 'Consulta atendida.',
      text: d.respuesta || 'Consulta atendida.',
      intencion: d.intencion,
      confianza: d.confianza,
      resultado: d.resultado,
    };
  }

  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo contactar al asistente conversacional.');
  }
  return { ...data, text: data.reply || data.text };
}

export const aiDomainClient = {
  generarNoShow: (idReserva) =>
    apiV1Request('/ai/no-show/generar', { method: 'POST', body: { idReserva } }),
  sugerirTarifa: (idReserva) =>
    apiV1Request('/ai/tarifas/sugerir', { method: 'POST', body: { idReserva } }),
  proponerHousekeeping: (idTurno, fecha) =>
    apiV1Request('/ai/housekeeping/proponer', { method: 'POST', body: { idTurno, fecha } }),
  evaluarMantenimiento: (idActivos) =>
    apiV1Request('/ai/mantenimiento/evaluar', { method: 'POST', body: { idActivos } }),
  pronosticarDemanda: (payload) =>
    apiV1Request('/ai/demanda/pronosticar', { method: 'POST', body: payload }),
  evaluarFinanzas: (payload) =>
    apiV1Request('/ai/finanzas/evaluar', { method: 'POST', body: payload }),
  consultarAsistente: (payload) =>
    apiV1Request('/ai/asistente/consultar', { method: 'POST', body: payload }),
};
