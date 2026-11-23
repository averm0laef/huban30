"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Textarea,
} from "@fluentui/react-components";
import { ArrowClockwise20Regular, Save20Regular } from "@fluentui/react-icons";

import { api } from "../api";
import { formatDate, formatSchedule, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";
import { OneCExchangeRuns } from "./one-c-exchange-runs";
import { OneCRejectedRequests } from "./one-c-rejected-requests";
import { PartsFinderStatusCard } from "./parts-finder-status";

interface OneCExchangeSummary {
  containsOnlyChanges: boolean;
  filename: string;
  imagesAttached?: number;
  imagesSkipped?: number;
  hidingSkipped?: boolean;
  productsHidden?: number;
  kind: "catalog" | "offers";
  rowsRejected: number;
  rowsTouched: number;
  // Optional: a summary written before this field existed (an older
  // completed run, still sitting in app.integration_endpoints) will not have
  // it -- see LastExchangeResult's rendering below.
  rowsUncategorized?: number;
}

interface OneCSettings {
  displayName: string;
  expectedSyncMinutes: number;
  lastCatalogExchangeAt: string | null;
  lastOffersExchangeAt: string | null;
  freshness: "disabled" | "never" | "stale" | "current";
  allowedNetworks: string[];
  enabled: boolean;
  hasPassword: boolean;
  lastExchangeAt: string | null;
  lastExchangeSummary: OneCExchangeSummary | Record<string, never>;
  /** Show the 1С «Описание» of a product on its page (off by default: it often holds internal notes). */
  publishDescriptions: boolean;
  updatedAt: string | null;
  username: string | null;
}

const EXCHANGE_KIND_LABELS: Record<OneCExchangeSummary["kind"], string> = {
  catalog: "Товары и разделы",
  offers: "Цены и остатки",
};

const FRESHNESS_HINTS: Record<OneCSettings["freshness"], string> = {
  current: "Цены и остатки приходят вовремя.",
  stale: "Цены и остатки не обновлялись дольше двух ожидаемых интервалов: витрина показывает данные последнего обмена. Сотрудникам ушло оповещение в Telegram или VK, если они подключены. Проверьте, что в 1С включено регламентное задание обмена, компьютер с 1С работает, а в журнале и в «Отказах на входе» ниже нет ошибок.",
  never: "От этой базы ещё не приходили цены и остатки. Запустите обмен в 1С и проверьте журнал ниже.",
  disabled: "Обмен выключен: сайт не принимает данные от этой базы. Включите переключатель и сохраните.",
};

// The page is several screens long: a short list of its blocks at the top, each a link to its place.
const PAGE_CONTENTS = [
  { id: "settings-connection", label: "Подключение 1С" },
  { id: "settings-last-exchange", label: "Последний обмен" },
  { id: "settings-exchange-log", label: "Журнал обменов" },
  { id: "settings-rejected", label: "Отказы на входе" },
  { id: "settings-parts-finder", label: "Подбор и поставщики" },
] as const;

/**
 * Scrolls to a block without adding a history entry: with unsaved edits «Назад» is guarded by a «leave the
 * page?» question, and a jump inside the page must not be what it asks about.
 */
function jumpTo(event: { preventDefault(): void }, id: string): void {
  const block = document.getElementById(id);
  if (!block) return;
  event.preventDefault();
  block.scrollIntoView();
}

type Source = "one_c" | "one_c_secondary";
export function SettingsView() {
  const [source,setSource] = useState<Source>("one_c");
  return <OneCSettingsForm key={source} source={source} onSourceChange={setSource} />;
}

function OneCSettingsForm({source,onSourceChange}:{source:Source;onSourceChange:(source:Source)=>void}) {
  const settingsPath=`/catalog/1c/settings?source=${source}`;
  const resource = useResource(() => api<OneCSettings>(settingsPath), [source]);
  const [displayName,setDisplayName]=useState("");
  const [expectedSyncMinutes,setExpectedSyncMinutes]=useState("1440");
  const [enabled, setEnabled] = useState(false);
  const [publishDescriptions, setPublishDescriptions] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [networks, setNetworks] = useState("");
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const saving=useRef(false);
  // Caddy is the only public entry point (see docs/ONE_C_INTEGRATION.md) and
  // routes /api on the same origin as this admin page, so the URL 1C needs
  // is just this page's own origin plus the exchange path -- computed on the
  // client rather than baked into the API response, since the server has no
  // reliable notion of "the URL the browser is actually on".
  const [exchangeUrl, setExchangeUrl] = useState("");
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    const nextNetworks = resource.data.allowedNetworks.join("\n");
    setDisplayName(resource.data.displayName);
    setExpectedSyncMinutes(String(resource.data.expectedSyncMinutes));
    setEnabled(resource.data.enabled);
    setPublishDescriptions(resource.data.publishDescriptions);
    setUsername(resource.data.username ?? "");
    setNetworks(nextNetworks);
    setPassword("");
    setBaseline(JSON.stringify({ enabled: resource.data.enabled, networks: nextNetworks, username: resource.data.username ?? "",displayName:resource.data.displayName,expectedSyncMinutes:String(resource.data.expectedSyncMinutes),publishDescriptions:resource.data.publishDescriptions }));
  }, [resource.data]);

  useEffect(() => {
    setExchangeUrl(`${window.location.origin}/api/v1/integrations/1c/exchange${source === "one_c_secondary" ? "/secondary":""}`);
  }, [source]);

  const current = JSON.stringify({ enabled, networks, username,displayName,expectedSyncMinutes,publishDescriptions });
  const dirty = current !== baseline || password.length > 0;
  // Mirrors the API's rule so the button explains itself instead of failing
  // with a generic "некорректные настройки" after the click.
  const passwordTooShort = password.length > 0 && password.length < 16;
  const missingForEnable = enabled && resource.data
    ? [!username.trim() ? "имя пользователя" : "", !resource.data.hasPassword && !password ? "пароль" : "", !networks.trim() ? "разрешённые сети" : ""].filter(Boolean)
    : [];

  useEffect(() => {
    if (!dirty) return;
    let confirmingHistory = false;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      // A jump to a block of this same page leaves the form and its edits where they are.
      if (link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("Есть несохранённые изменения. Уйти со страницы без сохранения?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const guardHistory = () => {
      if (confirmingHistory) return;
      if (!window.confirm("Есть несохранённые изменения. Уйти со страницы без сохранения?")) {
        confirmingHistory = true;
        window.history.forward();
        window.setTimeout(() => { confirmingHistory = false; }, 0);
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("popstate", guardHistory);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("popstate", guardHistory);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [dirty]);

  function reload(): void {
    if(saving.current) return;
    if (!dirty || window.confirm("Отменить несохранённые изменения и перечитать настройки?")) {
      resource.reload();
    }
  }

  async function save(): Promise<void> {
    if(saving.current) return;
    saving.current=true;
    setBusy(true);
    setMutationError(null);
    setSuccess("");
    try {
      const updated = await api<OneCSettings>(settingsPath, {
        body: JSON.stringify({
          allowedNetworks: networks.split(/\s+/u).map((value) => value.trim()).filter(Boolean),
          enabled,displayName:displayName.trim(),expectedSyncMinutes:Number(expectedSyncMinutes),
          ...(password ? { password } : {}),
          publishDescriptions,
          username: username.trim(),
        }),
        method: "PUT",
      });
      setPassword("");
      setBaseline(JSON.stringify({ enabled: updated.enabled, networks: updated.allowedNetworks.join("\n"), username: updated.username ?? "",displayName:updated.displayName,expectedSyncMinutes:String(updated.expectedSyncMinutes),publishDescriptions:updated.publishDescriptions }));
      setDisplayName(updated.displayName);setExpectedSyncMinutes(String(updated.expectedSyncMinutes));
      setNetworks(updated.allowedNetworks.join("\n"));
      setUsername(updated.username ?? "");
      setEnabled(updated.enabled);
      setPublishDescriptions(updated.publishDescriptions);
      setSuccess("Настройки 1С сохранены. Пароль больше не отображается.");
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      saving.current=false;
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        actions={<Button disabled={busy} icon={<ArrowClockwise20Regular />} onClick={reload}>Перечитать</Button>}
        description="Здесь задаётся, как каждая база 1С передаёт на сайт товары, цены и остатки. Пароль после сохранения больше нигде не показывается — даже здесь."
        eyebrow="Конфигурация"
        title="Настройки интеграций"
      />
      <nav aria-label="На этой странице" className={styles.pageContents}>
        <span>На странице:</span>
        {PAGE_CONTENTS.map((item) => <a href={`#${item.id}`} key={item.id} onClick={(event) => jumpTo(event, item.id)}>{item.label}</a>)}
      </nav>
      <div className={styles.toolbar} aria-label="Базы 1С">
        {(["one_c","one_c_secondary"] as const).map(value=><Button key={value} appearance={source===value ? "primary":"secondary"} aria-pressed={source===value} disabled={busy} onClick={()=>{
          if(source!==value && (!dirty || window.confirm("Есть несохранённые настройки. Переключить базу без сохранения?"))) onSourceChange(value);
        }}>{value === "one_c" ? "Основная база":"Дополнительная база"}</Button>)}
      </div>
      <MessageBar intent="info"><MessageBarBody>У каждой базы 1С свой адрес, логин и пароль. Если один и тот же артикул есть в обеих базах, на сайте будут две отдельные карточки со своими ценами и остатками — автоматически они не объединяются.</MessageBarBody></MessageBar>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading && !resource.data ? <div className={styles.loadingPanel}><Spinner label="Загрузка настроек" /></div> : null}
      {resource.data ? (
        <form className={`${styles.settingsForm} ${styles.settingsAnchor}`} id="settings-connection" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className={styles.settingsHeading}>
            <div><h2>{resource.data.displayName}</h2><p>1С подключается к сайту по логину и паролю ниже и только с адресов из списка «Разрешённые сети». Пока переключатель выключен, сайт не принимает данные от этой базы.</p></div>
            <Switch checked={enabled} label={enabled ? "Включено" : "Выключено"} onChange={(_event, data) => setEnabled(data.checked)} disabled={busy} />
          </div>
          <Field label="Название базы" required><Input value={displayName} onChange={(_event,data)=>setDisplayName(data.value)} maxLength={120} disabled={busy}/></Field>
          <Field label="Ожидаемый интервал обновления остатков, минут" hint="То же, что в расписании обмена в 1С: 1440 — раз в сутки. Обмен запускает 1С; сайт по этому числу следит, что он пришёл, и оповещает сотрудников, если его нет дольше двух интервалов."><Input type="number" min={5} max={10080} value={expectedSyncMinutes} onChange={(_event,data)=>setExpectedSyncMinutes(data.value)} disabled={busy}/></Field>
          <Badge appearance="tint" color={resource.data.freshness === "current" ? "success":resource.data.freshness === "stale" ? "warning":"informative"}>{resource.data.freshness === "current" ? "Обновления приходят":resource.data.freshness === "stale" ? "Обновление задерживается":resource.data.freshness === "disabled" ? "Обмен выключен":"Цены и остатки ещё не приходили"}</Badge>
          <p className={styles.muted}>{FRESHNESS_HINTS[resource.data.freshness]}</p>
          <dl className={styles.detailList}><div><dt>Каталог и категории</dt><dd>{formatDate(resource.data.lastCatalogExchangeAt)}</dd></div><div><dt>Цены и остатки</dt><dd>{formatDate(resource.data.lastOffersExchangeAt)}</dd></div></dl>
          <Field
            hint="В 1С: Администрирование → Настройка синхронизации данных → Обмен с сайтом → в узле этой базы вставьте этот адрес. Нажмите на поле, чтобы выделить адрес и скопировать."
            label="Адрес обмена для 1С"
          >
            <Input readOnly value={exchangeUrl} onClick={(event) => event.currentTarget.select()} />
          </Field>
          <section aria-labelledby={`one-c-checklist-${source}`}>
            <h3 id={`one-c-checklist-${source}`}>Что указать в узле обмена этой базы 1С</h3>
            <dl className={styles.detailList}>
              <div><dt>Адрес сайта</dt><dd>{exchangeUrl || "—"}</dd></div>
              <div><dt>Пользователь</dt><dd>{resource.data.username ?? "сначала задайте и сохраните ниже"}</dd></div>
              <div><dt>Пароль</dt><dd>{resource.data.hasPassword ? "тот, что сохранён здесь (сайт его не показывает; забыли — задайте новый)" : "задайте ниже, не короче 16 символов"}</dd></div>
              <div><dt>Что выгружать</dt><dd>товары с картинками, цены и остатки; выгрузку заказов не включайте — сайт её не принимает</dd></div>
              <div><dt>Сжатие</dt><dd>не включайте сжатие архивом; размер частей файла 1С узнаёт от сайта сама</dd></div>
              <div><dt>Расписание</dt><dd>первый раз полная выгрузка, затем обмен {formatSchedule(resource.data.expectedSyncMinutes)}</dd></div>
              <div><dt>Доступ</dt><dd>внешний IP компьютера или сервера, где работает 1С, должен быть в «Разрешённых сетях»</dd></div>
            </dl>
          </section>
          <Field label="Имя пользователя" required>
            <Input autoComplete="off" disabled={busy} onChange={(_event, data) => setUsername(data.value)} value={username} />
          </Field>
          <Field
            hint={resource.data.hasPassword ? "Пароль сохранён. Оставьте поле пустым, чтобы не менять его." : "Требуется не менее 16 символов."}
            label="Новый пароль"
            validationMessage={passwordTooShort ? `Ещё ${16 - password.length} симв.: пароль 1С должен быть не короче 16 символов.` : undefined}
          >
            <Input autoComplete="new-password" disabled={busy} onChange={(_event, data) => setPassword(data.value)} type="password" value={password} />
          </Field>
          <Field hint="Внешний IP-адрес компьютера или сервера с 1С, по одному на строку, в виде 203.0.113.10/32 (/32 — ровно этот адрес). Узнать адрес можно у вашего системного администратора или провайдера." label="Разрешённые сети" required>
            <Textarea disabled={busy} onChange={(_event, data) => setNetworks(data.value)} resize="vertical" rows={5} value={networks} />
          </Field>
          <Field
            hint="Выключено: поле «Описание» из 1С на сайт не попадает. Во многих базах в нём внутренние пометки (инвентаризация, номер коробки), а не текст для покупателя. Включайте, только если в этом поле у вас описания товаров. Изменение действует со следующего обмена каталогом."
            label="Описание товара из 1С"
          >
            <Switch
              checked={publishDescriptions}
              disabled={busy}
              label={publishDescriptions ? "Показывать на странице товара" : "Не показывать"}
              onChange={(_event, data) => setPublishDescriptions(data.checked)}
            />
          </Field>
          <div className={styles.formFooter}>
            <span>{missingForEnable.length > 0
              ? `Чтобы включить обмен, заполните: ${missingForEnable.join(", ")}`
              : dirty ? "Есть несохранённые изменения" : `Сохранено ${formatDate(resource.data.updatedAt)}`}</span>
            <Button appearance="primary" disabled={!dirty || busy || passwordTooShort || missingForEnable.length > 0 || !displayName.trim() || Number(expectedSyncMinutes)<5 || Number(expectedSyncMinutes)>10080} icon={<Save20Regular />} type="submit">Сохранить</Button>
          </div>
        </form>
      ) : null}
      {/* The answer to «Сохранить» stays next to the button: below the page's other blocks it was several screens away. */}
      <div aria-live="polite" className={styles.settingsResult}>
        {success ? <MessageBar intent="success"><MessageBarBody>{success}</MessageBarBody></MessageBar> : null}
        {mutationError ? <RequestError error={mutationError} onRetry={reload} /> : null}
      </div>
      {resource.data ? <div className={styles.settingsAnchor} id="settings-last-exchange"><LastExchangeResult summary={resource.data.lastExchangeSummary} timestamp={resource.data.lastExchangeAt} /></div> : null}
      {resource.data ? <div className={styles.settingsAnchor} id="settings-exchange-log"><OneCExchangeRuns key={source} source={source} /></div> : null}
      {resource.data ? <div className={styles.settingsAnchor} id="settings-rejected"><OneCRejectedRequests key={`rejected-${source}`} source={source} /></div> : null}
      <div className={styles.settingsAnchor} id="settings-parts-finder"><PartsFinderStatusCard /></div>
    </>
  );
}

// "kind" in lastExchangeSummary is enough to tell an empty summary ({}, the
// database default before any run has ever completed) apart from a real one
// -- narrower than checking Object.keys().length, and it doubles as the type
// guard the rest of the component needs.
function LastExchangeResult({
  summary,
  timestamp,
}: {
  summary: OneCExchangeSummary | Record<string, never>;
  timestamp: string | null;
}) {
  return (
    <section aria-labelledby="one-c-exchange-result-title" className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id="one-c-exchange-result-title">Последний успешный обмен</h2>
          <p>Последний успешно завершённый файл. Ошибки и прерванные обмены — в журнале ниже.</p>
        </div>
      </div>
      {!("kind" in summary) || !timestamp ? (
        <p className={styles.muted}>От этой базы ещё не приходило ни одного файла. Настройте узел обмена в 1С по подсказкам выше и запустите обмен.</p>
      ) : (
        <dl className={styles.detailList}>
          <div><dt>Что пришло</dt><dd>{EXCHANGE_KIND_LABELS[summary.kind]}</dd></div>
          <div><dt>Тип выгрузки</dt><dd>{summary.containsOnlyChanges ? "Только изменения" : "Полная выгрузка"}</dd></div>
          <div><dt>Изменено записей</dt><dd>{summary.rowsTouched}</dd></div>
          <div><dt>Не принято записей</dt><dd>{summary.rowsRejected}</dd></div>
          {summary.kind === "catalog" && (summary.imagesAttached ?? 0) + (summary.imagesSkipped ?? 0) > 0 ? (
            <div><dt>Фото</dt><dd>{summary.imagesAttached ?? 0} добавлено, {summary.imagesSkipped ?? 0} пропущено</dd></div>
          ) : null}
          {summary.kind === "catalog" ? (
            <div>
              <dt>Без категории</dt>
              <dd>{summary.rowsUncategorized ?? 0}</dd>
            </div>
          ) : null}
          {summary.kind === "catalog" && (summary.productsHidden ?? 0) > 0 ? (
            <div><dt>Снято с витрины</dt><dd>{summary.productsHidden} (их больше нет в выгрузке 1С)</dd></div>
          ) : null}
          {summary.kind === "catalog" && summary.hidingSkipped ? (
            <div><dt>Лишние товары</dt><dd>остались на витрине: в файле меньше половины товаров сайта. Запустите в 1С полную выгрузку каталога.</dd></div>
          ) : null}
          <div><dt>Завершён</dt><dd>{formatDate(timestamp)}</dd></div>
        </dl>
      )}
    </section>
  );
}
