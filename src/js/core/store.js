import {
  canEditModuleWithPerms,
  canEditTabWithPerms,
  canViewModuleWithPerms,
  canViewTabWithPerms,
  getDefaultTabForModule,
} from '../data/rbac.js';
import {
  apiGetDirectory,
  apiGetMe,
  apiLogin,
  apiLogout,
  apiUpdateRolePermissions,
  subscribeSupabaseAuthChanges,
} from '../services/auth-client.js';
import {
  fetchEstablishmentConfig,
  getPersistenceStatus,
  loadERPState,
  resetDemoState,
  saveERPState,
} from '../services/data-adapter.js';
import { nowStamp, uid } from '../utils/formatters.js';

const listeners = new Set();
const toastListeners = new Set();

const storeData = {
  state: null,
  establishmentConfig: null,
  lastSyncedAt: null,
  toasts: [],
  currentUser: null,
  currentPermissions: null,
  allRolePermissions: {},
  directoryUsers: [],
  authLoading: true,
  initStarted: false,
};

function emit() {
  for (const fn of listeners) fn(erpStore);
}

function emitToasts() {
  for (const fn of toastListeners) fn(storeData.toasts);
}

async function hydrateAdminDirectory(role) {
  if (role !== 'admin' && role !== 'auditor') {
    storeData.directoryUsers = [];
    emit();
    return;
  }
  const dir = await apiGetDirectory();
  if (dir) {
    storeData.directoryUsers = dir.users;
    storeData.allRolePermissions = dir.permissions;
    emit();
  }
}

function commit(updater, audit, notification) {
  if (!storeData.state) return;
  let next = updater(storeData.state);
  const stamp = nowStamp();

  if (audit) {
    next = {
      ...next,
      auditLog: [
        {
          id: uid('aud'),
          timestamp: stamp,
          user: storeData.currentUser?.name ?? 'Sistema',
          role: storeData.currentUser?.role ?? 'admin',
          module: audit.module,
          action: audit.action,
          entityRef: audit.entityRef,
          privacyImpact: audit.privacyImpact,
        },
        ...next.auditLog,
      ].slice(0, 120),
    };
  }

  if (notification) {
    next = {
      ...next,
      notifications: [
        {
          ...notification,
          id: uid('ntf'),
          timestamp: stamp,
          read: false,
        },
        ...next.notifications,
      ].slice(0, 40),
    };
  }

  storeData.state = next;
  emit();
  saveERPState(next).then(({ syncedAt }) => {
    storeData.lastSyncedAt = syncedAt;
  });
}

