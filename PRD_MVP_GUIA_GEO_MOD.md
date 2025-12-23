Perfecto Michiguene 👍

Te dejo \*\*la documentación completa, cerrada y ejecutable\*\* para que \*\*Claude la implemente en VSCode sin perder nada de lo existente\*\*, exactamente como pediste.

Esto es un \*\*PRD + MVP + Plan de Tests + Guía de Integración\*\* pensado para \*\*no romper el modo aritmético\*\* y sumar \*\*geo\_mod\*\* como modo adicional.



Todo lo que sigue \*\*está 100% alineado\*\* con:



\* `APPLIED\_STRATEGY\_geom\_mod.md` 

\* `RESUMEN\_GEO\_MOD.md` 



---



\# 📘 PRD — TriBot Buy Engine v2



\*\*Feature:\*\* Dual Buy Mode (`arithmetic` + `geom\_modified`)

\*\*Estado:\*\* Ready for implementation

\*\*Objetivo:\*\* Integrar geo\_mod \*\*sin romper\*\* el comportamiento actual



---



\## 1. Contexto y objetivo



TriBot actualmente implementa una estrategia \*\*aritmética con grillas\*\* basada en ATH, con multi-level buys y grid delayed.



Este PRD introduce un \*\*nuevo modo de compra\*\* llamado \*\*`geom\_modified`\*\*, que:



\* elimina la grilla fija

\* ancla cada compra al \*\*último precio ejecutado\*\*

\* permite \*\*máx 1 compra por vela\*\*

\* mejora resiliencia en caídas profundas



👉 \*\*Requisito clave:\*\*

El modo aritmético \*\*NO se modifica\*\*. Ambos modos deben convivir.



---



\## 2. Alcance (IN / OUT)



\### IN



\* Nuevo campo `buy\_mode`

\* Nuevo motor de compra geo\_mod

\* State extendido (compatible hacia atrás)

\* Backtester compatible con ambos modos

\* Tests unitarios + integración



\### OUT (explícitamente NO incluido)



\* Cambios en lógica de venta

\* Stop-loss

\* Cambios en capital allocation

\* Cambios en OrchestratorPool



---



\## 3. Contratos de Configuración



\### StrategyConfig (extensión)



```ts

type BuyMode = "arithmetic" | "geom\_modified";



interface StrategyConfig {

&nbsp; buy\_mode: BuyMode; // default: "arithmetic"

&nbsp; drop\_pct: number;

&nbsp; tp\_pct: number;

&nbsp; max\_compras: number;

&nbsp; timeframe: "4H" | "1D" | "1W";

&nbsp; // resto sin cambios

}

```



\*\*Compatibilidad:\*\*

Si `buy\_mode` no existe → asumir `"arithmetic"`.



---



\## 4. State por ciclo (CycleState v2)



\### Campos nuevos



```ts

interface CycleState {

&nbsp; p\_last\_buy: number | null; // solo usado en geom\_modified

&nbsp; state\_version: 2;

}

```



\### Campos existentes



\* `buy\_grid`

\* `buy\_index`

\* `capital\_available`

\* `btc\_accumulated`

\* `btc\_dust`

\* `avg\_cost`

\* etc.



\*\*Regla:\*\*



\* `arithmetic` → usa grid + buy\_index

\* `geom\_modified` → ignora grid y buy\_index



---



\## 5. Buy Engine — Diseño



\### Entry point común



```ts

executeBuyLogic(

&nbsp; mode: BuyMode,

&nbsp; candle: Candle,

&nbsp; state: CycleState,

&nbsp; config: StrategyConfig

): BuyDecision | null

```



\### Dispatch interno



```ts

if (config.buy\_mode === "arithmetic") {

&nbsp; return arithmeticBuyEngine(...)

}



if (config.buy\_mode === "geom\_modified") {

&nbsp; return geomModifiedBuyEngine(...)

}

```



---



\## 6. Buy Engine — Modo Aritmético (SIN CAMBIOS)



\* Grid desde ATH

\* Grid delayed

\* Multi-level buys permitidos

\* buy\_index avanza

\* Comportamiento idéntico al actual



⚠️ \*\*Cualquier cambio aquí es BUG\*\*



---



\## 7. Buy Engine — Modo `geom\_modified` (ESPECIFICACIÓN FINAL)



