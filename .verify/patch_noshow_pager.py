import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def tpl(s):
    return rep(s, '    <div class="divide-y" data-ref="noshow-list"></div>\n', '    <div class="divide-y" data-ref="noshow-list"></div>\n    <div data-ref="noshow-footer"></div>\n')
rw('src/html/modules/reservas/ia-tarifas.html', tpl)

def mod(s):
    s = rep(s, "      const upcoming = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');\n",
               "      const upcomingAll = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');\n      const nsPager = localPager('m1.noshow', upcomingAll, renderContent, 10);\n      const upcoming = nsPager.slice;\n      mountRef(tabBody, 'noshow-footer', nsPager.footer);\n")
    return s
rw('src/js/modules/reservas-recepcion.js', mod)
print('ok')