export const erpStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  subscribeToasts(fn) {
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  },

  get state() { return storeData.state; },
  get establishmentConfig() { return storeData.establishmentConfig; },
  get currentUser() { return storeData.currentUser; },
  get currentPermissions() { return storeData.currentPermissions; },
  get allRolePermissions() { return storeData.allRolePermissions; },
  get directoryUsers() { return storeData.directoryUsers; },
  get authLoading() { return storeData.authLoading; },
  get toasts() { return storeData.toasts; },
  get persistence() { return getPersistenceStatus(storeData.lastSyncedAt); },
  get canViewFullPII() { return Boolean(storeData.currentPermissions?.canViewFullPII); },

  async init() {
    if (storeData.initStarted) return;
    storeData.initStarted = true;
    try {
      localStorage.removeItem('sgh_erp_current_user_v1');
      localStorage.removeItem('sgh_erp_demo_state_v1');
    } catch {
      // ignore
    }

    subscribeSupabaseAuthChanges(async (sbSession) => {
      if (!sbSession) {
        if (storeData.currentUser?.authMode === 'supabase') {
          storeData.currentUser = null;
          storeData.currentPermissions = null;
          emit();
        }
      }
    });

    const statePromise = loadERPState().then(({ state }) => {
      storeData.state = state;
      storeData.lastSyncedAt = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    });

    const configPromise = fetchEstablishmentConfig().then((cfg) => {
      if (cfg) storeData.establishmentConfig = cfg;
    });

    const authPromise = apiGetMe().then(async (session) => {
      if (session) {
        storeData.currentUser = { ...session.user, authMode: session.authMode };
        storeData.currentPermissions = session.permissions;
        if (session.allRolePermissions) {
          storeData.allRolePermissions = session.allRolePermissions;
        }
        await hydrateAdminDirectory(session.user.role);
      }
    });

    await Promise.all([statePromise, configPromise, authPromise]);
    storeData.authLoading = false;
    emit();
  },

  pushToast(toast) {
    const id = uid('tst');
    storeData.toasts = [{ ...toast, id }, ...storeData.toasts].slice(0, 4);
    emitToasts();
    setTimeout(() => {
      erpStore.dismissToast(id);
    }, 4500);
  },

  dismissToast(id) {
    const next = storeData.toasts.filter((t) => t.id !== id);
    if (next.length !== storeData.toasts.length) {
      storeData.toasts = next;
      emitToasts();
    }
  },

  canView(mod) {
    return canViewModuleWithPerms(storeData.currentPermissions, mod);
  },
  canEdit(mod) {
    return canEditModuleWithPerms(storeData.currentPermissions, mod);
  },
  canViewTab(mod, tabId) {
    return canViewTabWithPerms(storeData.currentPermissions, mod, tabId);
  },
  canEditTab(mod, tabId) {
    return canEditTabWithPerms(storeData.currentPermissions, mod, tabId);
  },
  getDefaultTab(mod) {
    return getDefaultTabForModule(storeData.currentPermissions, mod);
  },

  async login(email, password) {
    const res = await apiLogin(email, password);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    const { user, permissions, allRolePermissions: matrix } = res.data;
    storeData.currentUser = user;
    storeData.currentPermissions = permissions;
    storeData.allRolePermissions = matrix ?? {};

    if (storeData.state) {
      const next = {
        ...storeData.state,
        auditLog: [
          {
            id: uid('aud'),
            timestamp: nowStamp(),
            user: user.name,
            role: user.role,
            module: 'dashboard',
            action: `Inicio de sesión autenticado (${user.roleLabel})`,
            entityRef: user.email,
            privacyImpact: true,
          },
          ...storeData.state.auditLog,
        ].slice(0, 120),
      };
      storeData.state = next;
      saveERPState(next).then(({ syncedAt }) => { storeData.lastSyncedAt = syncedAt; });
    }

    if (user.role === 'admin' || user.role === 'auditor') {
      hydrateAdminDirectory(user.role);
    } else {
      storeData.directoryUsers = [];
    }

    emit();
    erpStore.pushToast({ title: `Bienvenido, ${user.name}`, detail: user.roleLabel, type: 'success' });
    return { ok: true };
  },

  async logout() {
    const leavingUser = storeData.currentUser;
    await apiLogout();
    if (leavingUser && storeData.state) {
      const next = {
        ...storeData.state,
        auditLog: [
          {
            id: uid('aud'),
            timestamp: nowStamp(),
            user: leavingUser.name,
            role: leavingUser.role,
            module: 'dashboard',
            action: `Cierre de sesión (${leavingUser.roleLabel})`,
            entityRef: leavingUser.email,
          },
          ...storeData.state.auditLog,
        ].slice(0, 120),
      };
      storeData.state = next;
      saveERPState(next).then(({ syncedAt }) => { storeData.lastSyncedAt = syncedAt; });
    }
    storeData.currentUser = null;
    storeData.currentPermissions = null;
    storeData.allRolePermissions = {};
    storeData.directoryUsers = [];
    emit();
  },

  async updateRolePermissions(role, next) {
    const result = await apiUpdateRolePermissions(role, next);
    if (!result.ok) {
      erpStore.pushToast({ title: 'No se pudo actualizar permisos', detail: result.error, type: 'error' });
      return { ok: false, error: result.error };
    }
    storeData.allRolePermissions = result.permissions;
    if (storeData.currentUser?.role === role && result.permissions[role]) {
      storeData.currentPermissions = result.permissions[role];
    }
    commit(
      (prev) => prev,
      { module: 'config', action: `Actualizó matriz RBAC en servidor para rol ${role}`, entityRef: role, privacyImpact: true }
    );
    erpStore.pushToast({ title: 'Permisos actualizados en servidor', detail: `Rol ${role} guardado`, type: 'success' });
    return { ok: true };
  },

  resetAllDemoData() {
    storeData.state = resetDemoState();
    storeData.lastSyncedAt = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    emit();
    erpStore.pushToast({ title: 'Datos iniciales restaurados', detail: 'Se restauró la información operativa al estado inicial.', type: 'info' });
  },

  markAllNotificationsRead() {
    commit((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  markNotificationRead(id) {
    commit((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
  },

  // ============================================================
  // MODULE 01 ACTIONS (Reservas y Recepción)
  // ============================================================
  upsertRoom(roomInput) {
    const isEdit = Boolean(roomInput.id);
    const id = roomInput.id ?? uid('rm');
    commit(
      (prev) => ({
        ...prev,
        rooms: isEdit
          ? prev.rooms.map((r) => (r.id === id ? { ...roomInput, id } : r))
          : [...prev.rooms, { ...roomInput, id }],
      }),
      { module: 'm1', action: isEdit ? `Editó Hab. ${roomInput.number}` : `Registró Hab. ${roomInput.number}`, entityRef: `Hab. ${roomInput.number}` }
    );
    erpStore.pushToast({ title: isEdit ? 'Habitación actualizada' : 'Habitación registrada', detail: `Hab. ${roomInput.number} (${roomInput.type})`, type: 'success' });
  },

  createReservation(input) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'Estado no inicializado' };
    const start = new Date(input.checkInDate);
    const end = new Date(input.checkOutDate);
    const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    const conflict = state.reservations.find(
      (r) =>
        r.roomId === input.roomId &&
        !['Cancelada', 'Check-out', 'No-Show'].includes(r.status) &&
        input.checkInDate < r.checkOutDate &&
        input.checkOutDate > r.checkInDate
    );
    const room = state.rooms.find((r) => r.id === input.roomId);
    const guest = state.guests.find((g) => g.id === input.guestId);
    if (!room || !guest) return { ok: false, message: 'Huésped o habitación no válidos.' };

    if (conflict || room.housekeepingStatus === 'Fuera de servicio') {
      const wlEntry = {
        id: uid('wl'),
        guestName: guest.fullName,
        contact: `${guest.phone} · ${guest.email}`,
        roomType: room.type,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        conflictType: conflict ? 'Sobreventa' : 'Lista de espera',
        status: 'Pendiente',
        createdAt: nowStamp(),
      };
      commit(
        (prev) => ({ ...prev, waitlist: [wlEntry, ...prev.waitlist] }),
        { module: 'm1', action: `Conflicto detectado en Hab. ${room.number}; derivado a Sobreventa/Lista de Espera`, entityRef: `Hab. ${room.number}` },
        {
          sourceModule: 'm1',
          targetModules: ['m1', 'dashboard'],
          title: 'Alerta de sobreventa / conflicto detectado',
          message: `Hab. ${room.number} no disponible (${conflict ? `cruce con ${conflict.code}` : 'Fuera de servicio'}). Solicitud de ${guest.fullName} enviada a Lista de Espera.`,
          severity: 'warning',
        }
      );
      erpStore.pushToast({ title: 'Conflicto detectado — Derivado a Lista de Espera', detail: `Hab. ${room.number} ocupada o bloqueada en esas fechas.`, type: 'warning' });
      return { ok: false, message: 'Conflicto detectado. Se registró automáticamente en Sobreventa y Lista de Espera.' };
    }

    const code = `RES-${new Date().getFullYear().toString().slice(-2)}${String(state.reservations.length + 11).padStart(3, '0')}`;
    const noShowRisk = input.channel === 'Booking.com' || input.channel === 'Expedia' ? 32 : 8;
    const newRes = {
      id: uid('res'),
      code,
      guestId: input.guestId,
      roomId: input.roomId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      nights,
      adults: input.adults,
      children: input.children,
      channel: input.channel,
      nightlyRate: input.nightlyRate,
      totalAmount: nights * input.nightlyRate,
      status: 'Confirmada',
      specialRequests: input.specialRequests,
      noShowRisk,
      createdAt: nowStamp().slice(0, 10),
      history: [{ timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'Recepción', action: `Reserva creada (${input.channel})` }],
    };

    commit(
      (prev) => ({
        ...prev,
        reservations: [newRes, ...prev.reservations],
        rooms: prev.rooms.map((r) =>
          r.id === input.roomId && r.commercialStatus === 'Disponible'
            ? { ...r, commercialStatus: 'Reservada', currentReservationId: newRes.id }
            : r
        ),
      }),
      { module: 'm1', action: `Creó reserva ${code} para ${guest.fullName} (Hab. ${room.number})`, entityRef: code },
      {
        sourceModule: 'm1',
        targetModules: ['m1', 'dashboard'],
        title: `Nueva reserva ${code}`,
        message: `${guest.fullName} · Hab. ${room.number} (${nights} noches) · Disponibilidad actualizada.`,
        severity: 'success',
      }
    );
    erpStore.pushToast({ title: `Reserva ${code} creada`, detail: `Disponibilidad actualizada para Hab. ${room.number}`, type: 'success' });
    return { ok: true, message: `Reserva ${code} confirmada.` };
  },

  updateReservationStatus(resId, status, note) {
    commit(
      (prev) => {
        const target = prev.reservations.find((r) => r.id === resId);
        if (!target) return prev;
        const updatedRes = prev.reservations.map((r) =>
          r.id === resId
            ? {
                ...r,
                status,
                history: [
                  ...r.history,
                  { timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'Recepción', action: note ?? `Estado cambiado a ${status}` },
                ],
              }
            : r
        );
        const releaseRoom = status === 'Cancelada' || status === 'No-Show';
        const updatedRooms = releaseRoom
          ? prev.rooms.map((rm) =>
              rm.id === target.roomId
                ? { ...rm, commercialStatus: 'Disponible', currentReservationId: undefined }
                : rm
            )
          : prev.rooms;
        return { ...prev, reservations: updatedRes, rooms: updatedRooms };
      },
      { module: 'm1', action: `Actualizó reserva a ${status}`, entityRef: resId }
    );
    erpStore.pushToast({ title: `Reserva actualizada (${status})`, type: 'info' });
  },

  performCheckIn(resId, overrideRoomId) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'No disponible' };
    const res = state.reservations.find((r) => r.id === resId);
    if (!res) return { ok: false, message: 'Reserva no encontrada' };
    const roomId = overrideRoomId || res.roomId;
    const room = state.rooms.find((r) => r.id === roomId);
    const guest = state.guests.find((g) => g.id === res.guestId);
    if (!room || !guest) return { ok: false, message: 'Datos incompletos' };

    if (room.housekeepingStatus === 'Sucia' || room.housekeepingStatus === 'En limpieza' || room.housekeepingStatus === 'Fuera de servicio') {
      erpStore.pushToast({
        title: `Check-in bloqueado — Hab. ${room.number} (${room.housekeepingStatus})`,
        detail: 'Housekeeping debe limpiar e inspeccionar la habitación antes del ingreso.',
        type: 'error',
      });
      return {
        ok: false,
        message: `La Hab. ${room.number} está "${room.housekeepingStatus}" según Housekeeping. Seleccione otra habitación inspeccionada o complete la inspección correspondiente.`,
      };
    }

    const folioCode = `FOL-${res.code.replace('RES-', '')}`;
    const existingFolio = state.folios.find((f) => f.reservationId === res.id);

    commit(
      (prev) => {
        const nextRooms = prev.rooms.map((rm) =>
          rm.id === roomId
            ? { ...rm, commercialStatus: 'Ocupada', currentReservationId: res.id }
            : rm.id === res.roomId && overrideRoomId && overrideRoomId !== res.roomId
            ? { ...rm, commercialStatus: 'Disponible', currentReservationId: undefined }
            : rm
        );

        const nextReservations = prev.reservations.map((r) =>
          r.id === res.id
            ? {
                ...r,
                roomId,
                status: 'Check-in',
                history: [
                  ...r.history,
                  { timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'Recepción', action: `Check-in realizado en Hab. ${room.number}; Folio ${folioCode} abierto` },
                ],
              }
            : r
        );

        const nextFolios = existingFolio
          ? prev.folios
          : [
              {
                id: uid('fol'),
                code: folioCode,
                reservationId: res.id,
                guestId: guest.id,
                guestName: guest.fullName,
                roomNumber: room.number,
                status: 'Abierto',
                charges: [
                  {
                    id: uid('chg'),
                    date: nowStamp().slice(0, 10),
                    category: 'Alojamiento',
                    description: `Alojamiento ${room.type} (${res.nights} noches · ${res.code})`,
                    amount: res.totalAmount,
                    sourceModule: 'M1',
                    referenceCode: res.code,
                  },
                ],
                payments: [],
                totalCharges: res.totalAmount,
                totalPayments: 0,
                balance: res.totalAmount,
                openedAt: nowStamp(),
              },
              ...prev.folios,
            ];

        const nextGuests = prev.guests.map((g) =>
          g.id === guest.id
            ? { ...g, totalStays: g.totalStays + 1, loyaltyPoints: g.loyaltyPoints + Math.round(res.totalAmount * 0.25) }
            : g
        );

        return { ...prev, rooms: nextRooms, reservations: nextReservations, folios: nextFolios, guests: nextGuests };
      },
      { module: 'm1', action: `Check-in ${res.code} en Hab. ${room.number} y cargo automático al Folio ${folioCode}`, entityRef: res.code },
      {
        sourceModule: 'm1',
        targetModules: ['m4', 'm5', 'dashboard'],
        title: `Check-in completado · Hab. ${room.number}`,
        message: `${guest.fullName} ingresó. Folio ${folioCode} abierto con cargo de alojamiento por S/ ${res.totalAmount.toFixed(2)}.`,
        severity: 'success',
      }
    );

    erpStore.pushToast({ title: `Check-in exitoso · Hab. ${room.number}`, detail: `Folio ${folioCode} creado automáticamente en Finanzas.`, type: 'success' });
    return { ok: true, message: `Check-in completado en Hab. ${room.number}.` };
  },

  performCheckOut(resId, authorizePendingBalance = false) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'No disponible' };
    const res = state.reservations.find((r) => r.id === resId);
    if (!res) return { ok: false, message: 'Estadía no encontrada' };
    const room = state.rooms.find((r) => r.id === res.roomId);
    const folio = state.folios.find((f) => f.reservationId === res.id);
    const guest = state.guests.find((g) => g.id === res.guestId);
    if (!room || !guest) return { ok: false, message: 'Datos incompletos' };

    if (folio && folio.balance > 0.01 && !authorizePendingBalance) {
      erpStore.pushToast({
        title: `Saldo pendiente en Folio ${folio.code}`,
        detail: `Debe liquidar S/ ${folio.balance.toFixed(2)} o enviar a Cuentas por Cobrar autorizada.`,
        type: 'warning',
      });
      return {
        ok: false,
        message: `El folio ${folio.code} mantiene un saldo pendiente de S/ ${folio.balance.toFixed(2)}. Liquide el pago en Facturación o autorice traslado a Cuentas por Cobrar.`,
      };
    }

    const hkStaff = state.staff
      .filter((s) => s.area === 'Housekeeping' && s.available)
      .sort((a, b) => a.activeTasks - b.activeTasks)[0];

    commit(
      (prev) => {
        const nextReservations = prev.reservations.map((r) =>
          r.id === res.id
            ? {
                ...r,
                status: 'Check-out',
                history: [
                  ...r.history,
                  { timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'Recepción', action: `Check-out confirmado. Hab. ${room.number} derivada a Housekeeping.` },
                ],
              }
            : r
        );

        const nextRooms = prev.rooms.map((rm) =>
          rm.id === room.id
            ? {
                ...rm,
                commercialStatus: 'Disponible',
                housekeepingStatus: 'Sucia',
                currentReservationId: undefined,
              }
            : rm
        );

        const nextFolios = prev.folios.map((f) =>
          f.id === folio?.id
            ? { ...f, status: 'Cerrado', closedAt: nowStamp() }
            : f
        );

        const nextReceivables =
          folio && folio.balance > 0.01 && authorizePendingBalance
            ? [
                {
                  id: uid('ar'),
                  folioId: folio.id,
                  clientName: guest.company || guest.fullName,
                  documentRef: folio.code,
                  issueDate: nowStamp().slice(0, 10),
                  dueDate: '2026-12-05',
                  originalAmount: folio.balance,
                  paidAmount: 0,
                  pendingAmount: folio.balance,
                  status: 'Vigente',
                  followUpNote: `Check-out autorizado con saldo trasladado por ${storeData.currentUser?.name ?? 'Recepción'}.`,
                },
                ...prev.receivables,
              ]
            : prev.receivables;

        const newCleaningOrder = {
          id: uid('cln'),
          roomId: room.id,
          roomNumber: room.number,
          type: 'Salida (Check-out)',
          priority: 'Alta',
          assignedStaffId: hkStaff?.id ?? 'stf-2',
          status: 'Pendiente',
          sourceFlow: `Check-out ${res.code}`,
          createdAt: nowStamp(),
          notes: `Generada automáticamente tras salida de ${guest.fullName}.`,
        };

        const nextStaff = prev.staff.map((s) =>
          s.id === (hkStaff?.id ?? 'stf-2') ? { ...s, activeTasks: s.activeTasks + 1 } : s
        );

        const nextGuests = prev.guests.map((g) =>
          g.id === guest.id ? { ...g, totalSpent: g.totalSpent + (folio?.totalCharges ?? res.totalAmount) } : g
        );

        return {
          ...prev,
          reservations: nextReservations,
          rooms: nextRooms,
          folios: nextFolios,
          receivables: nextReceivables,
          cleaningOrders: [newCleaningOrder, ...prev.cleaningOrders],
          staff: nextStaff,
          guests: nextGuests,
        };
      },
      { module: 'm1', action: `Check-out ${res.code} (Hab. ${room.number}) → Orden de limpieza creada`, entityRef: res.code },
      {
        sourceModule: 'm1',
        targetModules: ['m2', 'm4', 'dashboard'],
        title: `Check-out Hab. ${room.number} → Limpieza generada`,
        message: `Cuenta cerrada. Hab. ${room.number} marcada como Sucia y asignada a ${hkStaff?.name ?? 'Housekeeping'}.`,
        severity: 'info',
      }
    );

    erpStore.pushToast({
      title: `Check-out completado · Hab. ${room.number}`,
      detail: 'Orden de limpieza enviada a Housekeeping.',
      type: 'success',
    });
    return { ok: true, message: 'Check-out procesado y notificado a Housekeeping.' };
  },

  upsertRatePlan(input) {
    const isEdit = Boolean(input.id);
    const id = input.id ?? uid('rt');
    commit(
      (prev) => {
        const existing = prev.ratePlans.find((r) => r.id === id);
        const nextHistory = existing
          ? [
              {
                date: nowStamp().slice(0, 10),
                previousPrice: existing.price,
                newPrice: input.price,
                reason: input.reason || 'Actualización manual de tarifa',
                user: storeData.currentUser?.name ?? 'Administrador',
              },
              ...existing.history,
            ]
          : [];
        const record = {
          id,
          name: input.name,
          roomType: input.roomType,
          season: input.season,
          startDate: input.startDate,
          endDate: input.endDate,
          price: input.price,
          active: input.active,
          history: nextHistory,
        };
        return {
          ...prev,
          ratePlans: isEdit ? prev.ratePlans.map((r) => (r.id === id ? record : r)) : [record, ...prev.ratePlans],
          rooms: prev.rooms.map((rm) => (rm.type === input.roomType && input.active ? { ...rm, baseRate: input.price } : rm)),
        };
      },
      { module: 'm1', action: `Actualizó tarifa ${input.name} a S/ ${input.price}`, entityRef: input.roomType }
    );
    erpStore.pushToast({ title: 'Tarifa actualizada', detail: `${input.roomType}: S/ ${input.price}/noche`, type: 'success' });
  },

  applyDynamicRate(roomType, newPrice, reason) {
    commit(
      (prev) => ({
        ...prev,
        ratePlans: prev.ratePlans.map((rp) =>
          rp.roomType === roomType
            ? {
                ...rp,
                price: newPrice,
                history: [
                  { date: nowStamp().slice(0, 10), previousPrice: rp.price, newPrice, reason: `IA Confirmada: ${reason}`, user: storeData.currentUser?.name ?? 'Admin' },
                  ...rp.history,
                ],
              }
            : rp
        ),
        rooms: prev.rooms.map((rm) => (rm.type === roomType ? { ...rm, baseRate: newPrice } : rm)),
      }),
      { module: 'm1', action: `Aplicó tarifa dinámica IA para ${roomType} (S/ ${newPrice})`, entityRef: roomType }
    );
    erpStore.pushToast({ title: 'Tarifa dinámica aplicada', detail: `${roomType} actualizada a S/ ${newPrice} con confirmación humana.`, type: 'success' });
  },

  createWaitlistEntry(entry) {
    commit(
      (prev) => ({
        ...prev,
        waitlist: [{ ...entry, id: uid('wl'), status: 'Pendiente', createdAt: nowStamp() }, ...prev.waitlist],
      }),
      { module: 'm1', action: `Registró solicitud en ${entry.conflictType}`, entityRef: entry.guestName }
    );
    erpStore.pushToast({ title: 'Registro agregado a lista de espera', type: 'info' });
  },

  resolveWaitlistEntry(id, status, decisionNote) {
    commit(
      (prev) => ({
        ...prev,
        waitlist: prev.waitlist.map((w) =>
          w.id === id ? { ...w, status, decisionNote, authorizedBy: storeData.currentUser?.name ?? 'Admin' } : w
        ),
      }),
      { module: 'm1', action: `Decisión autorizada sobre lista de espera: ${status}`, entityRef: id }
    );
    erpStore.pushToast({ title: `Decisión registrada (${status})`, type: 'success' });
  },

  upsertGuest(guestInput) {
    const isEdit = Boolean(guestInput.id);
    const id = guestInput.id ?? uid('gst');
    commit(
      (prev) => {
        const existing = prev.guests.find((g) => g.id === id);
        const record = {
          ...guestInput,
          id,
          totalStays: existing?.totalStays ?? 0,
          totalSpent: existing?.totalSpent ?? 0,
        };
        return {
          ...prev,
          guests: isEdit ? prev.guests.map((g) => (g.id === id ? record : g)) : [record, ...prev.guests],
        };
      },
      { module: 'm1', action: isEdit ? `Actualizó huésped ${guestInput.fullName}` : `Registró huésped ${guestInput.fullName}`, entityRef: guestInput.fullName, privacyImpact: true }
    );
    erpStore.pushToast({ title: isEdit ? 'Huésped actualizado' : 'Huésped registrado', detail: guestInput.fullName, type: 'success' });
  },

  // ============================================================
  // MODULE 02 ACTIONS (Housekeeping y Mantenimiento)
  // ============================================================
  updateRoomHousekeepingStatus(roomId, status) {
    commit(
      (prev) => ({
        ...prev,
        rooms: prev.rooms.map((rm) =>
          rm.id === roomId
            ? {
                ...rm,
                housekeepingStatus: status,
                commercialStatus:
                  status === 'Fuera de servicio'
                    ? 'Bloqueada'
                    : rm.commercialStatus === 'Bloqueada'
                    ? 'Disponible'
                    : rm.commercialStatus,
                lastInspectedAt: status === 'Inspeccionada' ? nowStamp() : rm.lastInspectedAt,
              }
            : rm
        ),
      }),
      { module: 'm2', action: `Actualizó estado físico de habitación a ${status}`, entityRef: roomId }
    );
    erpStore.pushToast({ title: `Estado actualizado: ${status}`, detail: 'Sincronizado con Disponibilidad en Reservas.', type: 'info' });
  },

  createCleaningOrder(input) {
    const state = storeData.state;
    if (!state) return;
    const room = state.rooms.find((r) => r.id === input.roomId);
    if (!room) return;
    const order = {
      id: uid('cln'),
      roomId: room.id,
      roomNumber: room.number,
      type: input.type,
      priority: input.priority,
      assignedStaffId: input.assignedStaffId,
      status: 'Pendiente',
      createdAt: nowStamp(),
      notes: input.notes,
    };
    commit(
      (prev) => ({
        ...prev,
        cleaningOrders: [order, ...prev.cleaningOrders],
        staff: prev.staff.map((s) => (s.id === input.assignedStaffId ? { ...s, activeTasks: s.activeTasks + 1 } : s)),
      }),
      { module: 'm2', action: `Creó orden de limpieza Hab. ${room.number}`, entityRef: `Hab. ${room.number}` }
    );
    erpStore.pushToast({ title: 'Orden de limpieza creada', detail: `Hab. ${room.number} · Prioridad ${input.priority}`, type: 'success' });
  },

  advanceCleaningOrder(orderId, nextStatus, assignedStaffId) {
    commit(
      (prev) => {
        const order = prev.cleaningOrders.find((o) => o.id === orderId);
        if (!order) return prev;
        const nextOrders = prev.cleaningOrders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: nextStatus,
                assignedStaffId: assignedStaffId ?? o.assignedStaffId,
                startedAt: nextStatus === 'En proceso' ? nowStamp() : o.startedAt,
                completedAt: nextStatus === 'Completada' ? nowStamp() : o.completedAt,
              }
            : o
        );
        const nextRooms = prev.rooms.map((rm) => {
          if (rm.id !== order.roomId) return rm;
          if (nextStatus === 'En proceso') return { ...rm, housekeepingStatus: 'En limpieza' };
          if (nextStatus === 'Completada') return { ...rm, housekeepingStatus: 'Limpia' };
          return rm;
        });
        return { ...prev, cleaningOrders: nextOrders, rooms: nextRooms };
      },
      { module: 'm2', action: `Actualizó orden de limpieza a ${nextStatus}`, entityRef: orderId }
    );
    erpStore.pushToast({ title: `Limpieza actualizada: ${nextStatus}`, type: 'info' });
  },

  submitInspection(input) {
    const state = storeData.state;
    if (!state) return;
    const room = state.rooms.find((r) => r.id === input.roomId);
    if (!room) return;
    const inspection = {
      id: uid('insp'),
      cleaningOrderId: input.cleaningOrderId,
      roomId: room.id,
      roomNumber: room.number,
      inspector: storeData.currentUser?.name ?? 'Supervisora Housekeeping',
      date: nowStamp(),
      checklist: input.checklist,
      result: input.result,
      observations: input.observations,
    };
    commit(
      (prev) => ({
        ...prev,
        inspections: [inspection, ...prev.inspections],
        rooms: prev.rooms.map((rm) =>
          rm.id === room.id
            ? {
                ...rm,
                housekeepingStatus: input.result === 'Aprobada' ? 'Inspeccionada' : 'Sucia',
                commercialStatus:
                  input.result === 'Aprobada' && rm.commercialStatus === 'Bloqueada'
                    ? 'Disponible'
                    : rm.commercialStatus,
                lastInspectedAt: nowStamp(),
              }
            : rm
        ),
        cleaningOrders: prev.cleaningOrders.map((o) =>
          o.id === input.cleaningOrderId
            ? { ...o, status: input.result === 'Aprobada' ? 'Inspeccionada' : 'Pendiente' }
            : o
        ),
      }),
      { module: 'm2', action: `Inspección Hab. ${room.number} → ${input.result}`, entityRef: `Hab. ${room.number}` },
      {
        sourceModule: 'm2',
        targetModules: ['m1', 'dashboard'],
        title: `Inspección Hab. ${room.number} ${input.result}`,
        message:
          input.result === 'Aprobada'
            ? `Hab. ${room.number} habilitada como Inspeccionada y lista para Check-in en Recepción.`
            : `Hab. ${room.number} rechazada en inspección; devuelta a limpieza.`,
        severity: input.result === 'Aprobada' ? 'success' : 'warning',
      }
    );
    erpStore.pushToast({
      title: `Inspección ${input.result} · Hab. ${room.number}`,
      detail: input.result === 'Aprobada' ? 'Habilitada automáticamente en Reservas y Recepción.' : 'Devuelta a cola de limpieza.',
      type: input.result === 'Aprobada' ? 'success' : 'warning',
    });
  },

  createIncident(input) {
    const id = uid('inc');
    const code = `INC-2026-${String((storeData.state?.incidents.length ?? 0) + 16).padStart(3, '0')}`;
    const incident = {
      id,
      code,
      roomId: input.roomId,
      location: input.location,
      category: input.category,
      description: input.description,
      priority: input.priority,
      status: input.assignedStaffId ? 'Asignada' : 'Abierta',
      assignedStaffId: input.assignedStaffId,
      linkedComplaintId: input.linkedComplaintId,
      reportedBy: storeData.currentUser?.name ?? 'Operador',
      createdAt: nowStamp(),
    };
    commit(
      (prev) => ({
        ...prev,
        incidents: [incident, ...prev.incidents],
        rooms:
          input.roomId && input.priority === 'Urgente'
            ? prev.rooms.map((rm) => (rm.id === input.roomId && rm.commercialStatus === 'Disponible' ? { ...rm, housekeepingStatus: 'Fuera de servicio', commercialStatus: 'Bloqueada' } : rm))
            : prev.rooms,
      }),
      { module: 'm2', action: `Registró incidencia ${code} en ${input.location}`, entityRef: code }
    );
    erpStore.pushToast({ title: `Incidencia ${code} registrada`, detail: input.location, type: 'warning' });
    return id;
  },

  createWorkOrderFromIncident(incidentId, assignedStaffId, estimatedCost, description) {
    const state = storeData.state;
    if (!state) return;
    const inc = state.incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    const code = `OT-2026-${String(state.workOrders.length + 91).padStart(3, '0')}`;
    const room = state.rooms.find((r) => r.id === inc.roomId);
    const wo = {
      id: uid('wo'),
      code,
      incidentId,
      roomNumber: room?.number,
      location: inc.location,
      description,
      assignedStaffId,
      priority: inc.priority,
      status: 'En ejecución',
      estimatedCost,
      createdAt: nowStamp(),
    };
    commit(
      (prev) => ({
        ...prev,
        workOrders: [wo, ...prev.workOrders],
        incidents: prev.incidents.map((i) => (i.id === incidentId ? { ...i, status: 'En reparación', assignedStaffId } : i)),
      }),
      { module: 'm2', action: `Generó Orden de Trabajo ${code} desde ${inc.code}`, entityRef: code }
    );
    erpStore.pushToast({ title: `Orden de trabajo ${code} generada`, detail: inc.location, type: 'info' });
  },

  completeWorkOrder(workOrderId, resolutionNotes, partsUsed) {
    const state = storeData.state;
    if (!state) return;
    const wo = state.workOrders.find((w) => w.id === workOrderId);
    if (!wo) return;
    const inc = state.incidents.find((i) => i.id === wo.incidentId);
    const linkedComplaint = inc?.linkedComplaintId
      ? state.complaints.find((c) => c.id === inc.linkedComplaintId)
      : undefined;

    commit(
      (prev) => ({
        ...prev,
        workOrders: prev.workOrders.map((w) =>
          w.id === workOrderId ? { ...w, status: 'Completada', resolutionNotes, partsUsed, completedAt: nowStamp() } : w
        ),
        incidents: prev.incidents.map((i) =>
          i.id === wo.incidentId ? { ...i, status: 'Resuelta', resolvedAt: nowStamp() } : i
        ),
        rooms: inc?.roomId
          ? prev.rooms.map((rm) =>
              rm.id === inc.roomId && rm.housekeepingStatus === 'Fuera de servicio'
                ? { ...rm, housekeepingStatus: 'Sucia', commercialStatus: 'Disponible' }
                : rm
            )
          : prev.rooms,
        complaints: linkedComplaint
          ? prev.complaints.map((c) =>
              c.id === linkedComplaint.id
                ? {
                    ...c,
                    status: 'Resuelto',
                    history: [
                      ...c.history,
                      {
                        timestamp: nowStamp(),
                        user: storeData.currentUser?.name ?? 'Mantenimiento',
                        note: `Orden de trabajo ${wo.code} completada. ${resolutionNotes}`,
                      },
                    ],
                  }
                : c
            )
          : prev.complaints,
        expenses:
          wo.estimatedCost > 0
            ? [
                {
                  id: uid('exp'),
                  date: nowStamp().slice(0, 10),
                  category: 'Mantenimiento',
                  costCenter: 'Mantenimiento',
                  supplier: 'Mantenimiento Interno / Repuestos',
                  description: `Reparación ${wo.code} (${wo.location}): ${partsUsed || wo.description}`,
                  amount: wo.estimatedCost,
                  status: 'Pagado',
                  documentRef: wo.code,
                },
                ...prev.expenses,
              ]
            : prev.expenses,
      }),
      { module: 'm2', action: `Completó OT ${wo.code}${linkedComplaint ? ` y resolvió reclamo ${linkedComplaint.code}` : ''}`, entityRef: wo.code },
      {
        sourceModule: 'm2',
        targetModules: linkedComplaint ? ['m5', 'm4', 'dashboard'] : ['m1', 'm4'],
        title: `OT ${wo.code} completada`,
        message: linkedComplaint
          ? `Incidencia resuelta y reclamo CRM ${linkedComplaint.code} actualizado automáticamente a Resuelto.`
          : `Reparación finalizada en ${wo.location}. Costo registrado en Finanzas.`,
        severity: 'success',
      }
    );

    erpStore.pushToast({
      title: `Orden de trabajo ${wo.code} completada`,
      detail: linkedComplaint ? `Reclamo ${linkedComplaint.code} actualizado en CRM.` : `Costo S/ ${wo.estimatedCost} imputado a Finanzas.`,
      type: 'success',
    });
  },

  addPreventiveSchedule(item) {
    commit(
      (prev) => ({
        ...prev,
        preventiveSchedules: [{ ...item, id: uid('prv'), status: 'Programado' }, ...prev.preventiveSchedules],
      }),
      { module: 'm2', action: `Programó mantenimiento preventivo: ${item.assetName}`, entityRef: item.assetName }
    );
    erpStore.pushToast({ title: 'Revisión preventiva programada', detail: item.assetName, type: 'success' });
  },

  completePreventiveSchedule(id) {
    commit(
      (prev) => ({
        ...prev,
        preventiveSchedules: prev.preventiveSchedules.map((p) =>
          p.id === id ? { ...p, status: 'Ejecutado', lastCompletedDate: nowStamp().slice(0, 10) } : p
        ),
      }),
      { module: 'm2', action: 'Registró ejecución de mantenimiento preventivo', entityRef: id }
    );
    erpStore.pushToast({ title: 'Mantenimiento preventivo ejecutado', type: 'success' });
  },

  upsertAsset(asset) {
    const isEdit = Boolean(asset.id);
    const id = asset.id ?? uid('ast');
    commit(
      (prev) => ({
        ...prev,
        assets: isEdit ? prev.assets.map((a) => (a.id === id ? { ...asset, id } : a)) : [{ ...asset, id }, ...prev.assets],
      }),
      { module: 'm2', action: isEdit ? `Editó activo ${asset.code}` : `Registró activo ${asset.code}`, entityRef: asset.code }
    );
    erpStore.pushToast({ title: isEdit ? 'Activo actualizado' : 'Activo registrado', detail: asset.name, type: 'success' });
  },

  consumeHKSupply(supplyId, qty) {
    commit(
      (prev) => ({
        ...prev,
        hkSupplies: prev.hkSupplies.map((s) => (s.id === supplyId ? { ...s, localStock: Math.max(0, s.localStock - qty) } : s)),
      }),
      { module: 'm2', action: `Registró consumo operativo de insumo (${qty})`, entityRef: supplyId }
    );
    erpStore.pushToast({ title: 'Consumo registrado', type: 'info' });
  },

  requestSupplyFromWarehouse(supplyId, quantity, area, notes) {
    const state = storeData.state;
    if (!state) return;
    const hkItem = state.hkSupplies.find((s) => s.id === supplyId);
    const invItem = hkItem
      ? state.inventory.find((i) => i.id === hkItem.inventoryItemId)
      : state.inventory.find((i) => i.id === supplyId);
    if (!invItem) return;

    const code = `SOL-ALM-${String(state.supplyRequisitions.length + 42).padStart(3, '0')}`;
    commit(
      (prev) => ({
        ...prev,
        supplyRequisitions: [
          {
            id: uid('req'),
            code,
            requestedByArea: area,
            requestedByUser: storeData.currentUser?.name ?? area,
            inventoryItemId: invItem.id,
            itemName: invItem.name,
            quantity,
            unit: invItem.unit,
            status: 'Solicitada',
            createdAt: nowStamp(),
            notes,
          },
          ...prev.supplyRequisitions,
        ],
      }),
      { module: 'm2', action: `Solicitó ${quantity} ${invItem.unit} de ${invItem.name} a Almacén`, entityRef: code },
      {
        sourceModule: 'm2',
        targetModules: ['m3', 'dashboard'],
        title: `Nueva solicitud de insumos ${code}`,
        message: `${area} solicita ${quantity} ${invItem.unit} de ${invItem.name}. Pendiente de atención en Almacén.`,
        severity: 'warning',
      }
    );
    erpStore.pushToast({ title: `Solicitud ${code} enviada a Almacén`, detail: 'Requisición registrada en Almacén.', type: 'success' });
  },

  // ============================================================
  // MODULE 03 ACTIONS (Servicios, POS, Restaurante y Almacén)
  // ============================================================
  upsertProduct(product) {
    const isEdit = Boolean(product.id);
    const id = product.id ?? uid('prd');
    commit(
      (prev) => ({
        ...prev,
        products: isEdit ? prev.products.map((p) => (p.id === id ? { ...product, id } : p)) : [{ ...product, id }, ...prev.products],
      }),
      { module: 'm3', action: isEdit ? `Editó producto ${product.name}` : `Creó producto ${product.name}`, entityRef: product.sku }
    );
    erpStore.pushToast({ title: isEdit ? 'Producto actualizado' : 'Producto registrado', detail: product.name, type: 'success' });
  },

  upsertService(service) {
    const isEdit = Boolean(service.id);
    const id = service.id ?? uid('srv');
    commit(
      (prev) => ({
        ...prev,
        services: isEdit ? prev.services.map((s) => (s.id === id ? { ...service, id } : s)) : [{ ...service, id }, ...prev.services],
      }),
      { module: 'm3', action: isEdit ? `Editó servicio ${service.name}` : `Creó servicio ${service.name}`, entityRef: service.code }
    );
    erpStore.pushToast({ title: isEdit ? 'Servicio actualizado' : 'Servicio creado', detail: service.name, type: 'success' });
  },

  upsertRecipe(recipe) {
    const isEdit = Boolean(recipe.id);
    const id = recipe.id ?? uid('rcp');
    commit(
      (prev) => ({
        ...prev,
        recipes: isEdit ? prev.recipes.map((r) => (r.id === id ? { ...recipe, id } : r)) : [{ ...recipe, id }, ...prev.recipes],
      }),
      { module: 'm3', action: `Actualizó recetario de ${recipe.productName}`, entityRef: recipe.productName }
    );
    erpStore.pushToast({ title: 'Recetario guardado', detail: recipe.productName, type: 'success' });
  },

  createPOSOrder(input) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'Estado no listo' };
    if (input.items.length === 0) return { ok: false, message: 'Agrega al menos un producto o servicio.' };

    let targetFolio;
    let targetRoom;

    if (input.paymentMode === 'Cargo a Habitación') {
      if (!input.roomId) return { ok: false, message: 'Selecciona una habitación ocupada para cargar a la cuenta.' };
      targetRoom = state.rooms.find((r) => r.id === input.roomId);
      if (!targetRoom || targetRoom.commercialStatus !== 'Ocupada') {
        return { ok: false, message: 'La habitación seleccionada no tiene una estadía activa.' };
      }
      targetFolio = state.folios.find((f) => f.roomNumber === targetRoom.number && f.status === 'Abierto');
      if (!targetFolio) {
        return { ok: false, message: `No se encontró un folio abierto para la Hab. ${targetRoom.number}.` };
      }
    }

    const itemsWithSubtotal = input.items.map((i) => ({ ...i, subtotal: i.quantity * i.unitPrice }));
    const total = itemsWithSubtotal.reduce((sum, i) => sum + i.subtotal, 0);
    const prefix =
      input.source === 'Room Service' ? 'RS' : input.source === 'Minibar' ? 'MIN' : input.source === 'Servicios Complementarios' ? 'SRV' : 'POS';
    const code = `${prefix}-2611-${String(state.posOrders.length + 105).padStart(3, '0')}`;
    const chargeId = uid('chg');

    const newOrder = {
      id: uid('pos'),
      code,
      source: input.source,
      tableNumber: input.tableNumber,
      roomId: targetRoom?.id,
      roomNumber: targetRoom?.number,
      guestName: targetFolio?.guestName,
      items: itemsWithSubtotal,
      total,
      paymentMode: input.paymentMode,
      status: input.source === 'Room Service' || input.source === 'Restaurante' ? 'Preparando' : 'Cobrado',
      createdAt: nowStamp(),
      createdBy: storeData.currentUser?.name ?? 'POS',
      folioChargeId: targetFolio ? chargeId : undefined,
    };

    commit(
      (prev) => {
        let nextInventory = [...prev.inventory];
        const newMovements = [];

        for (const line of itemsWithSubtotal) {
          const product = prev.products.find((p) => p.id === line.id);
          if (!product) continue;
          if (product.stockControl === 'Directo' && product.linkedInventoryItemId) {
            nextInventory = nextInventory.map((inv) =>
              inv.id === product.linkedInventoryItemId
                ? { ...inv, stock: Math.max(0, Number((inv.stock - line.quantity).toFixed(2))) }
                : inv
            );
            const invRef = prev.inventory.find((i) => i.id === product.linkedInventoryItemId);
            if (invRef) {
              newMovements.push({
                id: uid('mov'),
                inventoryItemId: invRef.id,
                itemName: invRef.name,
                type: 'Consumo POS',
                quantity: -line.quantity,
                reference: code,
                date: nowStamp(),
                user: storeData.currentUser?.name ?? 'POS',
              });
            }
          } else {
            const recipe = prev.recipes.find((rcp) => rcp.productId === product.id);
            if (recipe) {
              for (const ing of recipe.ingredients) {
                const used = Number((ing.quantity * line.quantity).toFixed(2));
                nextInventory = nextInventory.map((inv) =>
                  inv.id === ing.inventoryItemId
                    ? { ...inv, stock: Math.max(0, Number((inv.stock - used).toFixed(2))) }
                    : inv
                );
                newMovements.push({
                  id: uid('mov'),
                  inventoryItemId: ing.inventoryItemId,
                  itemName: ing.itemName,
                  type: 'Consumo POS',
                  quantity: -used,
                  reference: code,
                  date: nowStamp(),
                  user: storeData.currentUser?.name ?? 'POS',
                });
              }
            }
          }
        }

        const chargeCategory =
          input.source === 'Room Service'
            ? 'Room Service'
            : input.source === 'Minibar'
            ? 'Minibar'
            : input.source === 'Servicios Complementarios'
            ? 'Spa / Servicios'
            : 'Restaurante';

        const nextFolios = targetFolio
          ? prev.folios.map((f) => {
              if (f.id !== targetFolio.id) return f;
              const nextCharges = [
                ...f.charges,
                {
                  id: chargeId,
                  date: nowStamp().slice(0, 10),
                  category: chargeCategory,
                  description: `${input.source} (${code}): ${itemsWithSubtotal.map((i) => `${i.quantity}x ${i.name}`).join(', ')}`,
                  amount: total,
                  sourceModule: 'M3',
                  referenceCode: code,
                },
              ];
              const totalCharges = f.totalCharges + total;
              return {
                ...f,
                charges: nextCharges,
                totalCharges,
                balance: totalCharges - f.totalPayments,
              };
            })
          : prev.folios;

        const nextCashShifts =
          input.paymentMode === 'Pago Directo'
            ? prev.cashShifts.map((cs, idx) =>
                idx === 0 && cs.status === 'Abierta'
                  ? {
                      ...cs,
                      totalInflows: cs.totalInflows + total,
                      expectedBalance: cs.expectedBalance + total,
                      movements: [
                        {
                          id: uid('cm'),
                          time: nowStamp().slice(11),
                          type: 'Ingreso',
                          method: input.paymentMethod ?? 'Efectivo',
                          concept: `Venta directa ${input.source} (${code})`,
                          amount: total,
                        },
                        ...cs.movements,
                      ],
                    }
                  : cs
              )
            : prev.cashShifts;

        return {
          ...prev,
          posOrders: [newOrder, ...prev.posOrders],
          inventory: nextInventory,
          inventoryMovements: [...newMovements, ...prev.inventoryMovements],
          folios: nextFolios,
          cashShifts: nextCashShifts,
        };
      },
      {
        module: 'm3',
        action: `Registró ${code} (S/ ${total.toFixed(2)}) · ${input.paymentMode}${targetRoom ? ` Hab. ${targetRoom.number}` : ''}`,
        entityRef: code,
      },
      {
        sourceModule: 'm3',
        targetModules: ['m4', 'dashboard'],
        title: `Consumo ${code} registrado (S/ ${total.toFixed(2)})`,
        message: targetFolio
          ? `Inventario descontado y cargo aplicado al Folio ${targetFolio.code} (Hab. ${targetRoom?.number}).`
          : 'Inventario descontado y pago directo registrado en Caja.',
        severity: 'success',
      }
    );

    erpStore.pushToast({
      title: `Orden ${code} registrada`,
      detail: targetFolio
        ? `Stock descontado y S/ ${total.toFixed(2)} cargados al Folio ${targetFolio.code}.`
        : 'Stock descontado e ingreso registrado en Caja.',
      type: 'success',
    });
    return { ok: true, message: `Orden ${code} procesada correctamente.` };
  },

  updatePOSOrderStatus(orderId, status) {
    commit(
      (prev) => ({
        ...prev,
        posOrders: prev.posOrders.map((o) => (o.id === orderId ? { ...o, status } : o)),
      }),
      { module: 'm3', action: `Actualizó estado de pedido POS a ${status}`, entityRef: orderId }
    );
    erpStore.pushToast({ title: `Pedido actualizado: ${status}`, type: 'info' });
  },

  updateTableStatus(tableId, status, roomNumber) {
    commit(
      (prev) => ({
        ...prev,
        tables: prev.tables.map((t) =>
          t.id === tableId ? { ...t, status, roomNumber: status === 'Libre' ? undefined : roomNumber ?? t.roomNumber } : t
        ),
      }),
      { module: 'm3', action: `Mesa actualizada a ${status}`, entityRef: tableId }
    );
  },

  adjustInventory(inventoryItemId, type, quantity, reference) {
    const state = storeData.state;
    if (!state) return;
    const item = state.inventory.find((i) => i.id === inventoryItemId);
    if (!item) return;
    const delta = type === 'Entrada' ? quantity : -quantity;
    commit(
      (prev) => ({
        ...prev,
        inventory: prev.inventory.map((i) =>
          i.id === inventoryItemId ? { ...i, stock: Math.max(0, Number((i.stock + delta).toFixed(2))) } : i
        ),
        inventoryMovements: [
          {
            id: uid('mov'),
            inventoryItemId,
            itemName: item.name,
            type,
            quantity: delta,
            reference,
            date: nowStamp(),
            user: storeData.currentUser?.name ?? 'Almacén',
          },
          ...prev.inventoryMovements,
        ],
      }),
      { module: 'm3', action: `Movimiento inventario (${type}): ${quantity} ${item.unit} de ${item.name}`, entityRef: item.sku }
    );
    erpStore.pushToast({ title: `Movimiento ${type} registrado`, detail: `${item.name} (${delta > 0 ? '+' : ''}${delta} ${item.unit})`, type: 'success' });
  },

  upsertInventoryItem(item) {
    const isEdit = Boolean(item.id);
    const id = item.id ?? uid('inv');
    commit(
      (prev) => ({
        ...prev,
        inventory: isEdit ? prev.inventory.map((i) => (i.id === id ? { ...item, id } : i)) : [{ ...item, id }, ...prev.inventory],
      }),
      { module: 'm3', action: isEdit ? `Editó insumo ${item.name}` : `Creó insumo ${item.name}`, entityRef: item.sku }
    );
    erpStore.pushToast({ title: isEdit ? 'Insumo actualizado' : 'Insumo registrado', detail: item.name, type: 'success' });
  },

  fulfillSupplyRequisition(reqId) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'No listo' };
    const req = state.supplyRequisitions.find((r) => r.id === reqId);
    if (!req) return { ok: false, message: 'Solicitud no encontrada' };
    const invItem = state.inventory.find((i) => i.id === req.inventoryItemId);
    if (!invItem) return { ok: false, message: 'Insumo no encontrado en almacén' };

    if (invItem.stock >= req.quantity) {
      commit(
        (prev) => ({
          ...prev,
          inventory: prev.inventory.map((i) =>
            i.id === invItem.id ? { ...i, stock: Number((i.stock - req.quantity).toFixed(2)) } : i
          ),
          inventoryMovements: [
            {
              id: uid('mov'),
              inventoryItemId: invItem.id,
              itemName: invItem.name,
              type: 'Entrega Interna',
              quantity: -req.quantity,
              reference: req.code,
              date: nowStamp(),
              user: storeData.currentUser?.name ?? 'Almacén',
            },
            ...prev.inventoryMovements,
          ],
          hkSupplies: prev.hkSupplies.map((h) =>
            h.inventoryItemId === invItem.id ? { ...h, localStock: h.localStock + req.quantity } : h
          ),
          supplyRequisitions: prev.supplyRequisitions.map((r) =>
            r.id === req.id ? { ...r, status: 'Aprobada y Entregada', resolvedAt: nowStamp() } : r
          ),
        }),
        { module: 'm3', action: `Entregó ${req.quantity} ${req.unit} de ${req.itemName} a ${req.requestedByArea}`, entityRef: req.code },
        {
          sourceModule: 'm3',
          targetModules: ['m2', 'dashboard'],
          title: `Entrega confirmada · ${req.code}`,
          message: `Almacén entregó ${req.quantity} ${req.unit} de ${req.itemName} a ${req.requestedByArea}. Existencias actualizadas.`,
          severity: 'success',
        }
      );
      erpStore.pushToast({ title: `Entrega completada (${req.code})`, detail: `Stock local de ${req.requestedByArea} incrementado.`, type: 'success' });
      return { ok: true, message: 'Insumos entregados y stock actualizado en ambos módulos.' };
    }

    const supplier = state.suppliers.find((s) => s.id === invItem.supplierId) ?? state.suppliers[0];
    const orderQty = Math.max(req.quantity * 2, invItem.minStock);
    const poId = uid('po');
    const poCode = `OC-2026-${String(state.purchaseOrders.length + 113).padStart(3, '0')}`;
    const po = {
      id: poId,
      code: poCode,
      supplierId: supplier.id,
      supplierName: supplier.name,
      items: [{ inventoryItemId: invItem.id, itemName: invItem.name, quantity: orderQty, unitCost: invItem.unitCost }],
      total: orderQty * invItem.unitCost,
      status: 'Emitida',
      linkedRequisitionId: req.id,
      createdAt: nowStamp(),
    };
    commit(
      (prev) => ({
        ...prev,
        purchaseOrders: [po, ...prev.purchaseOrders],
        supplyRequisitions: prev.supplyRequisitions.map((r) =>
          r.id === req.id ? { ...r, status: 'En Compra', linkedPurchaseOrderId: poId } : r
        ),
      }),
      { module: 'm3', action: `Stock insuficiente para ${req.code}; emitió orden de compra ${poCode}`, entityRef: poCode },
      {
        sourceModule: 'm3',
        targetModules: ['m2', 'm4'],
        title: `Orden de compra ${poCode} generada`,
        message: `Stock insuficiente (${invItem.stock} ${invItem.unit}). Se ordenaron ${orderQty} ${invItem.unit} a ${supplier.name}.`,
        severity: 'warning',
      }
    );
    erpStore.pushToast({ title: `Stock insuficiente — OC ${poCode} emitida`, detail: `Al recibir la compra se abastecerá automáticamente a ${req.requestedByArea}.`, type: 'warning' });
    return { ok: true, message: `Stock insuficiente. Se generó automáticamente la Orden de Compra ${poCode}.` };
  },

  upsertSupplier(supplier) {
    const isEdit = Boolean(supplier.id);
    const id = supplier.id ?? uid('sup');
    commit(
      (prev) => ({
        ...prev,
        suppliers: isEdit ? prev.suppliers.map((s) => (s.id === id ? { ...supplier, id } : s)) : [{ ...supplier, id }, ...prev.suppliers],
      }),
      { module: 'm3', action: isEdit ? `Editó proveedor ${supplier.name}` : `Registró proveedor ${supplier.name}`, entityRef: supplier.ruc }
    );
    erpStore.pushToast({ title: isEdit ? 'Proveedor actualizado' : 'Proveedor registrado', detail: supplier.name, type: 'success' });
  },

  createPurchaseOrder(input) {
    const state = storeData.state;
    if (!state) return;
    const sup = state.suppliers.find((s) => s.id === input.supplierId);
    if (!sup) return;
    const code = `OC-2026-${String(state.purchaseOrders.length + 113).padStart(3, '0')}`;
    const total = input.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const po = {
      id: uid('po'),
      code,
      supplierId: sup.id,
      supplierName: sup.name,
      items: input.items,
      total,
      status: 'Emitida',
      linkedRequisitionId: input.linkedRequisitionId,
      createdAt: nowStamp(),
    };
    commit(
      (prev) => ({ ...prev, purchaseOrders: [po, ...prev.purchaseOrders] }),
      { module: 'm3', action: `Emitió orden de compra ${code} a ${sup.name} (S/ ${total.toFixed(2)})`, entityRef: code }
    );
    erpStore.pushToast({ title: `Orden de compra ${code} emitida`, detail: `${sup.name} · S/ ${total.toFixed(2)}`, type: 'success' });
  },

  receivePurchaseOrder(poId) {
    const state = storeData.state;
    if (!state) return;
    const po = state.purchaseOrders.find((p) => p.id === poId);
    if (!po || po.status === 'Recibida') return;

    commit(
      (prev) => {
        let nextInventory = [...prev.inventory];
        const newMoves = [];
        for (const item of po.items) {
          nextInventory = nextInventory.map((inv) =>
            inv.id === item.inventoryItemId ? { ...inv, stock: Number((inv.stock + item.quantity).toFixed(2)) } : inv
          );
          newMoves.push({
            id: uid('mov'),
            inventoryItemId: item.inventoryItemId,
            itemName: item.itemName,
            type: 'Entrada',
            quantity: item.quantity,
            reference: po.code,
            date: nowStamp(),
            user: storeData.currentUser?.name ?? 'Almacén',
          });
        }

        const newExpense = {
          id: uid('exp'),
          date: nowStamp().slice(0, 10),
          category: 'Compras Insumos',
          costCenter: 'Alimentos y Bebidas',
          supplier: po.supplierName,
          description: `Recepción Orden de Compra ${po.code}`,
          amount: po.total,
          status: 'Pendiente',
          documentRef: po.code,
        };

        const linkedReq = po.linkedRequisitionId
          ? prev.supplyRequisitions.find((r) => r.id === po.linkedRequisitionId)
          : undefined;

        const nextRequisitions = linkedReq
          ? prev.supplyRequisitions.map((r) =>
              r.id === linkedReq.id ? { ...r, status: 'Recibida', resolvedAt: nowStamp() } : r
            )
          : prev.supplyRequisitions;

        return {
          ...prev,
          purchaseOrders: prev.purchaseOrders.map((p) => (p.id === poId ? { ...p, status: 'Recibida', receivedAt: nowStamp() } : p)),
          inventory: nextInventory,
          inventoryMovements: [...newMoves, ...prev.inventoryMovements],
          expenses: [newExpense, ...prev.expenses],
          supplyRequisitions: nextRequisitions,
        };
      },
      { module: 'm3', action: `Recibió compra ${po.code} — Inventario y Finanzas actualizados`, entityRef: po.code },
      {
        sourceModule: 'm3',
        targetModules: ['m2', 'm4'],
        title: `Compra ${po.code} ingresada a Almacén`,
        message: `Stock actualizado y egreso de S/ ${po.total.toFixed(2)} registrado en Finanzas.`,
        severity: 'success',
      }
    );
    erpStore.pushToast({ title: `Compra ${po.code} recibida`, detail: 'Stock incrementado y gasto registrado en Finanzas.', type: 'success' });
  },

  // ============================================================
  // MODULE 04 ACTIONS (Facturación y Finanzas)
  // ============================================================
  registerFolioPayment(folioId, amount, method, reference) {
    const state = storeData.state;
    if (!state || amount <= 0) return;
    const folio = state.folios.find((f) => f.id === folioId);
    if (!folio) return;
    commit(
      (prev) => {
        const nextFolios = prev.folios.map((f) => {
          if (f.id !== folioId) return f;
          const totalPayments = Number((f.totalPayments + amount).toFixed(2));
          const balance = Math.max(0, Number((f.totalCharges - totalPayments).toFixed(2)));
          return {
            ...f,
            payments: [
              ...f.payments,
              { id: uid('pay'), date: nowStamp().slice(0, 10), amount, method, reference: reference || `PAG-${Date.now().toString().slice(-4)}`, receivedBy: storeData.currentUser?.name ?? 'Caja' },
            ],
            totalPayments,
            balance,
            status: balance <= 0.01 ? 'Liquidado' : f.status,
          };
        });
        const nextShifts = prev.cashShifts.map((cs, idx) =>
          idx === 0 && cs.status === 'Abierta'
            ? {
                ...cs,
                totalInflows: cs.totalInflows + amount,
                expectedBalance: cs.expectedBalance + amount,
                movements: [
                  { id: uid('cm'), time: nowStamp().slice(11), type: 'Ingreso', method, concept: `Pago Folio ${folio.code} (${folio.guestName})`, amount },
                  ...cs.movements,
                ],
              }
            : cs
        );
        return { ...prev, folios: nextFolios, cashShifts: nextShifts };
      },
      { module: 'm4', action: `Registró pago S/ ${amount.toFixed(2)} en Folio ${folio.code} (${method})`, entityRef: folio.code },
      {
        sourceModule: 'm4',
        targetModules: ['m1', 'dashboard'],
        title: `Pago recibido · ${folio.code}`,
        message: `S/ ${amount.toFixed(2)} vía ${method}. Saldo actualizado y registrado en Caja.`,
        severity: 'success',
      }
    );
    erpStore.pushToast({ title: `Pago S/ ${amount.toFixed(2)} registrado`, detail: `Folio ${folio.code} y Caja actualizados.`, type: 'success' });
  },

  addManualFolioCharge(folioId, description, category, amount) {
    if (amount <= 0) return;
    commit(
      (prev) => ({
        ...prev,
        folios: prev.folios.map((f) => {
          if (f.id !== folioId) return f;
          const totalCharges = f.totalCharges + amount;
          return {
            ...f,
            charges: [...f.charges, { id: uid('chg'), date: nowStamp().slice(0, 10), category, description, amount, sourceModule: 'M4' }],
            totalCharges,
            balance: totalCharges - f.totalPayments,
            status: 'Abierto',
          };
        }),
      }),
      { module: 'm4', action: `Agregó cargo manual S/ ${amount.toFixed(2)} a folio`, entityRef: folioId }
    );
    erpStore.pushToast({ title: 'Cargo agregado al folio', type: 'info' });
  },

  issueInvoice(input) {
    const state = storeData.state;
    if (!state) return;
    const total = input.items.reduce((s, i) => s + i.amount, 0);
    const subtotal = Number((total / 1.18).toFixed(2));
    const igv = Number((total - subtotal).toFixed(2));
    const series = input.type === 'Factura' ? 'F001' : input.type === 'Boleta' ? 'B001' : 'FC01';
    const number = String(1483 + state.invoices.length).padStart(8, '0');
    commit(
      (prev) => ({
        ...prev,
        invoices: [
          {
            id: uid('doc'),
            type: input.type,
            series,
            number,
            folioId: input.folioId,
            customerName: input.customerName,
            customerDoc: input.customerDoc,
            subtotal,
            igv,
            total,
            status: 'Emitida',
            sunatStatus: 'Comprobante XML UBL 2.1 generado',
            issuedAt: nowStamp(),
            issuedBy: storeData.currentUser?.name ?? 'Facturación',
            items: input.items,
          },
          ...prev.invoices,
        ],
      }),
      { module: 'm4', action: `Emitió ${input.type} ${series}-${number} (S/ ${total.toFixed(2)})`, entityRef: `${series}-${number}` }
    );
    erpStore.pushToast({ title: `${input.type} ${series}-${number} generada`, detail: 'Documento registrado y listo para previsualización XML UBL 2.1.', type: 'success' });
  },

  voidInvoice(invoiceId) {
    commit(
      (prev) => ({
        ...prev,
        invoices: prev.invoices.map((inv) => (inv.id === invoiceId ? { ...inv, status: 'Anulada' } : inv)),
      }),
      { module: 'm4', action: 'Anuló comprobante interno', entityRef: invoiceId }
    );
    erpStore.pushToast({ title: 'Comprobante anulado', type: 'warning' });
  },

  registerReceivablePayment(arId, amount, note) {
    if (amount <= 0) return;
    commit(
      (prev) => ({
        ...prev,
        receivables: prev.receivables.map((ar) => {
          if (ar.id !== arId) return ar;
          const paidAmount = Math.min(ar.originalAmount, ar.paidAmount + amount);
          const pendingAmount = Math.max(0, Number((ar.originalAmount - paidAmount).toFixed(2)));
          return {
            ...ar,
            paidAmount,
            pendingAmount,
            status: pendingAmount <= 0.01 ? 'Cobrada' : ar.status,
            followUpNote: note || ar.followUpNote,
          };
        }),
      }),
      { module: 'm4', action: `Registró cobranza CxC por S/ ${amount.toFixed(2)}`, entityRef: arId }
    );
    erpStore.pushToast({ title: 'Cobro registrado en Cuentas por Cobrar', type: 'success' });
  },

  openCashShift(openingBalance) {
    commit(
      (prev) => ({
        ...prev,
        cashShifts: [
          {
            id: uid('csh'),
            cashier: storeData.currentUser?.name ?? 'Cajero',
            openedAt: nowStamp(),
            openingBalance,
            totalInflows: 0,
            totalOutflows: 0,
            expectedBalance: openingBalance,
            status: 'Abierta',
            movements: [],
          },
          ...prev.cashShifts,
        ],
      }),
      { module: 'm4', action: `Abrió turno de caja con fondo S/ ${openingBalance.toFixed(2)}`, entityRef: 'Caja' }
    );
    erpStore.pushToast({ title: 'Turno de caja abierto', detail: `Saldo inicial: S/ ${openingBalance.toFixed(2)}`, type: 'success' });
  },

  addCashMovement(type, method, concept, amount) {
    if (amount <= 0) return;
    commit(
      (prev) => ({
        ...prev,
        cashShifts: prev.cashShifts.map((cs, idx) =>
          idx === 0 && cs.status === 'Abierta'
            ? {
                ...cs,
                totalInflows: type === 'Ingreso' ? cs.totalInflows + amount : cs.totalInflows,
                totalOutflows: type === 'Egreso' ? cs.totalOutflows + amount : cs.totalOutflows,
                expectedBalance: type === 'Ingreso' ? cs.expectedBalance + amount : cs.expectedBalance - amount,
                movements: [{ id: uid('cm'), time: nowStamp().slice(11), type, method, concept, amount }, ...cs.movements],
              }
            : cs
        ),
      }),
      { module: 'm4', action: `Movimiento caja (${type}): ${concept} S/ ${amount.toFixed(2)}`, entityRef: 'Caja' }
    );
    erpStore.pushToast({ title: `${type} registrado en Caja`, type: 'info' });
  },

  closeCashShift(countedBalance) {
    commit(
      (prev) => ({
        ...prev,
        cashShifts: prev.cashShifts.map((cs, idx) =>
          idx === 0 && cs.status === 'Abierta'
            ? { ...cs, status: 'Cerrada', closedAt: nowStamp(), countedBalance }
            : cs
        ),
      }),
      { module: 'm4', action: `Cerró turno de caja (Arqueo S/ ${countedBalance.toFixed(2)})`, entityRef: 'Caja' }
    );
    erpStore.pushToast({ title: 'Cierre de caja completado', type: 'success' });
  },

  addOperatingExpense(expense) {
    commit(
      (prev) => ({
        ...prev,
        expenses: [{ ...expense, id: uid('exp') }, ...prev.expenses],
      }),
      { module: 'm4', action: `Registró gasto ${expense.category}: S/ ${expense.amount.toFixed(2)}`, entityRef: expense.documentRef }
    );
    erpStore.pushToast({ title: 'Gasto operativo registrado', detail: `${expense.category} · S/ ${expense.amount.toFixed(2)}`, type: 'success' });
  },

  // ============================================================
  // MODULE 05 ACTIONS (CRM y Atención al Huésped)
  // ============================================================
  redeemLoyaltyPoints(guestId, points, rewardLabel) {
    const state = storeData.state;
    if (!state) return { ok: false, message: 'No listo' };
    const guest = state.guests.find((g) => g.id === guestId);
    if (!guest) return { ok: false, message: 'Huésped no encontrado' };
    if (guest.loyaltyPoints < points) return { ok: false, message: 'Puntos insuficientes para el canje.' };
    commit(
      (prev) => ({
        ...prev,
        guests: prev.guests.map((g) => (g.id === guestId ? { ...g, loyaltyPoints: g.loyaltyPoints - points } : g)),
      }),
      { module: 'm5', action: `Canjeó ${points} pts por "${rewardLabel}" para ${guest.fullName}`, entityRef: guest.fullName }
    );
    erpStore.pushToast({ title: 'Beneficio canjeado', detail: `${guest.fullName} · -${points} puntos`, type: 'success' });
    return { ok: true, message: 'Canje aplicado exitosamente.' };
  },

  createCampaign(campaign) {
    const state = storeData.state;
    if (!state) return;
    const targetAudience =
      campaign.segment === 'Todos'
        ? state.guests.filter((g) => g.marketingOptIn).length
        : state.guests.filter((g) => g.segment === campaign.segment && g.marketingOptIn).length;
    commit(
      (prev) => ({
        ...prev,
        campaigns: [
          {
            ...campaign,
            id: uid('camp'),
            sentCount: Math.max(targetAudience * 12, 24),
            openRate: campaign.status === 'Activa' ? 48 : 0,
            conversionCount: campaign.status === 'Activa' ? 3 : 0,
            createdAt: nowStamp().slice(0, 10),
          },
          ...prev.campaigns,
        ],
      }),
      { module: 'm5', action: `Creó campaña "${campaign.name}" para segmento ${campaign.segment} (opt-in verificado)`, entityRef: campaign.name, privacyImpact: true }
    );
    erpStore.pushToast({ title: 'Campaña creada', detail: 'Solo incluye huéspedes con consentimiento de marketing vigente.', type: 'success' });
  },

  toggleCampaignStatus(id, status) {
    commit(
      (prev) => ({
        ...prev,
        campaigns: prev.campaigns.map((c) => (c.id === id ? { ...c, status } : c)),
      }),
      { module: 'm5', action: `Actualizó estado de campaña a ${status}`, entityRef: id }
    );
  },

  createComplaint(input) {
    const state = storeData.state;
    if (!state) return;
    const guest = state.guests.find((g) => g.id === input.guestId);
    if (!guest) return;
    const cmpId = uid('cmp');
    const cmpCode = `REC-2026-${String(state.complaints.length + 22).padStart(3, '0')}`;
    const room = input.roomNumber ? state.rooms.find((r) => r.number === input.roomNumber) : undefined;
    const shouldEscalate = input.escalateToMaintenance || input.category === 'Habitación / Infraestructura';
    const incId = shouldEscalate ? uid('inc') : undefined;
    const incCode = shouldEscalate ? `INC-2026-${String(state.incidents.length + 16).padStart(3, '0')}` : undefined;
    const maintStaff = state.staff.find((s) => s.area === 'Mantenimiento' && s.available);

    const sentiment = input.severity === 'Crítica' || input.severity === 'Alta' ? 'Muy Negativo' : 'Negativo';

    const newComplaint = {
      id: cmpId,
      code: cmpCode,
      guestId: guest.id,
      guestName: guest.fullName,
      roomNumber: input.roomNumber,
      category: input.category,
      severity: input.severity,
      sentiment,
      description: input.description,
      assignedTo: storeData.currentUser?.name ?? 'Sofía Herrera',
      status: shouldEscalate ? 'Escalado a Mantenimiento' : 'Abierto',
      linkedIncidentId: incId,
      createdAt: nowStamp(),
      history: [
        { timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'CRM', note: 'Reclamo registrado.' },
        ...(shouldEscalate
          ? [{ timestamp: nowStamp(), user: 'Sistema SGH-ERP', note: `Generada incidencia ${incCode} en Mantenimiento.` }]
          : []),
      ],
    };

    commit(
      (prev) => ({
        ...prev,
        complaints: [newComplaint, ...prev.complaints],
        incidents:
          shouldEscalate && incId && incCode
            ? [
                {
                  id: incId,
                  code: incCode,
                  roomId: room?.id,
                  location: input.roomNumber ? `Habitación ${input.roomNumber}` : 'Instalaciones Hotel',
                  category: 'Equipos',
                  description: `[Reclamo ${cmpCode} · ${guest.fullName}] ${input.description}`,
                  priority: input.severity === 'Crítica' ? 'Urgente' : input.severity === 'Alta' ? 'Alta' : 'Media',
                  status: 'Asignada',
                  assignedStaffId: maintStaff?.id,
                  linkedComplaintId: cmpId,
                  reportedBy: storeData.currentUser?.name ?? 'CRM',
                  createdAt: nowStamp(),
                },
                ...prev.incidents,
              ]
            : prev.incidents,
      }),
      { module: 'm5', action: `Registró reclamo ${cmpCode}${incCode ? ` y generó incidencia ${incCode}` : ''}`, entityRef: cmpCode },
      {
        sourceModule: 'm5',
        targetModules: shouldEscalate ? ['m2', 'dashboard'] : ['dashboard'],
        title: shouldEscalate ? `Reclamo ${cmpCode} escalado a Mantenimiento` : `Nuevo reclamo ${cmpCode}`,
        message: shouldEscalate
          ? `Incidencia ${incCode} creada automáticamente para Hab. ${input.roomNumber || 'N/A'}.`
          : `${guest.fullName}: ${input.description}`,
        severity: 'error',
      }
    );

    erpStore.pushToast({
      title: `Reclamo ${cmpCode} registrado`,
      detail: shouldEscalate ? `Incidencia ${incCode} enviada a Mantenimiento.` : 'Asignado al equipo CRM.',
      type: shouldEscalate ? 'warning' : 'info',
    });
  },

  updateComplaintStatus(complaintId, status, note) {
    commit(
      (prev) => ({
        ...prev,
        complaints: prev.complaints.map((c) =>
          c.id === complaintId
            ? {
                ...c,
                status,
                history: [...c.history, { timestamp: nowStamp(), user: storeData.currentUser?.name ?? 'CRM', note: note || `Estado actualizado a ${status}` }],
              }
            : c
        ),
      }),
      { module: 'm5', action: `Actualizó reclamo a ${status}`, entityRef: complaintId }
    );
    erpStore.pushToast({ title: `Reclamo actualizado (${status})`, type: 'success' });
  },

  createGuestRequest(input) {
    const state = storeData.state;
    if (!state) return;
    const guest = state.guests.find((g) => g.id === input.guestId);
    if (!guest) return;
    const code = `REQ-${503 + state.guestRequests.length}`;
    const targetMod =
      input.targetArea === 'Recepción'
        ? 'm1'
        : input.targetArea === 'Housekeeping' || input.targetArea === 'Mantenimiento'
        ? 'm2'
        : input.targetArea === 'Restaurante/POS'
        ? 'm3'
        : 'm5';
    commit(
      (prev) => ({
        ...prev,
        guestRequests: [
          {
            id: uid('greq'),
            code,
            guestId: guest.id,
            guestName: guest.fullName,
            roomNumber: input.roomNumber,
            type: input.type,
            targetArea: input.targetArea,
            description: input.description,
            status: 'DERIVADA',
            source: input.source,
            createdAt: nowStamp(),
          },
          ...prev.guestRequests,
        ],
      }),
      { module: 'm5', action: `Registró solicitud ${code} (${input.type}) derivada a ${input.targetArea}`, entityRef: code },
      {
        sourceModule: 'm5',
        targetModules: [targetMod],
        title: `Solicitud de huésped ${code} → ${input.targetArea}`,
        message: `Hab. ${input.roomNumber} (${guest.fullName}): ${input.description}`,
        severity: 'info',
      }
    );
    erpStore.pushToast({ title: `Solicitud ${code} derivada a ${input.targetArea}`, type: 'success' });
  },

  updateGuestRequestStatus(reqId, status) {
    const normalized = String(status || '').toUpperCase() === 'ATENDIDA' ? 'ATENDIDA' : status;
    commit(
      (prev) => ({
        ...prev,
        guestRequests: prev.guestRequests.map((r) => (r.id === reqId ? { ...r, status: normalized } : r)),
      }),
      { module: 'm5', action: `Actualizó solicitud a ${normalized}`, entityRef: reqId }
    );
    erpStore.pushToast({ title: `Solicitud marcada como ${normalized}`, type: 'success' });
  },

  addSurveyResponse(survey) {
    commit(
      (prev) => ({
        ...prev,
        surveys: [{ ...survey, id: uid('srvr'), date: nowStamp().slice(0, 10) }, ...prev.surveys],
      }),
      { module: 'm5', action: `Registró encuesta de satisfacción (${survey.overallScore}/5)`, entityRef: survey.guestName }
    );
    erpStore.pushToast({ title: 'Encuesta registrada', detail: 'Satisfacción global actualizada en Dashboard.', type: 'success' });
  },

  replyToReview(reviewId, reply) {
    commit(
      (prev) => ({
        ...prev,
        reviews: prev.reviews.map((r) => (r.id === reviewId ? { ...r, hotelReply: reply } : r)),
      }),
      { module: 'm5', action: 'Publicó respuesta oficial a reseña', entityRef: reviewId }
    );
    erpStore.pushToast({ title: 'Respuesta guardada', type: 'success' });
  },
};
