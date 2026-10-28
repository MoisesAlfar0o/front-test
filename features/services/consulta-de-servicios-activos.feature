# language: es
@services
Característica: Módulo de Servicios - Consulta de servicios activos

  Como usuario con permisos en Módulo de Servicios
  Quiero consulta de servicios activos
  Para verificar que solo veo servicios activos

  Escenario: Consulta de servicios activos
    Dado que el usuario navega a la sección "Módulo de Servicios"
    Cuando Consulta de servicios activos
    Entonces Solo veo servicios activos
