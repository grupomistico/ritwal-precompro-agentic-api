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
          type: ["object", "string", "number"],
          additionalProperties: false,
          minimum: 0,
          description:
            "Zona opcional. Puede ser nombre como Salon/Templos/Wine Garden, id numerico o { id, name }. Usar 0 u omitir para sin zona especifica.",
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
          type: ["object", "string", "number"],
          additionalProperties: false,
          minimum: 0,
          description:
            "Zona opcional. Puede ser nombre como Salon/Templos/Wine Garden, id numerico o { id, name }. Usar 0 u omitir para sin zona especifica.",
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
      "Herramienta solo lectura para listar y resumir reservas de una fecha. Usar completedPeople para responder cuantas personas trajo; activePeople significa no canceladas e incluye no-shows.",
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
      "Herramienta solo lectura para reportes por rango de fechas, maximo 31 dias. Usar completedPeople para personas que trajo; activeReservations para reservas no canceladas.",
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
    name: "reservation_report",
    method: "POST",
    path: "/tools/reservations/report",
    description:
      "Reporte agregado de reservas sin nombres ni telefonos. Permite agrupar por fecha, dia, hora, estado, ciclo, zona/seccion, mesa, fuente, tipo, pago o usuario interno.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: false,
      properties: {
        from: {
          type: "string",
          description: "Fecha inicial en YYYY-MM-DD. El rango es inclusivo.",
        },
        to: {
          type: "string",
          description: "Fecha final en YYYY-MM-DD. Maximo 31 dias por llamada.",
        },
        includeCancelled: {
          type: ["boolean", "string", "number"],
          default: true,
          description:
            "Si es true incluye canceladas y las separa en summary.cancelledReservations/cancelledPeople.",
        },
        groupBy: {
          type: ["array", "string"],
          default: ["date"],
          maxItems: 4,
          description:
            "Dimensiones para agrupar. Puede enviarse como array o string separado por comas.",
          items: {
            type: "string",
            enum: [
              "date",
              "weekday",
              "hour",
              "reservationHour",
              "status",
              "lifecycle",
              "sectionName",
              "tableName",
              "partyBucket",
              "source",
              "provider",
              "typeReservation",
              "paymentType",
              "createdBy",
              "finishedBy",
              "cancelledBy",
              "noShowBy",
            ],
          },
        },
        filters: {
          type: "object",
          additionalProperties: false,
          description:
            "Filtros opcionales. Los valores de texto pueden enviarse como string o array.",
          properties: {
            status: { type: ["array", "string"], items: { type: "string" } },
            lifecycle: {
              type: ["array", "string"],
              items: { type: "string", enum: ["completed", "noShow", "cancelled", "pending"] },
            },
            sectionName: { type: ["array", "string"], items: { type: "string" } },
            tableName: { type: ["array", "string"], items: { type: "string" } },
            source: { type: ["array", "string"], items: { type: "string" } },
            provider: { type: ["array", "string"], items: { type: "string" } },
            typeReservation: { type: ["array", "string"], items: { type: "string" } },
            paymentType: { type: ["array", "string"], items: { type: "string" } },
            reservationHour: { type: ["array", "string"], items: { type: "string" } },
            hour: { type: ["array", "string"], items: { type: "string" } },
            weekday: { type: ["array", "string"], items: { type: "string" } },
            partyBucket: { type: ["array", "string"], items: { type: "string" } },
            completed: { type: ["boolean", "string", "number"] },
            noShow: { type: ["boolean", "string", "number"] },
            cancelled: { type: ["boolean", "string", "number"] },
            pending: { type: ["boolean", "string", "number"] },
            minPartySize: { type: ["integer", "string"], minimum: 1 },
            maxPartySize: { type: ["integer", "string"], minimum: 1 },
          },
        },
      },
    },
  },
  {
    name: "customer_lookup",
    method: "POST",
    path: "/tools/customers/lookup",
    description:
      "Busqueda interna de clientes con PII por telefono, email o nombre. Devuelve contacto, metricas, preferencias e historial opcional desde reservas Precompro.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        phone: { type: ["string", "number"] },
        email: { type: "string" },
        name: { type: "string" },
        from: {
          type: "string",
          description:
            "Fecha inicial opcional en YYYY-MM-DD. Si se envia, tambien debe enviarse to.",
        },
        to: {
          type: "string",
          description:
            "Fecha final opcional en YYYY-MM-DD. Si no se envia rango, lookup usa una ventana reciente por defecto.",
        },
        includeCancelled: { type: ["boolean", "string", "number"], default: true },
        includeReservations: { type: ["boolean", "string", "number"], default: true },
        outputFormat: { type: "string", enum: ["json", "csv"], default: "json" },
        limit: {
          type: ["integer", "string"],
          minimum: 1,
          maximum: 5000,
          default: 100,
        },
        cursor: { type: ["string", "number"] },
      },
    },
  },
  {
    name: "customer_segment",
    method: "POST",
    path: "/tools/customers/segment",
    description:
      "Segmentacion interna de clientes con PII para insumos de marketing. Escanea reservas por rango, deduplica por telefono/email/documento y devuelve JSON o CSV paginado.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "Fecha inicial en YYYY-MM-DD." },
        to: {
          type: "string",
          description:
            "Fecha final en YYYY-MM-DD. Sin limite duro de rango; usar paginacion para bases grandes.",
        },
        includeCancelled: { type: ["boolean", "string", "number"], default: true },
        includeReservations: {
          type: ["boolean", "string", "number"],
          default: false,
          description: "Incluye historial resumido de reservas por cliente.",
        },
        includeRawReservations: {
          type: ["boolean", "string", "number"],
          default: false,
          description:
            "Si includeReservations=true, devuelve mas campos por reserva, incluyendo comentarios.",
        },
        outputFormat: { type: "string", enum: ["json", "csv"], default: "json" },
        limit: {
          type: ["integer", "string"],
          minimum: 1,
          maximum: 5000,
          default: 100,
        },
        cursor: {
          type: ["string", "number"],
          description: "Cursor devuelto en pagination.nextCursor para traer la siguiente pagina.",
        },
        sortBy: {
          type: "string",
          enum: [
            "lastReservationDate",
            "firstReservationDate",
            "totalReservations",
            "completedReservations",
            "cancelledReservations",
            "noShowReservations",
            "completedPeople",
            "totalPeople",
            "displayName",
          ],
          default: "lastReservationDate",
        },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        criteria: {
          type: "object",
          additionalProperties: false,
          description:
            "Filtros de segmentacion. Ej: minCancelledReservations=1 o minTotalReservations=10.",
          properties: {
            minTotalReservations: { type: ["integer", "string"], minimum: 0 },
            maxTotalReservations: { type: ["integer", "string"], minimum: 0 },
            minCompletedReservations: { type: ["integer", "string"], minimum: 0 },
            minCancelledReservations: { type: ["integer", "string"], minimum: 0 },
            minNoShowReservations: { type: ["integer", "string"], minimum: 0 },
            minPendingReservations: { type: ["integer", "string"], minimum: 0 },
            minTotalPeople: { type: ["integer", "string"], minimum: 0 },
            minCompletedPeople: { type: ["integer", "string"], minimum: 0 },
            minCancelledPeople: { type: ["integer", "string"], minimum: 0 },
            minNoShowPeople: { type: ["integer", "string"], minimum: 0 },
            minCancellationRate: { type: ["number", "string"], minimum: 0, maximum: 1 },
            maxCancellationRate: { type: ["number", "string"], minimum: 0, maximum: 1 },
            minNoShowRate: { type: ["number", "string"], minimum: 0, maximum: 1 },
            maxNoShowRate: { type: ["number", "string"], minimum: 0, maximum: 1 },
            hasEmail: { type: ["boolean", "string", "number"] },
            hasPhone: { type: ["boolean", "string", "number"] },
            hasCancelled: { type: ["boolean", "string", "number"] },
            hasNoShow: { type: ["boolean", "string", "number"] },
            hasCompleted: { type: ["boolean", "string", "number"] },
            hasPending: { type: ["boolean", "string", "number"] },
            sectionName: { type: ["array", "string"], items: { type: "string" } },
            tableName: { type: ["array", "string"], items: { type: "string" } },
            source: { type: ["array", "string"], items: { type: "string" } },
            provider: { type: ["array", "string"], items: { type: "string" } },
            typeReservation: { type: ["array", "string"], items: { type: "string" } },
            paymentType: { type: ["array", "string"], items: { type: "string" } },
            reservationHour: { type: ["array", "string"], items: { type: "string" } },
            hour: { type: ["array", "string"], items: { type: "string" } },
            weekday: { type: ["array", "string"], items: { type: "string" } },
            partyBucket: { type: ["array", "string"], items: { type: "string" } },
            occasion: { type: ["array", "string"], items: { type: "string" } },
            preferredZoneName: { type: ["array", "string"], items: { type: "string" } },
            nameContains: { type: "string" },
            commentsContains: { type: "string" },
            lastReservationBefore: { type: "string" },
            lastReservationAfter: { type: "string" },
            firstReservationBefore: { type: "string" },
            firstReservationAfter: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "customer_export",
    method: "POST",
    path: "/tools/customers/export",
    description:
      "Alias interno de customer_segment orientado a CSV. Usar cuando el usuario pida base de datos, lista o export para montar campañas en otra herramienta.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: true,
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        criteria: { type: "object" },
        limit: { type: ["integer", "string"], minimum: 1, maximum: 5000 },
        cursor: { type: ["string", "number"] },
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
