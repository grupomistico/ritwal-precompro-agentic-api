import { z } from "zod";
import { AppError } from "../errors.js";
import {
  assertIsoDate,
  assertTime,
  bogotaDateTimeToEpochMs,
  epochMsToPrecomproDateTime,
  isPastBogotaDate,
  normalizeDateInput,
  normalizeTimeInput,
} from "../utils/datetime.js";
import { normalizeCountryCode, normalizePhone } from "../utils/phone.js";
import { buildComments, parseComments } from "../utils/comments.js";

const REPORT_GROUP_BY_VALUES = [
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
];

const reportGroupBySchema = z.enum(REPORT_GROUP_BY_VALUES);
const stringArraySchema = z.preprocess(
  normalizeStringArrayInput,
  z.array(z.string()).optional(),
);

const zoneSchema = z.preprocess(
  normalizeZoneInput,
  z
    .object({
      id: z.number().int().nonnegative().optional(),
      name: z.string().optional(),
    })
    .optional(),
);

export const availabilitySchema = z.object({
  date: z.preprocess(normalizeDateInput, z.string()),
  time: z.preprocess(normalizeTimeInput, z.string().optional()),
  partySize: z.coerce.number().int().positive(),
  zone: zoneSchema,
  subzone: z.coerce.number().int().min(0).optional().default(0),
});