\### Invariantes



\* ❌ No existe grilla

\* ✅ Máx \*\*1 compra por vela\*\*

\* ✅ Umbral dinámico anclado a `p\_last\_buy`

\* ✅ ATH solo se usa para el primer disparo

\* ✅ Compras solo a \*\*vela cerrada\*\*



---



\### Lógica exacta (obligatoria)



\#### Inicialización



```ts

if (state.p\_last\_buy === null) {

&nbsp; threshold = ATH\_initial \* (1 - drop\_pct)

}

```



\#### Primer disparo



```ts

if (close <= threshold) {

&nbsp; ejecutar\_compra(precio = close)

&nbsp; state.p\_last\_buy = close

}

```



\#### Compras subsiguientes



```ts

threshold = state.p\_last\_buy \* (1 - drop\_pct)



if (close <= threshold) {

&nbsp; ejecutar\_compra(precio = close)

&nbsp; state.p\_last\_buy = close

}

```



\#### Reglas duras



\* ❗ \*\*Nunca\*\* más de una compra por vela

\* ❗ No se “simulan” niveles intermedios

\* ❗ No se usan ATH posteriores



📌 Todo esto está definido literalmente en el doc técnico 



---



\## 8. Venta (común a ambos modos)



\* Venta solo si `close >= avg\_cost \* (1 + tp\_pct)`

\* Venta total de la posición

\* Dust y fees sin cambios



👉 \*\*No se toca\*\*



---



\## 9. Migración de DB (segura)



\### strategy\_config



```sql

ALTER TABLE strategy\_config

ADD COLUMN buy\_mode TEXT DEFAULT 'arithmetic';

```



\### cycle\_state



```sql

ALTER TABLE cycle\_state

ADD COLUMN p\_last\_buy NUMERIC NULL,

ADD COLUMN state\_version INT DEFAULT 2;

```



\*\*No borrar columnas existentes.\*\*



---



\## 10. Backtester (obligatorio)



\### Nuevos parámetros



\* `buy\_mode`

\* `one\_fill\_per\_candle = true` (hardcoded en geo\_mod)



\### Reglas



\* arithmetic → comportamiento actual

\* geom\_modified → usar `p\_last\_buy`



📌 El backtester \*\*debe producir resultados distintos\*\* entre modos (esperado).



---



\## 11. Plan de Tests (NO negociable)



\### Unit tests — geo\_mod



1\. \*\*Gap profundo\*\*



&nbsp;  \* ATH=100, close=80

&nbsp;  \* Resultado: \*\*1 compra\*\*, `p\_last\_buy=80`



2\. \*\*Umbral dinámico\*\*



&nbsp;  \* p\_last\_buy=80, drop=5%

&nbsp;  \* close=78 → NO compra

&nbsp;  \* close=76 → SÍ compra



3\. \*\*Invariante\*\*



&nbsp;  \* Nunca >1 compra por vela



4\. \*\*Max compras\*\*



&nbsp;  \* `max\_compras` respetado



---



\### Regression tests — arithmetic



\* Mismo input → mismo output que versión anterior

\* buy\_grid, buy\_index intactos



---



\### Integration tests



\* arithmetic y geo\_mod corren en paralelo

\* Venta idéntica para ambos

\* State no se corrompe



---



\## 12. Criterios de aceptación (Checklist)



Claude \*\*NO debe marcar el ticket como DONE\*\* si:



\* ❌ Se rompió el modo aritmético

\* ❌ geo\_mod permite múltiples compras por vela

\* ❌ Se usa grid en geo\_mod

\* ❌ No existen tests nuevos

\* ❌ No se puede backtestear ambos modos



---



\## 13. Entregables esperados (Claude)



\* Código implementado

\* Migraciones SQL

\* Tests unitarios + integración

\* Resumen técnico del cambio

\* Comandos de verificación:



&nbsp; \* `npm test`

&nbsp; \* `npm run build`

&nbsp; \* `npm run typecheck`



---



\## 14. Nota arquitectónica final (importante)



Este diseño:



\* preserva todo lo existente

\* permite A/B testing real

\* habilita optimización futura

\* evita deuda técnica



Es \*\*la forma correcta\*\* de evolucionar TriBot.



---



