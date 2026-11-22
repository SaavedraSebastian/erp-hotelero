import { authHeaders } from './auth-client.js';

export class ApiClientError extends Error {
  constructor(message, { status = 500, code = 'API_ERROR', requestId = null, fieldErrors = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
  }
}

const inFlightGetRequests = new Map();

/**
 * Cliente HTTP centralizado para consumir el espacio versionado /api/v1/*
 * con Bearer token de Supabase Auth, deduplicación de GETs concurrentes y manejo de abort/timeout.
 */
export async function apiV1Request(path, options = {}) {
  const {
    method = 'GET',
    body,
    signal,
    timeoutMs = 15000,
    dedupKey,
    headers: extraHeaders = {},
  } = options;

  const normalizedMethod = String(method).toUpperCase();
  const url = path.startsWith('/api/v1') ? path : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  const effectiveDedupKey = normalizedMethod === 'GET' && !signal ? (dedupKey ?? url) : null;

  if (effectiveDedupKey && inFlightGetRequests.has(effectiveDedupKey)) {
    return inFlightGetRequests.get(effectiveDedupKey);
  }

  const execute = async () => {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      const headers = {
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
        ...extraHeaders,
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, {
        method: normalizedMethod,
        headers,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await res.json() : null;

      if (!res.ok) {
        const errInfo = payload?.error ?? {};
        throw new ApiClientError(
          errInfo.message || payload?.message || `Error HTTP ${res.status}`,
          {
            status: res.status,
            code: errInfo.code || 'HTTP_ERROR',
            requestId: payload?.requestId ?? null,
            fieldErrors: errInfo.fieldErrors ?? null,
          }
        );
      }

      return payload;
    } catch (err) {
      if (err instanceof ApiClientError) throw err;
      if (err?.name === 'AbortError') {
        throw new ApiClientError('La solicitud excedió el tiempo de espera o fue cancelada.', {
          status: 408,
          code: 'REQUEST_ABORTED',
        });
      }
      throw new ApiClientError('Error de red al comunicarse con el servidor ERP.', {
        status: 0,
        code: 'NETWORK_ERROR',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const promise = execute().finally(() => {
    if (effectiveDedupKey) {
      inFlightGetRequests.delete(effectiveDedupKey);
    }
  });

  if (effectiveDedupKey) {
    inFlightGetRequests.set(effectiveDedupKey, promise);
  }
  return promise;
}

export const v1Api = {
  getEstablecimiento: () => apiV1Request('/configuracion/establecimiento'),
  getSessionMe: () => apiV1Request('/session/me'),
  getDashboardResumen: () => apiV1Request('/dashboard/resumen'),
  getBitacoras: (modulo = 'ALL', page = 1, pageSize = 50) =>
    apiV1Request(`/auditoria/bitacoras?modulo=${encodeURIComponent(modulo)}&page=${page}&pageSize=${pageSize}`),
  // M5 CRM (solicitud_huesped usa REGISTRADA | DERIVADA | EN_ATENCION | ATENDIDA | CANCELADA)
  getSolicitudesHuesped: (page = 1, pageSize = 50) =>
    apiV1Request(`/m5/solicitudes?page=${page}&pageSize=${pageSize}`),
  createSolicitudHuesped: (payload) =>
    apiV1Request('/m5/solicitudes', { method: 'POST', body: payload }),
  updateSolicitudHuespedEstado: (id, estado, notasResolucion) =>
    apiV1Request(`/m5/solicitudes/${encodeURIComponent(id)}/estado`, {
      method: 'PATCH',
      body: { estado, notasResolucion },
    }),
};