export const createReservationSchema = z.object({
  displayName: z.string().trim().min(2),
  phone: z.string().or(z.number()),
  countryCode: z.string().or(z.number()).optional(),
  email: z.string().email().optional(),
  date: z.preprocess(normalizeDateInput, z.string()),
  time: z.preprocess(normalizeTimeInput, z.string()),
  partySize: z.coerce.number().int().positive(),
  zone: zoneSchema,
  subzone: z.coerce.number().int().min(0).optional().default(0),
  comments: z.string().optional(),
  allergies: z.string().optional(),
  occasion: z.string().optional(),
  requirements: z.string().optional(),
  pet: z.string().optional(),
  preferredZoneName: z.string().optional(),
  partyComposition: z.string().optional(),
  birthday: z.string().optional(),
  celebrationComment: z.string().optional(),
  restaurantComment: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const searchReservationsSchema = z.object({
  phone: z.string().or(z.number()),
});

export const listReservationsByDateSchema = z.object({
  date: z.preprocess(normalizeDateInput, z.string()),
  includeCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
});

export const listReservationsRangeSchema = z.object({
  from: z.preprocess(normalizeDateInput, z.string()),
  to: z.preprocess(normalizeDateInput, z.string()),
  includeCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
  includeReservations: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
});

export const reservationReportSchema = z.object({
  from: z.preprocess(normalizeDateInput, z.string()),
  to: z.preprocess(normalizeDateInput, z.string()),
  includeCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
  groupBy: z
    .preprocess(normalizeStringArrayInput, z.array(reportGroupBySchema).max(4))
    .optional()
    .default(["date"]),
  filters: z
    .object({
      status: stringArraySchema,
      lifecycle: stringArraySchema,
      sectionName: stringArraySchema,
      tableName: stringArraySchema,
      source: stringArraySchema,
      provider: stringArraySchema,
      typeReservation: stringArraySchema,
      paymentType: stringArraySchema,
      reservationHour: stringArraySchema,
      hour: stringArraySchema,
      weekday: stringArraySchema,
      partyBucket: stringArraySchema,
      completed: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
      noShow: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
      cancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
      pending: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
      minPartySize: z.coerce.number().int().positive().optional(),
      maxPartySize: z.coerce.number().int().positive().optional(),
    })
    .strict()
    .optional()
    .default({}),
});

export const updateReservationSchema = z.object({
  reservationId: z.string().min(10),
  phone: z.string().or(z.number()),
  displayName: z.string().trim().min(2).optional(),
  phoneNew: z.string().or(z.number()).optional(),
  countryCode: z.string().or(z.number()).optional(),
  email: z.string().email().optional(),
  date: z.preprocess(normalizeDateInput, z.string().optional()),
  time: z.preprocess(normalizeTimeInput, z.string().optional()),
  partySize: z.coerce.number().int().positive().optional(),
  zone: zoneSchema,
  subzone: z.coerce.number().int().min(0).optional().default(0),
  comments: z.string().optional(),
  allergies: z.string().optional(),
  occasion: z.string().optional(),
  requirements: z.string().optional(),
  pet: z.string().optional(),
  preferredZoneName: z.string().optional(),
  partyComposition: z.string().optional(),
  birthday: z.string().optional(),
  celebrationComment: z.string().optional(),
  restaurantComment: z.string().optional(),
});

export const reservationIdSchema = z.object({
  reservationId: z.string().min(10),
  phone: z.string().or(z.number()).optional(),
});

export class ReservationService {
  constructor({ client, config, lock, idempotency }) {
    this.client = client;
    this.config = config;
    this.lock = lock;
    this.idempotency = idempotency;
  }

  async availability(input) {
    const data = availabilitySchema.parse(input);
    validateDate(data.date);
    validatePartySize(data.partySize);

    if (data.partySize > this.config.defaults.maxAutomaticPartySize) {
      return largePartyResult();
    }

    const response = await this.client.getAvailability({
      people: data.partySize,
      date: data.date,
      zone: data.zone?.id || 0,
      subzone: data.subzone,
    });

    const slots = asArray(response.data).map(normalizeSlot);
    const available = slots.filter((slot) => slot.available);
    const requestedTime = data.time ? normalizeAvailabilityTime(data.time) : null;
    const exactSlot = requestedTime
      ? slots.find((slot) => slot.time === requestedTime) || null
      : null;

    return {
      ok: true,
      code: "AVAILABILITY_FOUND",
      date: data.date,
      requestedTime,
      exactTimeAvailable: requestedTime ? Boolean(exactSlot?.available) : null,
      partySize: data.partySize,
      zone: data.zone || null,
      availableCount: available.length,
      slots,
      message: available.length
        ? "Encontré horarios disponibles."
        : "No encontré horarios disponibles para esos datos.",
    };
  }

  async create(input) {
    const data = createReservationSchema.parse(input);
    validateDate(data.date);
    validateTime(data.time);
    validatePartySize(data.partySize);

    if (data.partySize > this.config.defaults.maxAutomaticPartySize) {
      return largePartyResult();
    }

    const phone = requirePhone(data.phone);
    const countryCode = requireCountryCode(
      data.countryCode,
      this.config.defaults.countryCode,
    );
    const epochMs = bogotaDateTimeToEpochMs(data.date, data.time);
    const idempotencyKey =
      data.idempotencyKey ||
      `create:${this.config.precompro.vendorId}:${phone}:${epochMs}:${data.partySize}`;
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) return cached;

    const lockKey = `create:${this.config.precompro.vendorId}:${phone}:${epochMs}`;
    return this.lock.withLock(lockKey, this.config.defaults.lockTtlMs, async () => {
      const duplicate = await this.findActiveByPhoneAndEpoch(phone, epochMs);
      if (duplicate) {
        const result = {
          ok: true,
          code: "RESERVATION_ALREADY_EXISTS",
          message: "Ya existe una reserva activa para ese teléfono en ese horario.",
          duplicate: true,
          reservation: summarizeReservation(duplicate),
        };
        this.idempotency.set(
          idempotencyKey,
          result,
          this.config.defaults.idempotencyTtlMs,
        );
        return result;
      }

      const slot = await this.requireAvailableSlot({
        date: data.date,
        partySize: data.partySize,
        epochMs,
        zone: data.zone,
        subzone: data.subzone,
      });

      const comments = buildComments({
        comments: data.comments,
        allergies: data.allergies,
        occasion: data.occasion,
        requirements: data.requirements,
        pet: data.pet,
        preferredZoneName: data.preferredZoneName || data.zone?.name,
        partyComposition: data.partyComposition,
      });

      const body = {
        people: data.partySize,
        displayName: data.displayName,
        date: epochMs,
        phone: Number(phone),
        indicative: countryCode,
        ...(data.email ? { email: data.email } : {}),
        ...(comments ? { comments } : {}),
        ...(slot.paymentInfo ? { balancePaid: Number(slot.paymentInfo.total) } : {}),
        ...(data.birthday ? { birthday: data.birthday } : {}),
        ...(data.celebrationComment
          ? { celebrationComment: data.celebrationComment }
          : {}),
        ...(data.restaurantComment ? { commentRestaurant: data.restaurantComment } : {}),
      };

      const response = await this.client.createReservation(body);
      ensurePrecomproSuccess(response, "CREATE_REJECTED");

      const reservation = response.data?.reservation;
      if (!reservation?.id_reservation) {
        throw new AppError(
          "CREATE_WITHOUT_ID",
          "Precompro creó la reserva pero no devolvió identificador.",
          response,
          502,
        );
      }

      const result = {
        ok: true,
        code: "RESERVATION_CREATED",
        message: "Reserva creada correctamente.",
        reservation: summarizeCreatedReservation(reservation, response.data),
        payment: reservation.paymentLink
          ? {
              required: true,
              link: reservation.paymentLink,
              limitTime: reservation.limitTime,
              limitTimeFormat: reservation.limitTimeFormat,
            }
          : { required: false },
      };
      this.idempotency.set(
        idempotencyKey,
        result,
        this.config.defaults.idempotencyTtlMs,
      );
      return result;
    });
  }

  async search(input) {
    const data = searchReservationsSchema.parse(input);
    const phone = requirePhone(data.phone);
    const response = await this.client.listReservations({ phone });
    const reservations = asArrayOrData(response.data).map(summarizeReservation);
    return {
      ok: true,
      code: reservations.length ? "RESERVATIONS_FOUND" : "NO_ACTIVE_RESERVATIONS",
      message: reservations.length
        ? "Encontré reservas activas para ese teléfono."
        : "No encontré reservas activas para ese teléfono.",
      reservations,
    };
  }

  async listByDate(input) {
    const data = listReservationsByDateSchema.parse(input);
    validateReportDate(data.date);
    const reservations = await this.getReservationsByDate(data.date, data.includeCancelled);
    const summary = summarizeReservationCollection(reservations);
    return {
      ok: true,
      code: reservations.length ? "RESERVATIONS_BY_DATE_FOUND" : "NO_RESERVATIONS_BY_DATE",
      message: reservations.length
        ? "Encontré reservas para esa fecha."
        : "No encontré reservas para esa fecha.",
      date: data.date,
      includeCancelled: data.includeCancelled,
      summary: {
        date: data.date,
        ...summary,
      },
      reservations,
    };
  }

  async listRange(input) {
    const data = listReservationsRangeSchema.parse(input);
    const dates = validateReportRange(data.from, data.to);
    const reportDays = await this.getReservationReportDays(dates, data.includeCancelled);

    const allReservations = reportDays.flatMap((day) => day.reservations);
    const days = reportDays.map((day) => ({
      date: day.date,
      summary: day.summary,
      ...(data.includeReservations ? { reservations: day.reservations } : {}),
    }));

    return {
      ok: true,
      code: allReservations.length ? "RESERVATIONS_RANGE_FOUND" : "NO_RESERVATIONS_RANGE",
      message: allReservations.length
        ? "Encontré reservas para ese rango."
        : "No encontré reservas para ese rango.",
      from: data.from,
      to: data.to,
      daysCount: dates.length,
      includeCancelled: data.includeCancelled,
      includeReservations: data.includeReservations,
      summary: summarizeReservationCollection(allReservations),
      days,
    };
  }

  async report(input) {
    const data = reservationReportSchema.parse(input);
    const dates = validateReportRange(data.from, data.to);
    const reportDays = await this.getReservationReportDays(dates, data.includeCancelled);
    const filteredDays = reportDays.map((day) => {
      const reservations = filterReservationsForReport(day.reservations, data.filters);
      return {
        date: day.date,
        summary: summarizeReservationCollection(reservations),
        reservations,
      };
    });
    const reservations = filteredDays.flatMap((day) => day.reservations);
    const groups = buildReportGroups(reservations, data.groupBy);

    return {
      ok: true,
      code: reservations.length ? "RESERVATION_REPORT_READY" : "NO_RESERVATION_REPORT_DATA",
      message: reservations.length
        ? "Reporte de reservas listo."
        : "No encontré reservas para ese reporte.",
      from: data.from,
      to: data.to,
      daysCount: dates.length,
      includeCancelled: data.includeCancelled,
      groupBy: data.groupBy,
      filters: normalizeReportFiltersForOutput(data.filters),
      summary: summarizeReservationCollection(reservations),
      groups,
      days: filteredDays.map((day) => ({
        date: day.date,
        summary: day.summary,
      })),
    };
  }

  async update(input) {
    const data = updateReservationSchema.parse(input);
    const phone = requirePhone(data.phone);
    const current = await this.findActiveByPhoneAndId(phone, data.reservationId);
    if (!current) {
      return {
        ok: false,
        code: "RESERVATION_NOT_FOUND",
        message: "No encontré una reserva activa con esos datos.",
      };
    }

    const hydrated = await this.hydrateFromDateList(current);
    const targetDate = data.date || hydrated.fecha;
    const targetTime =
      data.time || hydrated.fechaCompleta?.slice(11, 16) || current.fechaCompleta?.slice(11, 16);
    const targetPartySize = data.partySize || Number(hydrated.people || current.people);
    validateDate(targetDate);
    validateTime(targetTime);
    validatePartySize(targetPartySize);

    if (targetPartySize > this.config.defaults.maxAutomaticPartySize) {
      return largePartyResult();
    }

    const targetEpochMs = bogotaDateTimeToEpochMs(targetDate, targetTime);
    await this.requireAvailableSlot({
      date: targetDate,
      partySize: targetPartySize,
      epochMs: targetEpochMs,
      zone: data.zone,
      subzone: data.subzone,
    });

    const newPhone = data.phoneNew ? requirePhone(data.phoneNew) : phone;
    const countryCode = requireCountryCode(
      data.countryCode || hydrated.indicativo,
      this.config.defaults.countryCode,
    );
    const comments =
      buildComments({
        comments: data.comments ?? hydrated.comments,
        allergies: data.allergies,
        occasion: data.occasion,
        requirements: data.requirements,
        pet: data.pet,
        preferredZoneName: data.preferredZoneName || data.zone?.name,
        partyComposition: data.partyComposition,
      }) || hydrated.comments;

    const response = await this.client.updateReservation(data.reservationId, {
      people: targetPartySize,
      displayName: data.displayName || hydrated.displayName || current.displayName,
      date: targetEpochMs,
      phone: Number(newPhone),
      indicative: countryCode,
      ...(data.email || hydrated.email ? { email: data.email || hydrated.email } : {}),
      ...(comments ? { comments } : {}),
      ...(data.birthday ? { birthday: data.birthday } : {}),
      ...(data.celebrationComment
        ? { celebrationComment: data.celebrationComment }
        : {}),
      ...(data.restaurantComment ? { commentRestaurant: data.restaurantComment } : {}),
    });
    ensurePrecomproSuccess(response, "UPDATE_REJECTED");
    if (response.data?.updateEvent === false) {
      return {
        ok: false,
        code: "UPDATE_NOT_APPLIED",
        message: normalizePrecomproMessage(response.data),
        raw: response.data,
      };
    }

    return {
      ok: true,
      code: "RESERVATION_UPDATED",
      message: "Reserva actualizada correctamente.",
      reservationId: data.reservationId,
      dateTime: epochMsToPrecomproDateTime(targetEpochMs),
    };
  }

  async cancel(input) {
    const data = reservationIdSchema.parse(input);
    if (data.phone) {
      const phone = requirePhone(data.phone);
      const current = await this.findActiveByPhoneAndId(phone, data.reservationId);
      if (!current) {
        return {
          ok: false,
          code: "RESERVATION_NOT_FOUND",
          message: "No encontré una reserva activa con esos datos.",
        };
      }
    }
    const response = await this.client.cancelReservation(data.reservationId);
    if (!response.ok && response.status === 500) {
      return {
        ok: false,
        code: "RESERVATION_NOT_FOUND",
        message: "No encontré esa reserva para cancelar.",
      };
    }
    ensurePrecomproSuccess(response, "CANCEL_REJECTED");
    return {
      ok: true,
      code: "RESERVATION_CANCELLED",
      message: "Reserva cancelada correctamente.",
      reservationId: data.reservationId,
    };
  }

  async confirm(input) {
    const data = reservationIdSchema.parse(input);
    if (data.phone) {
      const phone = requirePhone(data.phone);
      const current = await this.findActiveByPhoneAndId(phone, data.reservationId);
      if (!current) {
        return {
          ok: false,
          code: "RESERVATION_NOT_FOUND",
          message: "No encontré una reserva activa con esos datos.",
        };
      }
    }
    const response = await this.client.confirmReservation(data.reservationId);
    ensurePrecomproSuccess(response, "CONFIRM_REJECTED");
    return {
      ok: true,
      code: "RESERVATION_CONFIRMED",
      message: "Reserva confirmada por el usuario.",
      reservationId: data.reservationId,
    };
  }

  async requireAvailableSlot({ date, partySize, epochMs, zone, subzone = 0 }) {
    const response = await this.client.getAvailability({
      people: partySize,
      date,
      zone: zone?.id || 0,
      subzone,
    });
    const slots = asArray(response.data).map(normalizeSlot);
    const exact = slots.find((slot) => slot.epochMs === epochMs);
    if (!exact || !exact.available) {
      return unavailableResult(slots, zone);
    }
    return exact;
  }

  async findActiveByPhoneAndEpoch(phone, epochMs) {
    const response = await this.client.listReservations({ phone });
    return asArrayOrData(response.data).find((reservation) => {
      return Number(reservation.date) === epochMs && !isCancelled(reservation);
    });
  }

  async findActiveByPhoneAndId(phone, reservationId) {
    const response = await this.client.listReservations({ phone });
    return asArrayOrData(response.data).find((reservation) => {
      return reservation.id_reservation === reservationId && !isCancelled(reservation);
    });
  }

  async hydrateFromDateList(reservation) {
    const date = reservation.fecha || reservation.fechaCompleta?.slice(0, 10);
    if (!date) return reservation;
    const response = await this.client.listReservations({ date });
    return (
      asArrayOrData(response.data).find(
        (item) => item.reservationId === reservation.id_reservation,
      ) || reservation
    );
  }

  async getReservationsByDate(date, includeCancelled = true) {
    const response = await this.client.listReservations({ date });
    return asArrayOrData(response.data)
      .map(summarizeReservation)
      .filter((reservation) => includeCancelled || !reservation.cancelled);
  }

  async getReservationReportDays(dates, includeCancelled = true) {
    return Promise.all(
      dates.map(async (date) => {
        const reservations = await this.getReservationsByDate(date, includeCancelled);
        return {
          date,
          summary: summarizeReservationCollection(reservations),
          reservations,
        };
      }),
    );
  }
}

function largePartyResult() {
  return {
    ok: false,
    code: "ESCALATE_LARGE_PARTY",
    message:
      "Para grupos de 19 personas o más se requiere validación manual del equipo.",
    escalationRequired: true,
  };
}

function unavailableResult(slots, zone) {
  const alternatives = slots
    .filter((slot) => slot.available)
    .slice(0, 6)
    .map((slot) => ({
      dateTime: slot.dateTime,
      time: slot.dateTime.slice(11, 16),
      paymentInfo: slot.paymentInfo,
    }));
  throw new AppError(
    "SLOT_NOT_AVAILABLE",
    zone
      ? "No encontré ese horario disponible en la zona solicitada."
      : "No encontré ese horario disponible.",
    { alternatives },
    409,
  );
}

function validateDate(date) {
  if (!assertIsoDate(date)) {
    throw new AppError(
      "INVALID_DATE",
      "La fecha debe venir en formato YYYY-MM-DD y ser una fecha real.",
      { date },
    );
  }
  if (isPastBogotaDate(date)) {
    throw new AppError("PAST_DATE", "No se pueden hacer reservas en fechas pasadas.", {
      date,
    });
  }
}

function validateReportDate(date) {
  if (!assertIsoDate(date)) {
    throw new AppError(
      "INVALID_DATE",
      "La fecha debe venir en formato YYYY-MM-DD y ser una fecha real.",
      { date },
      400,
    );
  }
}

function validateReportRange(from, to) {
  validateReportDate(from);
  validateReportDate(to);
  if (from > to) {
    throw new AppError(
      "INVALID_DATE_RANGE",
      "La fecha inicial debe ser menor o igual a la fecha final.",
      { from, to },
      400,
    );
  }

  const dates = datesBetween(from, to);
  if (dates.length > 31) {
    throw new AppError(
      "DATE_RANGE_TOO_LARGE",
      "El rango máximo para consultas de reservas es de 31 días.",
      { from, to, days: dates.length },
      400,
    );
  }
  return dates;
}

function validateTime(time) {
  if (!assertTime(time)) {
    throw new AppError("INVALID_TIME", "La hora debe venir en formato HH:mm de 24 horas.", {
      time,
    });
  }
}

function normalizeAvailabilityTime(time) {
  validateTime(time);
  return time;
}

function validatePartySize(partySize) {
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new AppError("INVALID_PARTY_SIZE", "El número de personas debe ser mayor a cero.", {
      partySize,
    });
  }
}

function requirePhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new AppError("INVALID_PHONE", "Necesito un teléfono válido para la reserva.", {
      phone,
    });
  }
  return normalized;
}

function requireCountryCode(countryCode, fallback) {
  const normalized = normalizeCountryCode(countryCode, fallback);
  if (!normalized) {
    throw new AppError("INVALID_COUNTRY_CODE", "El indicativo del país no es válido.", {
      countryCode,
    });
  }
  return normalized;
}

function normalizeZoneInput(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return { id: value };
  if (typeof value === "object") return value;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    return normalizeZoneInput(JSON.parse(trimmed));
  } catch {
    const key = trimmed
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (key.includes("salon")) return { id: 1442, name: "Salón" };
    if (key.includes("templo")) return { id: 1443, name: "Templos" };
    if (/^\d+$/.test(trimmed)) return { id: Number(trimmed) };
    return undefined;
  }
}

function normalizeBooleanInput(value) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const key = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "si", "sí"].includes(key)) return true;
  if (["false", "0", "no"].includes(key)) return false;
  return value;
}

function normalizeStringArrayInput(value) {
  if (value === undefined || value === null || value === "") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringArrayInput(item) || [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return normalizeStringArrayInput(JSON.parse(trimmed));
    } catch {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [String(value).trim()].filter(Boolean);
}

function asArray(data) {
  return Array.isArray(data) ? data : [];
}

function asArrayOrData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeSlot(slot) {
  return {
    epochMs: Number(slot.date),
    dateTime: slot.dateTime,
    time: slot.dateTime?.slice(11, 16),
    available: Boolean(slot.status),
    validation: slot.validation,
    paymentInfo: slot.paymentInfo || null,
  };
}

function summarizeReservation(reservation) {
  const cancelled = isCancelled(reservation);
  const noShow = isNoShow(reservation);
  const completed = isCompleted(reservation);
  const date = reservation.fecha || reservation.fechaCompleta?.slice(0, 10);
  const dateTime = reservation.fechaCompleta;
  const comments = stringOrNull(reservation.comments || reservation.vendorComments);
  const weekday = weekdayFromIsoDate(date);
  return {
    id: reservation.id_reservation || reservation.reservationId,
    displayName: reservation.displayName,
    phone: String(reservation.phone || ""),
    people: Number(reservation.people),
    adult: numberOrNull(reservation.adult),
    boy: numberOrNull(reservation.boy),
    baby: numberOrNull(reservation.baby),
    dateEpochMs: Number(reservation.date),
    date,
    dateTime,
    reservationHour: dateTime?.slice(11, 16) || null,
    weekday: weekday?.name || null,
    weekdayNumber: weekday?.number || null,
    partyBucket: partyBucket(Number(reservation.people)),
    status: reservation.status,
    codeStatus: reservation.codeStatus ?? null,
    cancelled,
    noShow,
    completed,
    isUserConfirmed: reservation.isUserConfirmed || null,
    typeReservation: stringOrNull(reservation.typeReservation),
    source: stringOrNull(
      reservation.source || reservation.originReservation || reservation.provider,
    ),
    provider: stringOrNull(reservation.provider),
    balancePaid: numberOrNull(reservation.balancePaid),
    paymentType: stringOrNull(reservation.paymentType),
    isPaymentLink: numberOrNull(reservation.isPaymentLink),
    tableId: reservation.tableId || reservation.intuiposId || null,
    tableName: stringOrNull(reservation.tableName),
    sectionId: reservation.sectionId || null,
    sectionName: stringOrNull(reservation.sectionName),
    subSectionId: reservation.subSectionId || null,
    subSectionName: stringOrNull(reservation.subSectionName),
    services: Array.isArray(reservation.services) ? reservation.services : [],
    createdAt: stringOrNull(reservation.created_at || reservation.createdAt),
    updatedAt: stringOrNull(reservation.updated_at || reservation.updatedAt),
    createdBy: stringOrNull(reservation.creadoPor || reservation.createdBy),
    seatedBy: stringOrNull(reservation.sentadaPor || reservation.seatedBy),
    confirmedBy: stringOrNull(reservation.confirmadaPor || reservation.confirmedBy),
    finishedBy: stringOrNull(reservation.finalizadaPor || reservation.finishedBy),
    cancelledBy: stringOrNull(reservation.canceladaPor || reservation.cancelledBy),
    noShowBy: stringOrNull(reservation.nollegoPor || reservation.noShowBy),
    comments,
    commentsStructured: parseComments(comments),
  };
}

function summarizeCreatedReservation(reservation, payload = {}) {
  return {
    id: reservation.id_reservation,
    displayName: reservation.displayName,
    phone: reservation.phone ? String(reservation.phone) : "",
    people: Number(reservation.people),
    dateEpochMs: Number(reservation.date),
    date: reservation.fecha,
    dateTime: reservation.fechaCompleta,
    emailStatus: reservation.emailStatus || payload.emailStatus,
  };
}

function isCancelled(reservation) {
  return truthyPrecomproFlag(reservation.isCancelled) || reservation.status === "Cancelada";
}

function isNoShow(reservation) {
  return (
    truthyPrecomproFlag(reservation.isNoshow || reservation.isNoShow) ||
    normalizeStatusKey(reservation.status).includes("no llego")
  );
}

function isCompleted(reservation) {
  return (
    truthyPrecomproFlag(reservation.isFinish || reservation.isFinished) ||
    normalizeStatusKey(reservation.status).includes("finalizada")
  );
}

function normalizeStatusKey(status) {
  return String(status || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function truthyPrecomproFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "si", "sí", "yes"].includes(normalized);
}

function stringOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function partyBucket(people) {
  if (!Number.isFinite(people) || people <= 0) return "unknown";
  if (people <= 2) return "1-2";
  if (people <= 4) return "3-4";
  if (people <= 8) return "5-8";
  return "9+";
}

function weekdayFromIsoDate(date) {
  if (!date || !assertIsoDate(date)) return null;
  const names = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const day = parseIsoDateUtc(date).getUTCDay();
  return {
    name: names[day],
    number: day === 0 ? 7 : day,
  };
}

function summarizeReservationCollection(reservations) {
  const summary = {
    totalReservations: reservations.length,
    activeReservations: 0,
    completedReservations: 0,
    noShowReservations: 0,
    pendingReservations: 0,
    cancelledReservations: 0,
    totalPeople: 0,
    activePeople: 0,
    completedPeople: 0,
    noShowPeople: 0,
    pendingPeople: 0,
    cancelledPeople: 0,
    statusCounts: {},
  };

  for (const reservation of reservations) {
    const people = Number.isFinite(reservation.people) ? reservation.people : 0;
    summary.totalPeople += people;
    const status = reservation.status || "unknown";
    summary.statusCounts[status] = (summary.statusCounts[status] || 0) + 1;
    if (reservation.cancelled) {
      summary.cancelledReservations += 1;
      summary.cancelledPeople += people;
    } else if (reservation.noShow) {
      summary.activeReservations += 1;
      summary.noShowReservations += 1;
      summary.activePeople += people;
      summary.noShowPeople += people;
    } else if (reservation.completed) {
      summary.activeReservations += 1;
      summary.completedReservations += 1;
      summary.activePeople += people;
      summary.completedPeople += people;
    } else {
      summary.activeReservations += 1;
      summary.pendingReservations += 1;
      summary.activePeople += people;
      summary.pendingPeople += people;
    }
  }

  return summary;
}

function buildReportGroups(reservations, groupBy) {
  if (!groupBy.length) return [];

  const groups = new Map();
  for (const reservation of reservations) {
    const key = Object.fromEntries(
      groupBy.map((dimension) => [dimension, reportDimensionValue(reservation, dimension)]),
    );
    const groupKey = JSON.stringify(key);
    const existing = groups.get(groupKey) || {
      key,
      label: groupBy.map((dimension) => `${dimension}: ${key[dimension]}`).join(" | "),
      reservations: [],
    };
    existing.reservations.push(reservation);
    groups.set(groupKey, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      label: group.label,
      summary: summarizeReservationCollection(group.reservations),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function reportDimensionValue(reservation, dimension) {
  if (dimension === "hour" || dimension === "reservationHour") {
    return reservation.reservationHour || "unknown";
  }
  if (dimension === "lifecycle") {
    return reservationLifecycle(reservation);
  }
  if (dimension === "source") {
    return reservation.source || reservation.provider || "unknown";
  }
  const value = reservation[dimension];
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value);
}

function reservationLifecycle(reservation) {
  if (reservation.cancelled) return "cancelled";
  if (reservation.noShow) return "noShow";
  if (reservation.completed) return "completed";
  return "pending";
}

function filterReservationsForReport(reservations, filters = {}) {
  return reservations.filter((reservation) => matchesReportFilters(reservation, filters));
}

function matchesReportFilters(reservation, filters) {
  if (!matchesStringFilter(reservation.status, filters.status)) return false;
  if (!matchesStringFilter(reservationLifecycle(reservation), filters.lifecycle)) return false;
  if (!matchesStringFilter(reservation.sectionName, filters.sectionName)) return false;
  if (!matchesStringFilter(reservation.tableName, filters.tableName)) return false;
  if (!matchesStringFilter(reservation.source || reservation.provider, filters.source)) {
    return false;
  }
  if (!matchesStringFilter(reservation.provider, filters.provider)) return false;
  if (!matchesStringFilter(reservation.typeReservation, filters.typeReservation)) return false;
  if (!matchesStringFilter(reservation.paymentType, filters.paymentType)) return false;
  if (
    !matchesStringFilter(
      reservation.reservationHour,
      filters.reservationHour || filters.hour,
    )
  ) {
    return false;
  }
  if (!matchesStringFilter(reservation.weekday, filters.weekday)) return false;
  if (!matchesStringFilter(reservation.partyBucket, filters.partyBucket)) return false;

  if (filters.completed !== undefined && reservation.completed !== filters.completed) {
    return false;
  }
  if (filters.noShow !== undefined && reservation.noShow !== filters.noShow) return false;
  if (filters.cancelled !== undefined && reservation.cancelled !== filters.cancelled) {
    return false;
  }
  if (filters.pending !== undefined) {
    const pending = !reservation.completed && !reservation.noShow && !reservation.cancelled;
    if (pending !== filters.pending) return false;
  }

  if (filters.minPartySize !== undefined && reservation.people < filters.minPartySize) {
    return false;
  }
  if (filters.maxPartySize !== undefined && reservation.people > filters.maxPartySize) {
    return false;
  }
  return true;
}

function matchesStringFilter(value, allowedValues) {
  if (!allowedValues?.length) return true;
  const normalizedValue = normalizeComparable(value || "unknown");
  return allowedValues.some((allowed) => normalizeComparable(allowed) === normalizedValue);
}

function normalizeComparable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function normalizeReportFiltersForOutput(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined;
    }),
  );
}

function datesBetween(from, to) {
  const dates = [];
  const current = parseIsoDateUtc(from);
  const end = parseIsoDateUtc(to);
  while (current <= end) {
    dates.push(formatIsoDateUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function parseIsoDateUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function ensurePrecomproSuccess(response, fallbackCode) {
  const bodyCode = Number(response.data?.code);
  if (!response.ok || (bodyCode >= 400 && bodyCode !== 0)) {
    throw new AppError(
      fallbackCode,
      normalizePrecomproMessage(response.data),
      { precompro: response },
      response.status >= 500 ? 502 : 400,
    );
  }
}

function normalizePrecomproMessage(data) {
  if (!data) return "Precompro rechazó la solicitud.";
  if (typeof data === "string") return "Precompro rechazó la solicitud.";
  if (typeof data.message === "string") {
    if (data.message.includes("/var/www")) return "No encontré la reserva solicitada.";
    return data.message;
  }
  if (typeof data.msg === "string") return data.msg;
  if (typeof data.message === "object") {
    return Object.values(data.message).flat().join(" ");
  }
  return "Precompro rechazó la solicitud.";
}
