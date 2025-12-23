# APPLIED_STRATEGY – Geometric Modified Buy Logic (TriBot Smart DCA)

> Versión: 2025-09-22 • Autor: Neo • Estado: Propuesta aprobada por usuario

## 1) Resumen ejecutivo
Se reemplaza la lógica de compras **aritmética** por una **geométrica modificada**. Todo sigue partiendo del **ATH inicial** para el primer disparo, pero **cada nueva compra usa como referencia el precio de la _última compra ejecutada_**. No se preconstruye una grilla de niveles; la entrada ocurre **a vela cerrada** cuando el precio **cierra** por debajo del umbral dinámico calculado desde la última compra. Si la caída es más profunda que el umbral, **se ejecuta una sola compra** al cierre y el umbral se **re-ancora** al nuevo precio de compra.

## 2) Definiciones
- **ATH_inicial**: Máximo histórico de la ventana de arranque del ciclo.
- **P_last**: Precio de la última compra ejecutada (para la primera compra, P_last = precio al disparo inicial desde ATH).
- **drop_pct**: Porcentaje de caída requerido para una nueva compra (0 < drop_pct < 1). Ej.: 5% → 0.05.
- **close[t]**: Precio de cierre de la vela t.
- **umbral_compra[t]**: Precio gatillo en t para una nueva compra, calculado desde P_last.

## 3) Regla de compra (geométrica modificada, a vela cerrada)
1. Inicialización del ciclo: determinar **ATH_inicial** según temporalidad (4H/1D/1W). No se coloca ninguna orden pendiente.
2. **Primera compra:** Se permite cuando `close[t] <= ATH_inicial * (1 - drop_pct)`. La compra se ejecuta al close[t]. Se setea `P_last := close[t]`.
3. **Compras subsiguientes:** En cada vela cerrada calcular `umbral_compra[t] = P_last * (1 - drop_pct)`.
   - Si `close[t] <= umbral_compra[t]`, ejecutar **una** compra al close[t] y actualizar `P_last := close[t]`.
   - Si la caída fue más profunda (gap/flash) no se desencadenan múltiples compras: **máximo 1 compra por vela**.
4. No existe una “grilla” predefinida de niveles; cada umbral se re-ancora dinámicamente al **último precio de compra**.

### Observaciones clave
- **Profundización:** Si de 100 se cae directo a 80 (−20%) y drop_pct=5%, la compra ocurre **una vez** al cierre en 80. El próximo umbral será `80 * (1 − 0.05) = 76`. 
- **Anti-“overfill” en velas largas:** Aunque en una sola vela se crucen múltiples “hipotéticos” niveles, **solo se compra una vez** al cierre.
- **Sin drift sobre ATH:** El ATH solo gatilla la primera oportunidad; luego **no** se usa más para calcular compras.

## 4) Regla de venta (sin cambios)
- Venta **siempre con ganancia** respecto al **avg_cost** del ciclo, con **TP_pct** fijo (ej.: +0.5%…+2% según temporalidad).
- Se mantiene la política del proyecto: **solo ventas con ganancia**; no se contemplan stop-loss duros (resiliencia de largo plazo).

## 5) Gestión de capital (sin cambios estructurales)
- `max_compras` por ciclo configurable. 
- Cálculo del `montoCompra` al inicio del ciclo según capital asignado y `max_compras` (ver docs previas). 
- Comisiones: aplicar tasa por exchange y registrar `dust` según criterios ya definidos por el usuario (USDT al capital disponible; BTC al “dust” del siguiente ciclo).

## 6) Parámetros
- `drop_pct` (float, 0.01–0.20 típico)
- `TP_pct` (float, 0.003–0.02 típico, por temporalidad)
- `max_compras` (int)
- `cooldown_barras` (int): opcional para evitar compras en velas adyacentes hiper-volátiles.
- `one_fill_per_candle` (bool, default: true)
- `allow_partial_fills` (bool, default: false, solo backtester)
- `slippage_model` (enum): none | fixed_bps | atr_based (solo backtester)

## 7) Pseudocódigo
```python
# estado por ciclo
P_last = None
compras_hechas = 0

for cada vela t ordenada por tiempo:
    if ciclo_activo is False: continue

    # 1) Primer gatillo desde ATH
    if P_last is None:
        umbral = ATH_inicial * (1 - drop_pct)
        if close[t] <= umbral and compras_hechas < max_compras:
            ejecutar_compra(precio=close[t], monto=montoCompra)
            P_last = close[t]
            compras_hechas += 1
        continue

    # 2) Gatillos subsecuentes anclados a P_last
    umbral = P_last * (1 - drop_pct)

    if close[t] <= umbral and compras_hechas < max_compras:
        ejecutar_compra(precio=close[t], monto=montoCompra)
        P_last = close[t]
        compras_hechas += 1

    # 3) Regla de venta (sin cambios)
    if precio_venta_condicion(avg_cost, TP_pct, close[t]):
        ejecutar_venta(precio=close[t], qty=posición_total)
        cerrar_ciclo_y_reiniciar()

```

## 8) Ejemplo de trayectoria (drop_pct = 5%)
- ATH_inicial = 100.
- Vela A: cierra en 100 → sin compra (requiere caída).
- Vela B: cierra en 80 → **compra** (porque 80 ≤ 95); `P_last=80`.
- Vela C: cierra en 78 → **NO compra** (umbral=76; 78 > 76).
- Vela D: cierra en 75 → **compra** (75 ≤ 76); `P_last=75`.
- Vela E: cierra en 74 → **NO compra** (nuevo umbral=75*(1-0.05)=71.25; 74>71.25).
- Vela F: cierra en 70 → **compra** (70 ≤ 71.25); `P_last=70`.
- Y así sucesivamente, siempre a **una compra por vela** como máximo.

## 9) Consideraciones de implementación
- **Backtester:** 
  - Añadir `buy_mode = "geom_modified"` y mantener `buy_mode = "arithmetic"` para compatibilidad.
  - Garantizar `one_fill_per_candle` en el engine.
  - Los reportes deben reflejar el umbral dinámico por vela.
- **Ejecución real (n8n/Binance):**
  - No colocar órdenes limit escalonadas; operar por **market/limit al close** según política del bot.
  - Manejar “gaps” sin multi-fill: una orden por señal.
  - Conservar la integración de comisiones y `dust` como hasta ahora.

## 10) Pruebas sugeridas
- **Unit**: 
  - “Gap profundo” (de 100 a 80) produce **1** compra y umbral se re-ancora a 80.
  - Cruce marginal (80 → 76.1) **no compra**; 76.0 **sí compra**.
  - Límite de `max_compras` respetado.
- **Propiedad**: 
  - Nunca más de 1 compra por vela si `one_fill_per_candle=True`.
  - `P_last` solo cambia cuando hay compra.
- **Integración**: backtest con datasets 4H/1D/1W verificando que las curvas de compra difieren de la versión aritmética.

## 11) Compatibilidad con políticas del usuario
- Mantiene la filosofía TriBot: resiliencia, compras en caídas y ventas con ganancia.
- Respeta la preferencia del usuario de **esperar confirmación por vela cerrada** y evitar múltiples compras en la misma vela.

## 12) Changelog
- 2025-09-22: Nueva modalidad **buy_mode = geom_modified**. Compras ancladas a `P_last` (última compra), umbral recalculado por vela, sin grilla fija, una compra por vela.
- 2025-09-22: Se mantiene lógica de venta por `avg_cost + TP_pct` y gestión de capital vigente.
