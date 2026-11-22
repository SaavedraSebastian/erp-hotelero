import type { NextFunction, Request, Response } from 'express';
import * as service from './service.ts';

export async function generarNoShow(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.generarPrediccionNoShowService(req.authContext!, req.body.idReserva) });
  } catch (err) {
    next(err);
  }
}

export async function sugerirTarifa(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.sugerirTarifaService(req.authContext!, req.body.idReserva) });
  } catch (err) {
    next(err);
  }
}

export async function proponerHousekeeping(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.proponerHousekeepingService(req.authContext!, req.body) });
  } catch (err) {
    next(err);
  }
}

export async function evaluarMantenimiento(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.evaluarMantenimientoService(req.authContext!, req.body.idActivos) });
  } catch (err) {
    next(err);
  }
}

export async function pronosticarDemanda(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.pronosticarDemandaService(req.authContext!, req.body) });
  } catch (err) {
    next(err);
  }
}

export async function evaluarFinanzas(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.evaluarFinanzasService(req.authContext!, req.body) });
  } catch (err) {
    next(err);
  }
}

export async function consultarAsistente(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.consultarAsistenteService(req.authContext!, req.body) });
  } catch (err) {
    next(err);
  }
}
