// What the owner is told about a request from 1С that the site turned away.
//
// 1С shows «ошибка авторизации» whatever happened, and the site answers a turned-away request with the same bare
// failure on purpose. The cause is kept in the site's request journal (app.integration_request_log, written by
// one-c-integration.service.ts and one-c-exchange.controller.ts); these lines turn it into what to put right.

export interface RejectedRequest {
  createdAt: string;
  details: Record<string, unknown>;
  id: string;
  /** As PostgreSQL prints an inet: «203.0.113.9/32» — the form the «Разрешённые сети» field takes. */
  ipAddress: string | null;
  operation: string;
  statusCode: number;
}

const STEP_LABELS: Record<string, string> = {
  checkauth: "вход",
  file: "передача файла",
  import: "загрузка данных",
  init: "начало обмена",
};

/** «203.0.113.9/32» → «203.0.113.9»: the mask of a single address says nothing to a reader. */
export function plainAddress(ipAddress: string | null): string {
  return ipAddress ? ipAddress.replace(/\/(?:32|128)$/u, "") : "не записан";
}

/** The address with the mask of exactly that address, ready for the «Разрешённые сети» field. */
function networkOf(ipAddress: string | null): string | null {
  if (!ipAddress) return null;
  return ipAddress.includes("/") ? ipAddress : `${ipAddress}/${ipAddress.includes(":") ? 128 : 32}`;
}

function cause(request: RejectedRequest): { todo: string; what: string } {
  const { outcome, reason, session } = request.details;
  if (request.statusCode !== 401 && request.statusCode !== 429) {
    return {
      todo: `Сайт впустил запрос и ответил кодом ${request.statusCode}: это не отказ на входе. Передайте время и код администратору сайта.`,
      what: "Запрос принят, но не выполнен",
    };
  }
  if (outcome === "rate_limited" || request.statusCode === 429) {
    return {
      todo: "Сайт минуту не отвечал этому адресу. Если это ваша 1С, запустите обмен ещё раз через минуту; если повторяется — сообщите администратору сайта.",
      what: "Слишком много обращений подряд",
    };
  }
  if (reason === "address_not_allowed") {
    const network = networkOf(request.ipAddress);
    return {
      todo: network
        ? `Если это ваша 1С, добавьте ${network} в поле «Разрешённые сети» и сохраните. Если адрес вам незнаком, ничего не делайте: такие запросы сайт не принимает.`
        : "Адрес запроса не записан. Узнайте внешний адрес 1С и добавьте его в поле «Разрешённые сети».",
      what: "Адрес не входит в «Разрешённые сети»",
    };
  }
  if (reason === "wrong_credentials") {
    return {
      todo: "Проверьте имя пользователя и пароль в настройках обмена в 1С: они должны совпадать с заданными здесь. Пароль можно задать заново в поле «Новый пароль».",
      what: "Неверное имя пользователя или пароль",
    };
  }
  if (reason === "disabled") {
    return {
      todo: "Включите переключатель в начале этой страницы и сохраните: пока он выключен, сайт не принимает обмен.",
      what: "Обмен с этой базой выключен",
    };
  }
  if (reason === "not_configured") {
    return {
      todo: "Заполните имя пользователя и пароль на этой странице, сохраните и укажите их же в настройках обмена в 1С.",
      what: "На сайте не заданы имя пользователя и пароль обмена",
    };
  }
  if (reason === "no_credentials" && session === "not_accepted") {
    return {
      todo: "1С начала обмен, а этот запрос пришёл с другого адреса, после изменения настроек или позже двух часов от начала. Запустите обмен в 1С заново. Если повторяется, значит 1С обращается с нескольких адресов: добавьте в «Разрешённые сети» каждый адрес из этого списка.",
      what: "Сеанс обмена не принят",
    };
  }
  if (reason === "no_credentials") {
    return {
      todo: "Так приходят проверки соединения и посторонние запросы. Если при этом не проходит обмен из 1С, проверьте, что в его настройках заполнены имя пользователя и пароль.",
      what: "Запрос без имени пользователя и пароля",
    };
  }
  return {
    todo: typeof reason === "string"
      ? `Причина записана как «${reason}», эта страница её не знает. Сообщите администратору сайта.`
      : "Причина не сохранена: запись сделана до того, как сайт начал записывать причины отказа.",
    what: "Вход не принят",
  };
}

/** What happened and what to do about it, for one line of the journal. */
export function rejectionText(request: RejectedRequest): { todo: string; what: string } {
  const { todo, what } = cause(request);
  const step = request.operation === "exchange_request" && typeof request.details.step === "string"
    ? STEP_LABELS[request.details.step] : undefined;
  return { todo, what: step ? `${what} — на шаге «${step}»` : what };
}
