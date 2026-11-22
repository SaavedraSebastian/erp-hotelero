import type { NextFunction, Request, Response } from 'express';
import { parsePagination } from '../../shared/pagination/index.ts';
import * as service from './service.ts';

export async function listHabitaciones(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getHabitacionesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function listHuespedes(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getHuespedesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createHuesped(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createHuespedService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function updateHuesped(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.updateHuespedService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function listTarifas(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const soloVigentes = q.vigentes === 'true' || q.vigentes === '1';
    // Con `page` se devuelve paginado (mantenedor); sin él, el conjunto de tarifas usadas para reservar.
    if (q.page !== undefined) {
      res.json(await service.getTarifasPaginadoService(req.authContext!, parsePagination(q), soloVigentes));
      return;
    }
    res.json(await service.getTarifasService(req.authContext!, { soloVigentes }));
  } catch (err) {
    next(err);
  }
}

export async function listReservas(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getReservasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createReserva(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createReservaService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function cancelarReserva(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.updateReservaEstadoService(
      req.authContext!,
      String(req.params.id),
      'CANCELADA',
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function marcarNoShowReserva(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.updateReservaEstadoService(
      req.authContext!,
      String(req.params.id),
      'NO_SHOW',
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function registrarCheckIn(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.performCheckInService(req.authContext!, String(req.params.id), req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function registrarCheckOut(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.performCheckOutService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listListaEspera(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getListaEsperaService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createListaEspera(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createListaEsperaService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}
