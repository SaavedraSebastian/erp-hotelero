import type { NextFunction, Request, Response } from 'express';
import { parsePagination } from '../../shared/pagination/index.ts';
import * as service from './service.ts';

export async function listPerfiles(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getPerfilesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function getPerfilDetalle(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.getPerfilDetalleService(req.authContext!, Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function addPreferencia(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.addPreferenciaService(req.authContext!, Number(req.params.id), req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function listSegmentos(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getSegmentosService(req.authContext!));
  } catch (err) {
    next(err);
  }
}

export async function getFidelizacionPerfil(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.getFidelizacionPerfilService(req.authContext!, Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function registrarMovimientoPuntos(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.registrarMovimientoPuntosService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listReclamos(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getReclamosService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createReclamo(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createReclamoService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function avanzarReclamo(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.avanzarReclamoService(req.authContext!, Number(req.params.id), req.body);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function solicitarCompensacion(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.solicitarCompensacionService(req.authContext!, Number(req.params.id), req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function decidirCompensacion(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.decidirCompensacionService(req.authContext!, Number(req.params.id), req.body);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function listCampanas(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getCampanasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createCampana(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createCampanaService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function cambiarEstadoCampana(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.cambiarEstadoCampanaService(
      req.authContext!,
      Number(req.params.id),
      req.body.estado
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function listOpiniones(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getOpinionesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createOpinion(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createOpinionService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function responderOpinion(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.responderOpinionService(
      req.authContext!,
      Number(req.params.id),
      req.body.respuestaHotel
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function listSolicitudes(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getSolicitudesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createSolicitud(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createSolicitudService(req.authContext!, req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function updateSolicitudEstado(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await service.updateSolicitudEstadoService(
      req.authContext!,
      Number(req.params.id),
      req.body.estado,
      req.body.notasResolucion
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}
