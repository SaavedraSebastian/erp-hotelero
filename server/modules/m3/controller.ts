import type { NextFunction, Request, Response } from 'express';
import { parsePagination } from '../../shared/pagination/index.ts';
import * as service from './service.ts';

export async function listCatalogo(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getCatalogoService(req.authContext!));
  } catch (err) {
    next(err);
  }
}

export async function listHistorialPrecios(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getHistorialPreciosService(req.authContext!, String(req.params.id), params));
  } catch (err) {
    next(err);
  }
}

export async function actualizarPrecioItem(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.actualizarPrecioItemService(
      req.authContext!,
      String(req.params.id),
      req.body.precio_nuevo,
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listComandas(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getComandasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createComandaService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function agregarItemComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.agregarItemComandaService(req.authContext!, String(req.params.id), req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function actualizarItemComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.actualizarItemComandaService(
      req.authContext!,
      String(req.params.id),
      String(req.params.itemId),
      req.body
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function iniciarPreparacionComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cambiarEstadoComandaService(req.authContext!, String(req.params.id), 'en preparación');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function marcarListaComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cambiarEstadoComandaService(req.authContext!, String(req.params.id), 'lista');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function entregarComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.entregarComandaYCrearConsumoService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function cancelarComanda(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cambiarEstadoComandaService(
      req.authContext!,
      String(req.params.id),
      'cancelada',
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listConsumos(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getConsumosService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createConsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createConsumoService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function actualizarConsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.actualizarConsumoService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function confirmarConsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.confirmarConsumoService(req.authContext!, String(req.params.id));
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function descartarConsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.descartarOAnularConsumoService(
      req.authContext!,
      String(req.params.id),
      'descartar',
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function anularConsumo(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.descartarOAnularConsumoService(
      req.authContext!,
      String(req.params.id),
      'anular',
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listSolicitudesServicio(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getSolicitudesServicioService(req.authContext!, params));
  } catch (err) { next(err); }
}

export async function createSolicitudServicio(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ data: await service.createSolicitudServicioService(req.authContext!, req.body) });
  } catch (err) { next(err); }
}

export async function actualizarSolicitudServicio(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.actualizarSolicitudServicioService(req.authContext!, String(req.params.id), req.body) });
  } catch (err) { next(err); }
}

export async function iniciarSolicitudServicio(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.iniciarSolicitudServicioService(req.authContext!, String(req.params.id)) });
  } catch (err) { next(err); }
}

export async function completarSolicitudServicio(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.completarSolicitudServicioService(req.authContext!, String(req.params.id), req.body) });
  } catch (err) { next(err); }
}

export async function cancelarSolicitudServicio(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.cancelarSolicitudServicioService(req.authContext!, String(req.params.id), req.body.motivo) });
  } catch (err) { next(err); }
}

export async function listInventario(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getInventarioService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function listKardex(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getKardexService(req.authContext!, String(req.params.id), params));
  } catch (err) {
    next(err);
  }
}

export async function listKardexGeneral(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getKardexService(req.authContext!, null, params));
  } catch (err) {
    next(err);
  }
}

export async function listLotes(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getLotesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function listEnviosExternos(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getEnviosExternosService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function procesarEnviosExternos(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.procesarEnviosExternosService(req.authContext!) });
  } catch (err) {
    next(err);
  }
}

export async function reporteOperacional(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await service.getReporteOperacionalService(
      req.authContext!,
      req.query.fromDate ? String(req.query.fromDate) : undefined,
      req.query.toDate ? String(req.query.toDate) : undefined
    ) });
  } catch (err) {
    next(err);
  }
}

export async function registrarMovimientoInventario(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.registrarMovimientoInventarioService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function anularMovimientoInventario(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.anularMovimientoInventarioService(
      req.authContext!,
      String(req.params.id),
      req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listOrdenesCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getOrdenesCompraService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createOrdenCompraService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function actualizarOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.actualizarOrdenCompraService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function cancelarOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cancelarOrdenCompraService(
      req.authContext!, String(req.params.id), req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function aprobarOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.decidirOrdenCompraService(
      req.authContext!,
      String(req.params.id),
      'aprobada',
      req.body.motivo_decision
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function rechazarOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.decidirOrdenCompraService(
      req.authContext!,
      String(req.params.id),
      'rechazada',
      req.body.motivo_decision
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function enviarOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.enviarOrdenCompraService(
      req.authContext!,
      String(req.params.id),
      req.body.medio_envio
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function recibirOrdenCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.recibirOrdenCompraService(req.authContext!, String(req.params.id), req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function anularRecepcionCompra(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.anularRecepcionCompraService(
      req.authContext!, String(req.params.id), String(req.params.recepcionId), req.body.motivo
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
