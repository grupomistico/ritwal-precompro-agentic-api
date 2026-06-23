export const toolSpecs = [
  {
    name: "restaurant_profile",
    method: "GET",
    path: "/tools/restaurant/profile",
    description: "Consulta datos base del restaurante y zonas configuradas.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "check_availability",
    method: "POST",
    path: "/tools/availability",
    description: "Lista horarios disponibles por fecha, hora opcional, cantidad de personas y zona.",
    inputSchema: {
      type: "object",
      required: ["date", "partySize"],
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          description:
            "Fecha. Preferido YYYY-MM-DD; el middleware tambien acepta hoy, mañana/manana y pasado mañana.",
        },
        time: {
          type: "string",
          description:
            "Hora opcional para revisar si el slot exacto aparece disponible. Preferido HH:mm; tambien acepta formatos como 3pm.",
        },
        partySize: {
          type: ["integer", "string"],
          minimum: 1,
          description: "Cantidad de personas. Puede llegar como numero o texto numerico.",
        },
        zone: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
          },
        },
        subzone: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  {
    name: "create_reservation",
    method: "POST",
    path: "/tools/reservations/create",
    description: "Crea una reserva solo si el slot exacto sigue disponible.",
    inputSchema: {
      type: "object",
      required: ["displayName", "phone", "date", "time", "partySize"],
      additionalProperties: false,
      properties: {
        displayName: { type: "string", minLength: 2 },
        phone: { type: ["string", "number"] },
        countryCode: { type: ["string", "number"], default: 57 },
        email: { type: "string", format: "email" },
        date: {
          type: "string",
          description:
            "Fecha. Preferido YYYY-MM-DD; el middleware tambien acepta hoy, mañana/manana y pasado mañana.",
        },
        time: {
          type: "string",
          description: "Hora. Preferido HH:mm en 24 horas; tambien acepta formatos como 3pm.",
        },
        partySize: {
          type: ["integer", "string"],
          minimum: 1,
          maximum: 18,
          description: "Cantidad de personas. Puede llegar como numero o texto numerico.",
        },
        zone: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
          },
        },
        subzone: { type: "integer", minimum: 0, default: 0 },
        comments: { type: "string" },
        allergies: { type: "string" },
        occasion: { type: "string" },
        requirements: { type: "string" },
        pet: { type: "string" },
        preferredZoneName: { type: "string" },
        partyComposition: { type: "string" },
        birthday: { type: "string" },
        celebrationComment: { type: "string" },
        restaurantComment: { type: "string" },
        idempotencyKey: { type: "string" },
      },
    },
  },
  {
    name: "search_reservations",
    method: "POST",
    path: "/tools/reservations/search",
    description: "Busca reservas activas por telefono.",
    inputSchema: {
      type: "object",
      required: ["phone"],
      additionalProperties: false,
      properties: {
        phone: { type: ["string", "number"] },
      },
    },
  },
  {
    name: "list_reservations_by_date",
    method: "POST",
    path: "/tools/reservations/list-date",
    description:
      "Herramienta solo lectura para listar y resumir reservas de una fecha. Usar activeReservations y activePeople para responder cuantas reservas/personas reales hubo sin contar canceladas.",
    inputSchema: {
      type: "object",
      required: ["date"],
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          description:
            "Fecha a consultar en YYYY-MM-DD. Puede ser pasada; tambien acepta hoy, mañana/manana y pasado mañana.",
        },
        includeCancelled: {
          type: ["boolean", "string", "number"],
          default: true,
          description:
            "Si es true incluye canceladas en el detalle y las separa en summary.cancelledReservations/cancelledPeople.",
        },
      },
    },
  },
  {
    name: "list_reservations_range",
    method: "POST",
    path: "/tools/reservations/list-range",
    description:
      "Herramienta solo lectura para reportes por rango de fechas, maximo 31 dias. Ideal para preguntas como reservas de lunes a viernes y personas que trajo.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: false,
      properties: {
        from: {
          type: "string",
          description:
            "Fecha inicial en YYYY-MM-DD. Para 'semana pasada' el agente debe calcular la fecha exacta en America/Bogota.",
        },
        to: {
          type: "string",
          description: "Fecha final en YYYY-MM-DD. El rango es inclusivo.",
        },
        includeCancelled: {
          type: ["boolean", "string", "number"],
          default: true,
          description:
            "Si es true incluye canceladas en el detalle y las separa en summary.cancelledReservations/cancelledPeople.",
        },
        includeReservations: {
          type: ["boolean", "string", "number"],
          default: true,
          description:
            "Si es false devuelve solo summaries por dia y total; util para reportes sin detalle de cada reserva.",
        },
      },
    },
  },
  {
    name: "update_reservation",
    method: "POST",
    path: "/tools/reservations/update",
    description: "Actualiza una reserva activa tras revalidar disponibilidad.",
    inputSchema: {
      type: "object",
      required: ["reservationId", "phone"],
      additionalProperties: false,
      properties: {
        reservationId: { type: "string" },
        phone: { type: ["string", "number"] },
        displayName: { type: "string", minLength: 2 },
        phoneNew: { type: ["string", "number"] },
        countryCode: { type: ["string", "number"] },
        email: { type: "string", format: "email" },
        date: {
          type: "string",
          description:
            "Fecha. Preferido YYYY-MM-DD; el middleware tambien acepta hoy, mañana/manana y pasado mañana.",
        },
        time: {
          type: "string",
          description: "Hora. Preferido HH:mm en 24 horas; tambien acepta formatos como 3pm.",
        },
        partySize: {
          type: ["integer", "string"],
          minimum: 1,
          maximum: 18,
          description: "Cantidad de personas. Puede llegar como numero o texto numerico.",
        },
        comments: { type: "string" },
        allergies: { type: "string" },
        occasion: { type: "string" },
        requirements: { type: "string" },
        pet: { type: "string" },
        preferredZoneName: { type: "string" },
        partyComposition: { type: "string" },
      },
    },
  },
  {
    name: "cancel_reservation",
    method: "POST",
    path: "/tools/reservations/cancel",
    description: "Cancela una reserva; si se envia telefono, valida pertenencia antes.",
    inputSchema: {
      type: "object",
      required: ["reservationId"],
      additionalProperties: false,
      properties: {
        reservationId: { type: "string" },
        phone: { type: ["string", "number"] },
      },
    },
  },
  {
    name: "confirm_reservation",
    method: "POST",
    path: "/tools/reservations/confirm",
    description: "Marca reconfirmacion de usuario. Reservado para recordatorios.",
    inputSchema: {
      type: "object",
      required: ["reservationId"],
      additionalProperties: false,
      properties: {
        reservationId: { type: "string" },
        phone: { type: ["string", "number"] },
      },
    },
  },
];
