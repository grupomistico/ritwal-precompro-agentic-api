import { AppError } from "../errors.js";

export class PrecomproClient {
  constructor(config) {
    this.config = config;
  }

  async request(method, url, { body, tolerateHttpError = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.defaults.requestTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          apiKey: this.config.precompro.apiKey,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      const data = parseJson(text);
      const normalized = { ok: response.ok, status: response.status, data };

      if (!response.ok && !tolerateHttpError) {
        throw new AppError(
          "PRECOMPRO_HTTP_ERROR",
          "Precompro rechazó la solicitud.",
          normalized,
          502,
        );
      }

      return normalized;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new AppError(
          "PRECOMPRO_TIMEOUT",
          "Precompro tardó demasiado en responder.",
          {},
          504,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getVendor() {
    return this.request(
      "GET",
      `${this.config.precompro.vendorBase}/ws/vendor/${this.config.precompro.vendorId}`,
    );
  }

  getSections() {
    return this.request(
      "GET",
      `${this.config.precompro.vendorBase}/ws/vendor/${this.config.precompro.vendorId}/sections`,
    );
  }

  getAvailability({ people, date, zone = 0, subzone = 0 }) {
    return this.request(
      "POST",
      `${this.config.precompro.availabilityBase}/availability/ws`,
      {
        body: {
          vendorId: this.config.precompro.vendorId,
          people,
          date,
          zone,
          subzone,
        },
      },
    );
  }

  createReservation(body) {
    return this.request(
      "POST",
      `${this.config.precompro.reservationBase}/reservation/create/${this.config.precompro.vendorId}`,
      { body, tolerateHttpError: true },
    );
  }

  updateReservation(id, body) {
    return this.request(
      "PUT",
      `${this.config.precompro.reservationBase}/reservation/update/${id}`,
      { body, tolerateHttpError: true },
    );
  }

  cancelReservation(id) {
    return this.request(
      "PUT",
      `${this.config.precompro.reservationBase}/reservation/cancel/${id}`,
      { tolerateHttpError: true },
    );
  }

  confirmReservation(id) {
    return this.request(
      "PUT",
      `${this.config.precompro.reservationBase}/reservation/confirm/${id}`,
      { tolerateHttpError: true },
    );
  }

  listReservations({ phone, date }) {
    const body = {
      vendorId: this.config.precompro.vendorId,
      ...(phone ? { phone: Number(phone) } : {}),
      ...(date ? { date } : {}),
    };
    return this.request(
      "POST",
      `${this.config.precompro.reservationBase}/reservation/list`,
      { body },
    );
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
