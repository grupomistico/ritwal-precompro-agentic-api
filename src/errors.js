export class AppError extends Error {
  constructor(code, message, details = {}, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

export function errorResponse(error) {
  if (error instanceof AppError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    ok: false,
    code: "INTERNAL_ERROR",
    message: "Ocurrió un error procesando la solicitud.",
    details: {},
  };
}
