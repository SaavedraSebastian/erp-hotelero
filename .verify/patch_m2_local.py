import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def foot(s):
    return rep(s, '''      </table>
    </div>
  </div>
</div>''', '''      </table>
    </div>
    <div data-ref="footer-slot"></div>
  </div>
</div>''')
rw('src/html/modules/housekeeping/activos.html', foot)
rw('src/html/modules/housekeeping/mant-preventivo.html', foot)

def mod(s):
    # activos
    s = rep(s, "        mountRef(\n          tabBody,\n          'tbody',\n          filtered.map((a) => {\n            const tr = clone('fila-activo');",
               "        const lp = localPager('m2.activos', filtered, renderAssetRows, 20);\n        mountRef(tabBody, 'footer-slot', lp.footer);\n        mountRef(\n          tabBody,\n          'tbody',\n          lp.slice.map((a) => {\n            const tr = clone('fila-activo');")
    s = rep(s, "          m2Ui.assetSearch = v;\n", "          m2Ui.assetSearch = v;\n          resetLocalPager('m2.activos');\n")
    # preventivo
    s = rep(s, "      mountRef(\n        tabBody,\n        'tbody',\n        state.preventiveSchedules.map((p) => {",
               "      const prevPager = localPager('m2.preventivo', state.preventiveSchedules, renderContent, 20);\n      mountRef(tabBody, 'footer-slot', prevPager.footer);\n      mountRef(\n        tabBody,\n        'tbody',\n        prevPager.slice.map((p) => {")
    s = rep(s, "import { localPager } from '../components/pagination.js';", "import { localPager, resetLocalPager } from '../components/pagination.js';")
    return s
rw('src/js/modules/housekeeping-mantenimiento.js', mod)
print('ok')
