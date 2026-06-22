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
import { buildComments } from "../utils/comments.js";

const zoneSchema = z.preprocess(
  normalizeZoneInput,
  z
    .object({
      id: z.number().int().positive().optional(),
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
  return {
    id: reservation.id_reservation || reservation.reservationId,
    displayName: reservation.displayName,
    phone: String(reservation.phone || ""),
    people: Number(reservation.people),
    dateEpochMs: Number(reservation.date),
    date: reservation.fecha || reservation.fechaCompleta?.slice(0, 10),
    dateTime: reservation.fechaCompleta,
    status: reservation.status,
    isUserConfirmed: reservation.isUserConfirmed || null,
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
  return Boolean(reservation.isCancelled) || reservation.status === "Cancelada";
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
