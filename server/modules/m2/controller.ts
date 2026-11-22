import type { NextFunction, Request, Response } from 'express';
import { parsePagination } from '../../shared/pagination/index.ts';
import * as service from './service.ts';

export async function listEstadosHabitacion(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.getEstadosHabitacionService(req.authContext!) });
  } catch (err) {
    next(err);
  }
}

export async function cambiarEstadoHabitacion(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cambiarEstadoHabitacionService(req.authContext!, String(req.params.id), req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listOrdenesLimpieza(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getOrdenesLimpiezaService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createOrdenLimpieza(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createOrdenLimpiezaService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function asignarOrdenLimpieza(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.asignarOrdenLimpiezaService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function iniciarOrdenLimpieza(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.avanzarOrdenLimpiezaService(req.authContext!, String(req.params.id), 'iniciar');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function finalizarOrdenLimpieza(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.avanzarOrdenLimpiezaService(req.authContext!, String(req.params.id), 'finalizar');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function registrarInspeccion(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.registrarInspeccionService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listIncidencias(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getIncidenciasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createIncidencia(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createIncidenciaService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listOrdenesTrabajo(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getOrdenesTrabajoService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createOrdenTrabajo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createOrdenTrabajoService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function ponerOtEnEspera(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.ponerOtEnEsperaService(req.authContext!, String(req.params.id), req.body.motivo_espera);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function cerrarOrdenTrabajo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cerrarOrdenTrabajoService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listInsumos(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getInsumosService(req.authContext!));
  } catch (err) {
    next(err);
  }
}

export async function registrarMovimientoInsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.registrarMovimientoInsumoService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}
