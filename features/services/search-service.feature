# language: es
@services
Característica: Búsqueda de servicios por nombre

  Escenario: Filtrar servicios por texto "TIGO"
    Dado que el usuario navega a la sección "Servicios"
    Cuando busca "TIGO" en el buscador
    Entonces solo ve servicios cuyo nombre contiene "TIGO"

  Escenario: Limpiar filtro de búsqueda
    Dado que el usuario tiene un filtro activo "TIGO"
    Cuando hace clic en "Limpiar búsqueda"
    Entonces se muestran todos los servicios disponibles
