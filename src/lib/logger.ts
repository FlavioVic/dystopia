/**
 * Log estruturado minimalista (sem dependência). Uma linha JSON por evento
 * quando `LOG_FORMAT=json`, legível por humano no resto do tempo — o worker
 * roda fora do Next, então precisa de log próprio.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[configured] ?? LEVELS.info;
}

/**
 * Campo com nome de segredo não chega ao log, nem por engano (log fica na
 * Vercel, em texto, e mais gente lê do que o banco). Só o primeiro nível: quem
 * loga um objeto inteiro escolhe os campos antes.
 */
const SENSITIVE_FIELD = /pass(word)?|senha|secret|token|authorization|cookie|api[-_]?key/i;

function redact(fields?: LogFields): LogFields | undefined {
  if (!fields) return fields;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, SENSITIVE_FIELD.test(key) ? "[omitido]" : value]),
  );
}

function emit(level: LogLevel, scope: string, message: string, rawFields?: LogFields): void {
  if (LEVELS[level] < threshold()) return;
  const fields = redact(rawFields);
  const payload = { level, scope, message, time: new Date().toISOString(), ...fields };

  if (process.env.LOG_FORMAT === "json") {
    console[level === "debug" ? "log" : level](JSON.stringify(payload));
    return;
  }

  const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  console[level === "debug" ? "log" : level](`[${scope}] ${message}${extra}`);
}

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
};

export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => emit("debug", scope, message, fields),
    info: (message, fields) => emit("info", scope, message, fields),
    warn: (message, fields) => emit("warn", scope, message, fields),
    error: (message, fields) => emit("error", scope, message, fields),
    child: (child) => createLogger(`${scope}:${child}`),
  };
}
