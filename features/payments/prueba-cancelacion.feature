# language: es
@payments
Característica: Pagos - Prueba cancelacion

  Como usuario con permisos en Pagos
  Quiero prueba cancelacion
  Para verificar que no debe terminar

  Escenario: Prueba cancelacion
    Dado que el usuario navega a la sección "Pagos"
    Cuando Prueba cancelacion
    Entonces No debe terminar
