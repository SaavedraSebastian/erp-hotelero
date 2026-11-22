import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def m4(s):
    s = rep(s, "    requirePermission(PERMISSIONS.M4_COMPROBANTE_CONSULTAR),\n    handle((req) => {\n      const q = reporteQuerySchema.parse(req.query);\n      return withReadOnlyClient((client) => resumenFinanciero(client, q.desde, q.hasta), req.authContext!);\n    })",
               "    requirePermission(PERMISSIONS.M4_COMPROBANTE_CONSULTAR),\n    validateQuery(reporteQuerySchema),\n    handle((req) => {\n      const q = (req as unknown as { validatedQuery: z.infer<typeof reporteQuerySchema> }).validatedQuery;\n      return withReadOnlyClient((client) => resumenFinanciero(client, q.desde, q.hasta), req.authContext!);\n    })")
    s = rep(s, "import { validateBody, validateParams } from '../../middleware/validate.ts';", "import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';")
    return s
rw('server/modules/gestion/m4.ts', m4)

def m2(s):
    s = rep(s, "    '/inspecciones',\n    requirePermission(PERMISSIONS.M2_LIMPIEZA_CONSULTAR),\n    handle((req) =>", "    '/inspecciones',\n    requirePermission(PERMISSIONS.M2_LIMPIEZA_CONSULTAR),\n    validateQuery(paginationQuerySchema),\n    handle((req) =>")
    s = rep(s, "import { validateBody, validateParams } from '../../middleware/validate.ts';", "import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';")
    s = rep(s, "import { buildPaginatedResponse, parsePagination,", "import { buildPaginatedResponse, paginationQuerySchema, parsePagination,")
    return s
rw('server/modules/gestion/m2.ts', m2)

def routes(s):
    s = rep(s, "  router.get('/tarifas', requirePermission(PERMISSIONS.M1_TARIFA_CONSULTAR), ctrl.listTarifas);", "  router.get('/tarifas', requirePermission(PERMISSIONS.M1_TARIFA_CONSULTAR), validateQuery(paginationQuerySchema), ctrl.listTarifas);")
    return s
rw('server/modules/m1/routes.ts', routes)
print('ok')
