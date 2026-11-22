import re

BTN = """      <div class="row-wrap justify-end pt-2">
        <button type="button" class="btn btn-outline-muted" data-ref="cancel-btn">Cancelar</button>
        <button type="submit" class="btn btn-primary">{label}</button>
      </div>"""


def field(label, control):
    return f"""        <div>
          <label class="field-label">{label}</label>
          {control}
        </div>"""


def tpl(name, body, label):
    return f"""  <template data-tpl="{name}">
    <form class="stack-md">
{body}
{BTN.format(label=label)}
    </form>
  </template>"""


def grid(*fields):
    return '      <div class="grid-2">\n' + "\n".join(fields) + "\n      </div>"


SERVICIOS = {
    "modal-producto": tpl(
        "modal-producto",
        grid(
            field("Nombre", '<input class="input-control" required data-ref="name" />'),
            field("Punto de venta", '<select class="select-control" data-ref="pos"></select>'),
            field("Categoría de carta", '<select class="select-control" data-ref="category"></select>'),
            field(
                "Tipo",
                '<select class="select-control" data-ref="itemType"><option value="plato">Plato</option><option value="bebida">Bebida</option><option value="producto">Producto</option></select>',
            ),
            field("Precio de venta (S/)", '<input type="number" step="0.01" min="0" class="input-control font-mono" required data-ref="price" />'),
            field("Artículo de almacén que descuenta stock", '<select class="select-control" data-ref="article"></select>'),
        )
        + '\n      <p class="text-11 text-slate-500">Si el producto se prepara con receta, deja el artículo en &quot;Ninguno&quot; y configura la receta aparte. El costo se calcula con los insumos.</p>',
        "Guardar producto",
    ),
    "modal-servicio": tpl(
        "modal-servicio",
        grid(
            field("Nombre del servicio", '<input class="input-control" required data-ref="name" />'),
            field("Punto de venta", '<select class="select-control" data-ref="pos"></select>'),
            field("Categoría", '<select class="select-control" data-ref="category"></select>'),
            field("Duración (min, opcional)", '<input type="number" min="1" class="input-control font-mono" placeholder="Ej. 60" data-ref="duration" />'),
            field("Tarifa (S/)", '<input type="number" step="0.01" min="0" class="input-control font-mono" required data-ref="price" />'),
        ),
        "Guardar servicio",
    ),
    "modal-insumo": tpl(
        "modal-insumo",
        grid(
            field("Nombre del artículo", '<input class="input-control" required data-ref="name" />'),
            field("Categoría", '<select class="select-control" data-ref="category"></select>'),
            field("Unidad de medida", '<select class="select-control" data-ref="unit"></select>'),
            field("Stock mínimo", '<input type="number" min="0" step="0.5" class="input-control font-mono" required data-ref="min-stock" />'),
            field("Stock inicial", '<input type="number" min="0" step="0.5" class="input-control font-mono" data-ref="stock" />'),
            field("Costo unitario (S/)", '<input type="number" step="0.01" min="0" class="input-control font-mono" data-ref="unit-cost" />'),
            field("¿Vence?", '<label class="row-wrap"><input type="checkbox" data-ref="expires" /> Sí, controla vencimiento</label>'),
            field("Vencimiento del stock inicial", '<input type="date" class="input-control" data-ref="expiry" />'),
            field("Días de aviso de vencimiento", '<input type="number" min="0" max="365" class="input-control font-mono" data-ref="warn-days" />'),
        ),
        "Crear artículo",
    ),
    "modal-receta": tpl(
        "modal-receta",
        grid(
            field("Producto de carta", '<select class="select-control" data-ref="product"></select>'),
            field("Precio de venta (S/)", '<input type="number" class="input-control font-mono" readonly data-ref="sale-price" />'),
            field("Ingrediente principal", '<select class="select-control" data-ref="ing1"></select>'),
            field("Cantidad por porción", '<input type="number" step="0.01" min="0.01" class="input-control font-mono" required data-ref="ing1-qty" />'),
            field("Segundo ingrediente (opcional)", '<select class="select-control" data-ref="ing2"></select>'),
            field("Cantidad por porción", '<input type="number" step="0.01" min="0" class="input-control font-mono" data-ref="ing2-qty" />'),
        )
        + '\n      <p class="text-11 text-slate-500">Guardar crea una nueva versión vigente; la anterior queda en el historial.</p>',
        "Guardar receta",
    ),
}

HOUSEKEEPING = {
    "modal-activo": tpl(
        "modal-activo",
        grid(
            field("Nombre del activo", '<input class="input-control" required data-ref="name" />'),
            field("Tipo de activo", '<select class="select-control" data-ref="type"></select>'),
            field("Ubicación (habitación o área)", '<select class="select-control" data-ref="location"></select>'),
            field("Marca", '<input class="input-control" maxlength="30" data-ref="brand" />'),
            field("Modelo", '<input class="input-control" maxlength="30" data-ref="model" />'),
            field("Fecha de instalación", '<input type="date" class="input-control" data-ref="installDate" />'),
            field("Horas de uso", '<input type="number" min="0" step="1" class="input-control font-mono" data-ref="hoursUsed" />'),
            field(
                "Estado",
                '<select class="select-control" data-ref="condition"><option value="Operativo">Operativo</option><option value="En reparación">En reparación</option><option value="Dado de baja">Dado de baja</option></select>',
            ),
        )
        + '\n      <p class="text-11 text-slate-500">El código (ACT-nnnnn) lo asigna la base de datos. El riesgo de falla lo calcula el modelo predictivo.</p>',
        "Guardar activo",
    ),
    "modal-preventivo": tpl(
        "modal-preventivo",
        grid(
            field("Activo / Equipo", '<select class="select-control" required data-ref="asset"></select>'),
            field(
                "Frecuencia",
                '<select class="select-control" data-ref="frequency"><option value="Semanal">Semanal</option><option value="Mensual" selected>Mensual</option><option value="Trimestral">Trimestral</option><option value="Anual">Anual</option></select>',
            ),
            field("Próxima fecha (opcional)", '<input type="date" class="input-control" data-ref="nextDate" />'),
        )
        + "\n"
        + field("Tarea de mantenimiento", '<input class="input-control" required minlength="5" maxlength="150" data-ref="notes" />'),
        "Programar revisión",
    ),
}


def patch(path, mapping):
    s = open(path, encoding="utf-8").read()
    for name, new in mapping.items():
        pat = re.compile(r'  <template data-tpl="%s">.*?</template>' % re.escape(name), re.S)
        assert len(pat.findall(s)) == 1, name
        s = pat.sub(lambda m: new, s, count=1)
    open(path, "w", encoding="utf-8").write(s)
    print("ok", path, list(mapping))


base = "src/html/modules/"
patch(base + "servicios/modales.html", SERVICIOS)
patch(base + "housekeeping/modales.html", HOUSEKEEPING)
