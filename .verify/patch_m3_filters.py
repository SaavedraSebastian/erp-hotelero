import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:80], s.count(a))
    return s.replace(a, b)

rw('server/shared/types/context.ts', lambda s: rep(s, "  status?: string;\n}\n\nexport interface PaginationMeta", "  status?: string;\n  /** Filtros específicos de Servicios: modalidad de la comanda y punto de venta. */\n  modalidad?: string;\n  puntoVenta?: string;\n}\n\nexport interface PaginationMeta"))

def schema(s):
    return rep(s, "  fromDate: dateOnlySchema.optional(),", """  modalidad: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  puntoVenta: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  fromDate: dateOnlySchema.optional(),""")
rw('server/shared/pagination/index.ts', schema)

EE = """LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = {a}.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo"""

def m3(s):
    # comandas: filtro, búsqueda ampliada y habitación/huésped de la estadía
    s = rep(s, "  pushDateRange(values, where, 'c.fecha_hora_apertura', params.fromDate, params.toDate);\n  pushSearchFilter(values, where, ['c.numero_comanda', 'c.nombre_mesa_capturado', 'pv.nombre', 'c.modalidad'], params.search);",
               "  pushDateRange(values, where, 'c.fecha_hora_apertura', params.fromDate, params.toDate);\n  if (params.modalidad) {\n    values.push(params.modalidad);\n    where.push(`c.modalidad = $${values.length}`);\n  }\n  pushSearchFilter(values, where, ['c.numero_comanda', 'c.nombre_mesa_capturado', 'pv.nombre', 'hb.numero', \"(hu.nombres || ' ' || hu.apellidos)\"], params.search);")
    s = rep(s, "     FROM g3_servicios.comanda c\n     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = c.id_punto_venta\n     ${whereClause}",
               "     FROM g3_servicios.comanda c\n     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = c.id_punto_venta\n     " + EE.format(a='c') + "\n     ${whereClause}", 2)
    s = rep(s, "       c.usuario_responsable,\n       COALESCE(", "       c.usuario_responsable,\n       hb.numero AS numero_habitacion,\n       (hu.nombres || ' ' || hu.apellidos) AS huesped_nombre,\n       COALESCE(")
    # consumos
    s = rep(s, "  pushDateRange(values, where, 'con.fecha_hora_registro', params.fromDate, params.toDate);\n  pushSearchFilter(values, where, ['con.numero_consumo', 'pv.nombre', 'con.forma_cobro'], params.search);",
               "  pushDateRange(values, where, 'con.fecha_hora_registro', params.fromDate, params.toDate);\n  if (params.puntoVenta) {\n    values.push(params.puntoVenta);\n    where.push(`con.id_punto_venta = $${values.length}`);\n  }\n  pushSearchFilter(values, where, ['con.numero_consumo', 'pv.nombre', 'con.forma_cobro', 'hb.numero', \"(hu.nombres || ' ' || hu.apellidos)\"], params.search);")
    s = rep(s, "     FROM g3_servicios.consumo con\n     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = con.id_punto_venta\n     ${whereClause}",
               "     FROM g3_servicios.consumo con\n     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = con.id_punto_venta\n     " + EE.format(a='con') + "\n     ${whereClause}", 2)
    s = rep(s, "       con.usuario_responsable,\n       COALESCE(", "       con.usuario_responsable,\n       hb.numero AS numero_habitacion,\n       (hu.nombres || ' ' || hu.apellidos) AS huesped_nombre,\n       COALESCE(")
    return s
rw('server/modules/m3/repository.ts', m3)
print('ok')
