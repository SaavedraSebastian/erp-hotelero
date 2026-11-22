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

export async function listInventario(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getInventarioService(req.authContext!, params));
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
