# language: es
@settlements
Característica: Consulta de liquidaciones diarias

  Escenario: Ver liquidaciones del día actual
    Dado que el usuario accede al módulo "Liquidaciones"
    Cuando selecciona el rango de fecha "Hoy"
    Entonces se visualiza el resumen de transacciones liquidadas
