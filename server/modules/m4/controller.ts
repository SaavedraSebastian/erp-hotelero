import type { NextFunction, Request, Response } from 'express';
import { parsePagination } from '../../shared/pagination/index.ts';
import * as service from './service.ts';

export async function listCuentas(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getCuentasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function getCuentaDetalle(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getCuentaDetalleService(req.authContext!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function agregarConsumoCuenta(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.agregarConsumoCuentaService(req.authContext!, String(req.params.id), req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function transferirConsumos(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.transferirConsumosService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listComprobantes(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getComprobantesService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function emitirComprobante(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.emitirComprobanteService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listTurnosCaja(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getTurnosCajaService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function abrirTurnoCaja(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.abrirTurnoCajaService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function cerrarTurnoCaja(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.cerrarTurnoCajaService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function registrarCobro(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.registrarCobroService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listGastos(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getGastosService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function createGasto(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createGastoService(req.authContext!, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function aprobarGasto(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.decidirGastoService(req.authContext!, String(req.params.id), 'APROBADO');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function rechazarGasto(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.decidirGastoService(req.authContext!, String(req.params.id), 'RECHAZADO');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listCuentasPorCobrar(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getCuentasPorCobrarService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function listAlertasFinancieras(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    res.json(await service.getAlertasFinancierasService(req.authContext!, params));
  } catch (err) {
    next(err);
  }
}

export async function decidirAlertaFinanciera(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.decidirAlertaFinancieraService(req.authContext!, String(req.params.id), req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
