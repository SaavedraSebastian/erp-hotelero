import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { DomainRuleError } from '../../shared/errors/app-error.ts';

export interface MovimientoStock {
  id_articulo: string;
  tipo_movimiento: string;
  signo: 'entrada' | 'salida';
  cantidad: number;
  motivo: string;
  id_origen: string;
  modulo_origen: 'Almacén' | 'Compras' | 'Housekeeping y Mantenimiento';
  costo_unitario?: string | null;
  id_almacen?: string | null;
  /** Entrada: lote al que se suma (si se omite se crea uno nuevo). Salida: lote del que se descuenta. */
  id_lote?: string | null;
  /** Entrada con lote nuevo: vencimiento. */
  fecha_vencimiento?: string | null;
  /** Salida: descuenta lo que haya en lugar de fallar por stock insuficiente (p. ej. ventas ya realizadas). */
  permitirParcial?: boolean;
}

/**
 * El stock de un artículo es la suma de `lote_articulo.cantidad_disponible`; el movimiento es solo el kardex.
 * Esta función mantiene ambos consistentes dentro de la transacción del llamador:
 *  - entrada: suma al lote indicado o crea un lote nuevo, y registra el movimiento;
 *  - salida: descuenta de los lotes por vencimiento más próximo (FIFO) y registra un movimiento por lote usado.
 */
export async function aplicarMovimientoStock(
  client: PoolClient,
  m: MovimientoStock
): Promise<{ saldo_posterior: string; movimientos: number; cantidad_aplicada: number }> {
  if (!(m.cantidad > 0)) throw new DomainRuleError('La cantidad debe ser mayor a cero.');

  const art = await client.query(`SELECT 1 FROM g3_servicios.articulo_almacen WHERE id_articulo = $1 FOR UPDATE`, [m.id_articulo]);
  if (!art.rows[0]) throw new DomainRuleError('El artículo de almacén no existe.');

  const stockOf = async () => {
    const r = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(cantidad_disponible), 0)::text AS total FROM g3_servicios.lote_articulo WHERE id_articulo = $1`,
      [m.id_articulo]
    );
    return Number(r.rows[0].total);
  };

  const insertMovimiento = (idLote: string | null, cantidad: number, saldo: number, costo: string | null) =>
    client.query(
      `INSERT INTO g3_servicios.movimiento_inventario (
         id_movimiento, id_articulo, id_lote, tipo_movimiento, cantidad, signo,
         fecha_hora, saldo_posterior, motivo, id_origen, modulo_origen, costo_unitario
       ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11::numeric(12,4))`,
      [crypto.randomUUID(), m.id_articulo, idLote, m.tipo_movimiento, cantidad, m.signo, saldo, m.motivo, m.id_origen, m.modulo_origen, costo]
    );

  let saldo = await stockOf();
  let warehouseId = m.id_almacen ?? null;
  if (!warehouseId) {
    const warehouse = await client.query<{ id_almacen: string }>(
      `SELECT id_almacen FROM g3_servicios.almacen
       WHERE estado = 'activo'
       ORDER BY es_principal DESC, nombre ASC LIMIT 1`
    );
    warehouseId = warehouse.rows[0]?.id_almacen ?? null;
  }
  if (!warehouseId) throw new DomainRuleError('No existe un almacén activo para registrar el movimiento.');

  if (m.signo === 'entrada') {
    let costo = m.costo_unitario ?? null;
    if (costo === null) {
      const last = await client.query<{ costo_unitario: string }>(
        `SELECT costo_unitario::text AS costo_unitario FROM g3_servicios.lote_articulo
         WHERE id_articulo = $1 ORDER BY fecha_creacion DESC LIMIT 1`,
        [m.id_articulo]
      );
      costo = last.rows[0]?.costo_unitario ?? '0';
    }
    let idLote = m.id_lote ?? null;
    if (idLote) {
      const upd = await client.query(
        `UPDATE g3_servicios.lote_articulo SET cantidad_disponible = cantidad_disponible + $3::numeric
         WHERE id_lote = $1 AND id_articulo = $2`,
        [idLote, m.id_articulo, m.cantidad]
      );
      if (upd.rowCount === 0) throw new DomainRuleError('El lote indicado no pertenece al artículo.');
    } else {
      idLote = crypto.randomUUID();
      await client.query(
        `INSERT INTO g3_servicios.lote_articulo (id_lote, id_articulo, id_almacen, fecha_vencimiento, cantidad_disponible, costo_unitario)
         VALUES ($1, $2, $3, $4::date, $5, $6::numeric(12,4))`,
        [idLote, m.id_articulo, warehouseId, m.fecha_vencimiento ?? null, m.cantidad, costo]
      );
    }
    saldo += m.cantidad;
    await insertMovimiento(idLote, m.cantidad, saldo, costo);
    return { saldo_posterior: saldo.toFixed(3), movimientos: 1, cantidad_aplicada: m.cantidad };
  }

  // salida
  const lotes = await client.query<{ id_lote: string; cantidad_disponible: string; costo_unitario: string }>(
    `SELECT id_lote, cantidad_disponible::text AS cantidad_disponible, costo_unitario::text AS costo_unitario
     FROM g3_servicios.lote_articulo
     WHERE id_articulo = $1 AND cantidad_disponible > 0
       AND ($2::text IS NULL OR id_lote = $2::text)
       AND ($3::text IS NULL OR id_almacen = $3::text)
     ORDER BY fecha_vencimiento ASC NULLS LAST, fecha_creacion ASC, id_lote ASC
     FOR UPDATE`,
    [m.id_articulo, m.id_lote ?? null, m.id_lote ? null : warehouseId]
  );
  const disponible = lotes.rows.reduce((acc, l) => acc + Number(l.cantidad_disponible), 0);
  if (disponible + 1e-9 < m.cantidad && !m.permitirParcial) {
    throw new DomainRuleError('Stock insuficiente en almacén para registrar esta salida.');
  }
  let restante = Math.min(m.cantidad, disponible);
  const aplicada = restante;
  let movimientos = 0;
  for (const lote of lotes.rows) {
    if (restante <= 1e-9) break;
    const take = Math.min(Number(lote.cantidad_disponible), restante);
    await client.query(`UPDATE g3_servicios.lote_articulo SET cantidad_disponible = cantidad_disponible - $2::numeric WHERE id_lote = $1`, [lote.id_lote, take]);
    saldo -= take;
    await insertMovimiento(lote.id_lote, take, saldo, lote.costo_unitario);
    restante -= take;
    movimientos += 1;
  }
  return { saldo_posterior: saldo.toFixed(3), movimientos, cantidad_aplicada: aplicada };
}
