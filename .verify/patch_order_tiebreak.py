import os

PAIRS = {
    'server/modules/m1/repository.ts': [
        ("ORDER BY le.prioridad DESC, le.fecha_registro ASC\n", "ORDER BY le.prioridad DESC, le.fecha_registro ASC, le.id_lista_espera ASC\n"),
    ],
    'server/modules/m2/repository.ts': [
        ("ORDER BY ol.fecha_hora_creacion DESC\n", "ORDER BY ol.fecha_hora_creacion DESC, ol.numero_orden DESC\n"),
        ("ORDER BY i.fecha_hora_registro DESC\n", "ORDER BY i.fecha_hora_registro DESC, i.numero_incidencia DESC\n"),
        ("ORDER BY ot.fecha_hora_creacion DESC\n", "ORDER BY ot.fecha_hora_creacion DESC, ot.numero_ot DESC\n"),
    ],
    'server/modules/m3/repository.ts': [
        ("ORDER BY c.fecha_hora_apertura DESC\n", "ORDER BY c.fecha_hora_apertura DESC, c.numero_comanda DESC\n"),
        ("ORDER BY con.fecha_hora_registro DESC\n", "ORDER BY con.fecha_hora_registro DESC, con.numero_consumo DESC\n"),
        ("ORDER BY aa.nombre ASC\n     LIMIT", "ORDER BY aa.nombre ASC, aa.id_articulo ASC\n     LIMIT"),
        ("ORDER BY oc.fecha_hora_preparacion DESC\n", "ORDER BY oc.fecha_hora_preparacion DESC, oc.numero_orden DESC\n"),
    ],
    'server/modules/m4/repository.ts': [
        ("ORDER BY c.fecha_apertura DESC\n", "ORDER BY c.fecha_apertura DESC, c.id_cuenta DESC\n"),
        ("ORDER BY fecha_emision DESC\n", "ORDER BY fecha_emision DESC, id_comprobante DESC\n"),
        ("ORDER BY t.fecha_apertura DESC\n", "ORDER BY t.fecha_apertura DESC, t.id_turno_caja DESC\n"),
        ("ORDER BY g.fecha DESC\n", "ORDER BY g.fecha DESC, g.id_gasto DESC\n"),
        ("ORDER BY cxc.fecha_vencimiento ASC\n", "ORDER BY cxc.fecha_vencimiento ASC, cxc.id_cuenta_por_cobrar ASC\n"),
    ],
}
for path, pairs in PAIRS.items():
    s = open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a, s.count(a))
        s = s.replace(a, b)
    open(path + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(path + '.tmp', path)
print('ok')
