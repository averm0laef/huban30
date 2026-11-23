"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise20Regular, ArrowRight20Regular, Checkmark20Regular, Copy20Regular, Dismiss20Regular, Edit20Regular, Send20Regular } from "@fluentui/react-icons";
import { ROLE_PERMISSIONS, HubPostInputSchema, type Permission, type HubConnectionView, type HubConversationView, type HubJobView, type HubMessageView, type HubPlatform, type HubPostInput, type HubPostView, type HubSecrets } from "@an30/contracts";

import { MESSENGERS } from "../../site-config";
import { api, queryString } from "../api";
import type { SessionView } from "../types";
import { formatDate } from "../workspace-utils";
import styles from "./client-hub.module.css";
import { postIdFromInput, publishedPostUrl, telegramPhotoChange } from "./client-hub-posts";
import { randomUuid } from "../../_lib/browser-crypto";

const PLATFORM: Record<HubPlatform, string> = { telegram: "Telegram", vk: "ВКонтакте", max: "MAX", whatsapp: "WhatsApp" };
const STATE: Record<HubJobView["state"], string> = { queued: "В очереди", sending: "Отправляется", succeeded: "Отправлено", failed: "Ошибка", unknown: "Нужна проверка", manual: "Опубликовать вручную" };
const CONVERSATION_STATE: Record<HubConversationView["state"], string> = { bot: "Автоответ", waiting: "Ждёт менеджера", assigned: "В работе", closed: "Закрыто" };
const ERROR_LABELS: Record<string, string> = {
  provider_result_unknown: "Площадка не подтвердила результат. Проверьте её перед повторной отправкой.",
  worker_interrupted_check_provider: "Отправка прервалась. Проверьте, появился ли пост или ответ на площадке.",
  persistence_result_unknown: "Площадка приняла отправку, но подтверждение не сохранено. Проверьте результат вручную.",
  credentials_missing: "Не хватает токена или ключа. Откройте «Настроить» и вставьте его.",
  bot_paused: "Автоответ остановлен менеджером.",
  whatsapp_reply_window_expired: "Срок ответа WhatsApp истёк. Дождитесь нового сообщения клиента.",
  telegram_photo_cannot_be_removed: "Telegram не позволяет убрать фото из опубликованного сообщения. Сохраните изображение в этой версии.",
  live_delivery_disabled: "Это тестовая копия сайта: настоящие отправки здесь выключены. Они работают на рабочем сайте.",
  vk_photo_preparation_failed: "Не удалось подготовить фото. Используйте публичный HTTPS-адрес JPEG, PNG или GIF до 8 МиБ.",
  vk_photo_upload_rejected: "ВКонтакте отклонил фото. Проверьте файл и права «стена» и «фотографии» у токена администратора.",
  vk_photo_save_rejected: "ВКонтакте не сохранил фото. Проверьте права «стена» и «фотографии» у токена администратора.",
  channel_publish_permission_missing: "Бот не может публиковать в этом канале. Сделайте его администратором канала с правом публикации.",
  https_webhook_and_secret_required: "Сообщения клиентов подключаются только на рабочем сайте с адресом https:// и сохранённым секретным ключом. Откройте «Настроить» и сохраните подключение заново.",
  existing_webhook_requires_confirmation: "Этот бот уже пересылает сообщения на другой сайт или сервис. Если хотите получать их здесь, отметьте «перенести его сообщения на этот сайт» и подключите снова.",
  existing_max_subscription_manage_in_provider: "Этот MAX-бот уже пересылает сообщения в другой сервис. Отметьте перенос сообщений на этот сайт и подключите снова.",
  configure_callback_in_provider_dashboard: "Для этой площадки адрес сайта вставляется в её собственных настройках — см. шаги в окне «Настроить».",
  invalid_vk_community_id: "Проверьте ID сообщества ВКонтакте: для стены нужен отрицательный числовой ID.",
  check_failed: "Не удалось проверить подключение. Попробуйте ещё раз.",
  telegram_photo_cannot_be_added: "Telegram не позволяет добавить фото к уже опубликованному текстовому посту. Уберите изображение или опубликуйте новый пост.",
  provider_rejected_401: "Токен не принят. Скопируйте его заново и сохраните подключение.",
  provider_rejected_403: "Клиент заблокировал бота или запретил ему писать. Ответ не доставлен.",
  provider_rejected_attachment_not_ready: "MAX ещё обрабатывает изображение. Отправка повторится автоматически.",
  webhook_not_connected: "Сообщения клиентов ещё не подключены. Нажмите «Подключить обращения».",
  webhook_points_elsewhere: "Бот отправляет сообщения на другой адрес (другой сайт или сервис). Нажмите «Подключить обращения» и разрешите замену, если обращения нужны здесь.",
  telegram_webhook_delivery_failing: "Telegram не может доставить сообщения на сайт. Проверьте, что сайт открыт по HTTPS, затем нажмите «Проверить» ещё раз.",
  telegram_channel_not_found: "Канал не найден. Проверьте @адрес канала и что бот добавлен в него администратором.",
  max_channel_not_found: "Канал MAX не найден или бот не добавлен в него. Добавьте бота администратором канала.",
  max_channel_unknown: "Добавьте бота администратором канала MAX и нажмите «Проверить» — здесь появится ID канала для поля «Канал публикаций».",
  max_webhook_port_not_supported: "MAX принимает только адрес сайта без номера порта. Откройте рабочий сайт по обычному адресу HTTPS.",
  vk_token_other_community: "Ключ выдан другому сообществу. Проверьте ID сообщества или создайте ключ в нужном сообществе.",
  vk_publishing_token_missing: "Добавьте токен для публикаций (токен администратора с правами wall и photos).",
  vk_wall_permission_missing: "У токена для публикаций нет права wall (стена). Получите токен заново с этим правом.",
  vk_photos_permission_missing: "У токена для публикаций нет права photos. Без него посты с фото не опубликуются.",
  vk_not_community_admin: "Владелец токена не может публиковать на стене этого сообщества. Нужен токен администратора или редактора.",
  vk_no_events_yet: "ВКонтакте ещё не присылал событий. Вставьте адрес и секрет в Callback API, нажмите там «Подтвердить» и напишите сообществу тестовое сообщение.",
};
type Collection<T> = { items: T[]; hasMore?: boolean };
type MessageCollection = Collection<HubMessageView> & { conversation: HubConversationView; blockers?: HubMessageView[] };
type Faq = { title: string; keywords: string[]; answer: string; approved: boolean };
type FaqSettings = { version: number; faq: Faq[] };
type Tab = "posts" | "inbox" | "connections" | "faq";

function readableError(message: string) { return ERROR_LABELS[message] ?? (message.startsWith("provider_rejected") ? "Площадка отклонила запрос. Проверьте токен и права аккаунта." : message); }
/** One plain-language status per connection card. */
function connectionStatus(connection: HubConnectionView): { label: string; color: "success" | "warning" | "danger" | "informative" } {
  if (connection.isTest) return { label: "Тестовый режим", color: "informative" };
  if (!connection.lastCheckedAt || !connection.diagnostic) return { label: "Не проверено", color: "warning" };
  return connection.diagnostic.checks.every(check => check.ok) ? { label: "Работает", color: "success" } : { label: "Нужно внимание", color: "danger" };
}
function errorText(error: unknown) { return error instanceof Error ? readableError(error.message) : "Не удалось выполнить действие. Попробуйте ещё раз."; }
function jobError(code: string | null) { return code ? ERROR_LABELS[code] ?? (code.startsWith("provider_rejected") ? "Площадка отклонила отправку. Проверьте права и настройки подключения." : "Отправка остановлена. Проверьте подключение и повторите попытку.") : null; }
function send(path: string, body?: unknown) { return api(path, { method: "POST", body: JSON.stringify(body ?? {}) }); }
async function copyText(value: string) { if (!navigator.clipboard) throw new Error("clipboard_unavailable"); await navigator.clipboard.writeText(value); }

/** Poll only after the previous request settles, and discard old-view responses. */
function usePolling<T>(path: string, enabled: boolean, version: number, interval = 4_000) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      timer = setTimeout(() => { if (!current) return; if (document.hidden) schedule(); else void load(); }, interval);
    }
    async function load() {
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (current) { setSnapshot({ path, data }); setError(null); }
      } catch (failure) { if (current) setError(failure); }
      finally { if (current) { setLoading(false); schedule(); } }
    }
    setLoading(true);
    void load();
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [path, enabled, version, interval]);
  return { data: snapshot?.path === path ? snapshot.data : null, error, loading };
}

function ErrorNote({ error }: { error: unknown }) { return error ? <div className={styles.error} role="alert">{errorText(error)}</div> : null; }
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">АН30</span><h3>{title}</h3><p>{children}</p></div>; }
function Status({ state }: { state: HubJobView["state"] }) { return <Badge appearance="tint" title={state === "succeeded" ? "Площадка приняла отправку. Прочтение клиентом не проверяется." : STATE[state]} color={state === "succeeded" ? "success" : state === "failed" ? "danger" : state === "unknown" || state === "manual" ? "warning" : "informative"}>{STATE[state]}</Badge>; }
function Pager({ offset, hasMore, onChange }: { offset: number; hasMore?: boolean; onChange: (offset: number) => void }) { return <div className={styles.pager}><Button className={styles.button} disabled={!offset} onClick={() => onChange(Math.max(0, offset - 20))}>Назад</Button><span>Страница {offset / 20 + 1}</span><Button className={styles.button} disabled={!hasMore} onClick={() => onChange(offset + 20)}>Далее</Button></div>; }

function Modal({ title, children, actions, onClose, busy = false, wide = false }: { title: string; children: ReactNode; actions?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    // Match the storefront's native dialogs: the browser owns focus,
    // inertness and rotation/resizing, including long mobile forms.
    const element = dialog.current;
    const target = opener.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); if (target?.isConnected) queueMicrotask(() => target.focus()); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className={styles.dialogBody}>
    <header className={styles.dialogHeading}><h2 id={titleId}>{title}</h2><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть окно" disabled={busy} onClick={onClose} /></header>
    <div className={styles.dialogContent}>{children}</div>
    {actions && <div className={styles.dialogActions}>{actions}</div>}
  </div></dialog>;
}

export function ClientHubView({ session }: { session: SessionView }) {
  const [tab, setTab] = useState<Tab>("posts");
  const [refresh, setRefresh] = useState(0);
  const [postOffset, setPostOffset] = useState(0);
  const [conversationOffset, setConversationOffset] = useState(0);
  const [conversationFilter, setConversationFilter] = useState("all");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [postEditor, setPostEditor] = useState<HubPostInput | null>(null);
  const [connectionEditor, setConnectionEditor] = useState<HubConnectionView | "new" | null>(null);
  const [resolution, setResolution] = useState<{ job: HubJobView; post?: HubPostView } | null>(null);
  const [activation, setActivation] = useState<HubConnectionView | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const canConfigure = (ROLE_PERMISSIONS[session.role] as readonly Permission[]).includes("settings:manage");
  const connections = usePolling<Collection<HubConnectionView>>("/client-hub/connections", true, refresh, 15_000);
  const posts = usePolling<Collection<HubPostView>>(`/client-hub/posts?limit=20&offset=${postOffset}`, tab === "posts", refresh);
  const conversations = usePolling<Collection<HubConversationView>>(`/client-hub/conversations${queryString({ limit: 20, offset: conversationOffset, state: conversationFilter, connectionId: connectionFilter || undefined })}`, tab === "inbox", refresh);
  const messages = usePolling<MessageCollection>(`/client-hub/conversations/${selectedId ?? "none"}/messages?limit=50&offset=${historyOffset}`, tab === "inbox" && !!selectedId, refresh);
  const activeConnections = connections.data?.items.filter(connection => connection.publishEnabled) ?? [];
  const selected = messages.data?.conversation;
  const reload = useCallback(() => setRefresh(value => value + 1), []);

  async function mutate(work: () => Promise<unknown>, success: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setMutationError(null); setNotice("");
    try { await work(); reload(); setNotice(success); return true; }
    catch (failure) { setMutationError(failure); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  function selectConversation(id: string) { setSelectedId(id); setHistoryOffset(0); setMutationError(null); }
  function newPost() { setMutationError(null); setPostEditor({ id: randomUuid(), kind: "news", title: "", body: "", imageUrl: null }); }
  function resolveMessage(message: HubMessageView) {
    if (!message.jobId || !selected || !message.state) return;
    setMutationError(null);
    setResolution({ job: { id: message.jobId, connectionId: selected.connectionId, platform: selected.platform, connectionName: selected.connectionName, state: message.state, revision: null, appliedRevision: 0, externalId: null, attemptCount: 0, lastError: null, createdAt: message.createdAt } });
  }

  return <section className={styles.hub}>
    <header className={styles.header}><div><span className={styles.eyebrow}>ПУБЛИКАЦИИ И ДИАЛОГИ</span><h1>Центр общения</h1><p>Один пост для всех площадок. Каждый ответ — в диалог с клиентом.</p></div>
      <div className={styles.headerActions}><Button className={styles.button} icon={<ArrowClockwise20Regular />} onClick={reload} disabled={busy}>Обновить</Button>{tab === "posts" && <Button className={styles.primary} appearance="primary" icon={<Add20Regular />} onClick={newPost}>Написать пост</Button>}</div>
    </header>
    <nav className={styles.tabs} aria-label="Разделы центра общения">{([ ["posts", "Публикации"], ["inbox", "Входящие"], ["connections", "Площадки"], ["faq", "Автоответы"] ] as const).map(([key, label]) => <Button key={key} className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`} appearance="transparent" aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); setMutationError(null); }}>{label}</Button>)}</nav>
    <ErrorNote error={mutationError} />{notice && <div className={styles.notice} role="status"><Checkmark20Regular />{notice}<Button appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label="Скрыть уведомление" onClick={() => setNotice("")} /></div>}

    {tab === "posts" && <>
      <div className={styles.strip}><span><strong>{activeConnections.length}</strong> площадок для публикаций</span><span>Сохранение поста запускает отправку на все включённые площадки.</span></div>
      <ErrorNote error={posts.error} />
      {!posts.data && posts.loading ? <Spinner label="Загружаем публикации" /> : posts.data?.items.length ? <div className={styles.postList}>{posts.data.items.map(post => <article className={styles.post} key={post.id}>
        <div className={styles.postHeading}><div><span className={styles.eyebrow}>{post.kind === "arrival" ? "ПОСТУПЛЕНИЕ" : "НОВОСТЬ"} · ВЕРСИЯ {post.revision}</span><h2>{post.title}</h2><span className={styles.date}>{formatDate(post.updatedAt)}</span></div><Button className={styles.button} icon={<Edit20Regular />} onClick={() => { setMutationError(null); setPostEditor({ id: post.id, revision: post.revision, kind: post.kind, title: post.title, body: post.body, imageUrl: post.imageUrl }); }}>Изменить</Button></div>
        <p className={styles.postText}>{post.body}</p>{post.imageUrl && <span className={styles.small}>Прикреплено изображение</span>}
        <div className={styles.destinations}>{post.jobs.length ? latestJobs(post.jobs).map(job => <div className={styles.destination} key={job.id}><div><strong>{job.connectionName}</strong><span>{PLATFORM[job.platform]} · версия {job.revision}{connections.data?.items.find(connection => connection.id === job.connectionId)?.isTest ? " · тестовая имитация" : ""}</span></div><div className={styles.destinationStatus}><PostLink job={job} connections={connections.data?.items} /><Status state={job.state} /></div><div className={styles.destinationAction}>{jobError(job.lastError) && <span className={styles.small}>{jobError(job.lastError)}</span>}{job.state === "queued" && post.jobs.some(previous => previous.connectionId === job.connectionId && previous.state === "unknown") && <span className={styles.small}>Ожидает проверки предыдущей отправки на этой площадке.</span>}{job.state === "failed" && job.lastError?.startsWith("telegram_photo_cannot_be_") ? <Button className={styles.button} size="small" disabled={busy} onClick={() => { setMutationError(null); setPostEditor({ id: post.id, revision: post.revision, kind: post.kind, title: post.title, body: post.body, imageUrl: post.imageUrl }); }}>Изменить пост</Button> : ["failed", "unknown", "manual"].includes(job.state) && <Button className={styles.button} size="small" disabled={busy} onClick={() => { setMutationError(null); setResolution({ job, post }); }}>{job.state === "manual" ? "Открыть задачу" : job.state === "unknown" ? "Проверить результат" : "Повторить"}</Button>}</div></div>) : <div className={styles.noDestinations}>Пост сохранён. Включите публикации в разделе «Площадки», затем отправьте его.</div>}</div>
        <details className={styles.journal}><summary>История отправок · {post.jobs.length}</summary>{post.jobs.map(job => <div key={job.id}><span>{job.connectionName} · v{job.revision}</span><Status state={job.state} /><span>{formatDate(job.createdAt)}</span>{job.externalId && <span className={styles.small}>ID: {job.externalId}</span>}</div>)}</details>
        {activeConnections.some(connection => !post.jobs.some(job => job.connectionId === connection.id && job.revision === post.revision)) && <Button className={styles.button} disabled={busy} icon={<Send20Regular />} onClick={() => void mutate(() => send(`/client-hub/posts/${post.id}/publish`, { revision: post.revision }), "Пост добавлен в очередь подключённых площадок")}>Отправить на подключённые площадки</Button>}
      </article>)}</div> : <Empty title="Здесь будут ваши публикации">Напишите новость или расскажите о поступлении. После сохранения пост отправится на включённые площадки, а результат появится здесь.</Empty>}
      <Pager offset={postOffset} hasMore={posts.data?.hasMore} onChange={setPostOffset} />
    </>}

    {tab === "inbox" && <>
      <div className={styles.filters}><Field label="Состояние"><Select value={conversationFilter} onChange={(_, data) => { setConversationFilter(data.value); setConversationOffset(0); }}>{Object.entries({ all: "Все обращения", ...CONVERSATION_STATE }).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field><Field label="Площадка"><Select value={connectionFilter} onChange={(_, data) => { setConnectionFilter(data.value); setConversationOffset(0); }}><option value="">Все площадки</option>{connections.data?.items.map(connection => <option value={connection.id} key={connection.id}>{connection.name}</option>)}</Select></Field></div>
      <ErrorNote error={conversations.error} />
      <div className={styles.inbox}><aside className={styles.queue} aria-label="Список обращений">{!conversations.data && conversations.loading ? <Spinner label="Загружаем обращения" /> : conversations.data?.items.length ? conversations.data.items.map(conversation => <button key={conversation.id} className={`${styles.conversation} ${selectedId === conversation.id ? styles.conversationSelected : ""}`} onClick={() => selectConversation(conversation.id)}><div><strong>{conversation.customerName}</strong>{conversation.unreadCount > 0 && <Badge appearance="filled" color="informative">{conversation.unreadCount}</Badge>}</div><span className={styles.small}>{PLATFORM[conversation.platform]} · {conversation.connectionName}</span><p>{conversation.lastMessagePreview}</p><div className={styles.conversationMeta}><span>{CONVERSATION_STATE[conversation.state]}</span><time>{formatDate(conversation.lastMessageAt)}</time></div></button>) : <div className={styles.queueEmpty}>Обращений с такими условиями пока нет.</div>}<Pager offset={conversationOffset} hasMore={conversations.data?.hasMore} onChange={setConversationOffset} /></aside>
        <div className={styles.thread}>{selectedId ? <><ErrorNote error={messages.error} />{selected ? <><header className={styles.threadHeading}><div><h2>{selected.customerName}</h2><span className={styles.small}>{PLATFORM[selected.platform]} · {selected.connectionName} · {CONVERSATION_STATE[selected.state]}</span>{selected.assignedName && <p className={styles.small}>Менеджер: {selected.assignedName}</p>}</div><div className={styles.headerActions}>{selected.state !== "closed" && <>
          {!selected.assignedTo && <span className={styles.small}>Назначение менеджера происходит автоматически.</span>}
          {(selected.assignedTo === session.userId || session.role !== "manager") && <Button className={styles.button} disabled={busy} onClick={() => void mutate(() => send(`/client-hub/conversations/${selected.id}/close`, { version: selected.version }), "Обращение закрыто")}>Закрыть</Button>}
        </>}</div></header>
          {!!messages.data?.blockers?.length && <div className={styles.blockers} role="status"><strong>Проверьте предыдущие отправки</strong><p>До проверки следующие ответы остаются в очереди, чтобы избежать дубликатов.</p>{messages.data.blockers.map(message => <div key={message.id}><blockquote>{message.body}</blockquote><Button className={styles.button} size="small" disabled={busy} onClick={() => resolveMessage(message)}>Проверить отправку</Button></div>)}</div>}
          <div className={styles.historyNav}>{messages.data?.hasMore && <Button className={styles.button} size="small" onClick={() => setHistoryOffset(value => value + 50)}>Более ранние</Button>}{historyOffset > 0 && <Button className={styles.button} size="small" onClick={() => setHistoryOffset(0)}>К последним сообщениям</Button>}</div>
          <div className={styles.messages} aria-label="История диалога">{messages.data?.items.map(message => <article className={`${styles.message} ${message.direction === "outgoing" ? styles.outgoing : ""}`} key={message.id}><span className={styles.messageBy}>{message.senderKind === "customer" ? "Клиент" : message.senderKind === "bot" ? "Автоответ" : "Менеджер"}</span><p>{message.body}</p>{message.media.length > 0 && <span className={styles.small}>Вложения: {message.media.map(media => media.name || media.type).join(", ")}. Откройте их в исходном мессенджере.</span>}{message.lastError && message.state && message.state !== "succeeded" && <span className={styles.small} role="note">{message.state === "queued" ? "Повторная отправка запланирована. " : ""}{jobError(message.lastError)}</span>}<footer><time>{formatDate(message.createdAt)}</time>{message.state && <Status state={message.state} />}{message.state && ["unknown", "failed"].includes(message.state) && message.senderKind === "operator" && <Button appearance="subtle" size="small" disabled={busy} onClick={() => resolveMessage(message)}>Проверить</Button>}</footer></article>)}</div>
          <ReplyComposer key={selected.id} conversation={selected} session={session} busy={busy} onSend={body => mutate(() => send(`/client-hub/conversations/${selected.id}/replies`, body), "Ответ добавлен в очередь. Статус доставки появится в диалоге.")} />
        </> : messages.loading ? <Spinner label="Загружаем диалог" /> : null}</> : <Empty title="Выберите обращение">Здесь будет переписка. Включите «Принимать обращения» — новые диалоги будут назначаться автоматически. Ответ отправится туда, где написал клиент.</Empty>}</div>
      </div>
    </>}

    {tab === "connections" && <>
      <div className={styles.sectionIntro}><div><h2>Подключённые площадки</h2><p>Публикации и обращения включаются отдельно для каждого аккаунта.</p></div>{canConfigure && <Button className={styles.primary} appearance="primary" icon={<Add20Regular />} onClick={() => { setMutationError(null); setConnectionEditor("new"); }}>Подключить площадку</Button>}</div>
      <ErrorNote error={connections.error} />
      {connections.data?.items.length ? <div className={styles.connections}>{connections.data.items.map(connection => { const status = connectionStatus(connection); return <article className={styles.connectionCard} key={connection.id}><div className={styles.connectionTop}><span className={styles.platform}>{PLATFORM[connection.platform]}</span><Badge appearance="tint" color={status.color}>{status.label}</Badge></div><h3>{connection.name}</h3><p className={styles.small}>{connection.publishTarget ? `Канал публикаций: ${connection.publishTarget}` : "Канал публикаций не указан"}{connection.isTest ? " · отправки имитируются" : ""}</p><div className={styles.connectionFlags}><span data-enabled={connection.publishEnabled}>Публикации {connection.publishEnabled ? "включены" : "выключены"}</span><span data-enabled={connection.inboxEnabled}>Обращения {connection.inboxEnabled ? "включены" : "выключены"}</span></div>
        {connection.platform === "whatsapp" && <p className={styles.small}>Посты в канале публикуются вручную. Личные ответы — через WhatsApp Business API.</p>}
        {connection.diagnostic ? <ul className={styles.checks}>{connection.diagnostic.checks.map((check, index) => <li key={index} data-ok={check.ok}><strong>{check.ok ? "✓" : "✕"} {check.name}</strong><span>{check.ok ? check.detail : readableError(check.detail)}{check.at ? ` · ${formatDate(check.at)}` : ""}</span></li>)}</ul>
          : !connection.isTest && <p className={styles.small}>Нажмите «Проверить»: сайт прочитает настройки бота или сообщества и покажет, что ещё нужно сделать. Ничего не публикуется.</p>}
        {connection.lastCheckedAt && <span className={styles.small}>Проверено {formatDate(connection.lastCheckedAt)}</span>}
        {connection.platform === "vk" && connection.inboxEnabled && !connection.isTest && <Field label="Адрес для Callback API ВКонтакте" hint="Вставьте его в ВК: Управление → Работа с API → Callback API."><Input readOnly value={connection.webhookUrl} contentAfter={<Button appearance="subtle" icon={<Copy20Regular />} aria-label="Скопировать адрес для Callback API" onClick={() => void copyText(connection.webhookUrl).then(() => setNotice("Адрес скопирован")).catch(() => setMutationError(new Error("Не удалось скопировать адрес. Выделите его в поле и скопируйте вручную.")))} />} /></Field>}
        {canConfigure && <div className={styles.cardActions}><Button className={styles.button} disabled={busy} icon={<Edit20Regular />} onClick={() => { setMutationError(null); setConnectionEditor(connection); }}>Настроить</Button><Button className={styles.button} disabled={busy} onClick={() => void mutate(() => send(`/client-hub/connections/${connection.id}/diagnose`), "Проверка завершена. Результат — на карточке площадки.")}>Проверить</Button>{connection.inboxEnabled && !connection.isTest && ["telegram", "max"].includes(connection.platform) && <Button className={styles.button} disabled={busy} onClick={() => { setMutationError(null); setActivation(connection); }}>Подключить обращения</Button>}</div>}
      </article>; })}</div> : <Empty title="Подключите первую площадку">Нажмите «Подключить площадку» и следуйте шагам в окне: что скопировать в Telegram, MAX или ВКонтакте и куда вставить. Проверка подключения ничего не публикует.</Empty>}
    </>}
    {tab === "faq" && <FaqEditor canConfigure={canConfigure} refresh={refresh} busy={busy} onSave={body => mutate(() => send("/client-hub/settings", body), "Автоответы сохранены")} />}

    {postEditor && <PostEditor initial={postEditor} jobs={posts.data?.items.find(post => post.id === postEditor.id)?.jobs ?? []} connections={activeConnections} busy={busy} error={mutationError} onClose={() => { setPostEditor(null); setMutationError(null); }} onSave={async body => { if (await mutate(() => send("/client-hub/posts", body), "Пост сохранён. Отправки добавлены в очередь всех включённых площадок.")) setPostEditor(null); }} />}
    {connectionEditor && <ConnectionEditor initial={connectionEditor} busy={busy} error={mutationError} onClose={() => { setConnectionEditor(null); setMutationError(null); }} onSave={async body => {
      // A saved live connection is checked straight away, so the owner sees
      // on the card what works and what is still missing.
      const live = !(body as { isTest: boolean }).isTest, id = (body as { id: string }).id;
      if (await mutate(async () => { await send("/client-hub/connections", body); if (live) await send(`/client-hub/connections/${id}/diagnose`).catch(() => undefined); }, live ? "Подключение сохранено и проверено. Результат — на карточке площадки." : "Подключение сохранено в тестовом режиме")) setConnectionEditor(null);
    }} />}
    {resolution && <ResolveDialog {...resolution} destination={connections.data?.items.find(connection => connection.id === resolution.job.connectionId)} busy={busy} error={mutationError} onClose={() => { setResolution(null); setMutationError(null); }} onResolve={async body => { if (await mutate(() => send(`/client-hub/jobs/${resolution.job.id}/resolve`, body), "Результат отправки обновлён")) setResolution(null); }} />}
    {activation && <ActivationDialog connection={activation} busy={busy} error={mutationError} onClose={() => { setActivation(null); setMutationError(null); }} onActivate={async replaceExisting => { if (await mutate(() => send(`/client-hub/connections/${activation.id}/activate`, { confirmed: true, replaceExisting, version: activation.version }), "Приём обращений подключён")) setActivation(null); }} />}
  </section>;
}

/** Opens the post where it was published; shown only when it is really there. */
function PostLink({ job, connections }: { job: HubJobView; connections?: HubConnectionView[] }) {
  const connection = connections?.find(item => item.id === job.connectionId);
  const url = connection && !connection.isTest && job.appliedRevision > 0 ? publishedPostUrl(connection, job.externalId) : null;
  return url ? <a className={`${styles.link} ${styles.postLink}`} href={url} target="_blank" rel="noopener noreferrer">Открыть пост<span className={styles.srOnly}> в {PLATFORM[job.platform]} (новая вкладка)</span></a> : null;
}

function latestJobs(jobs: HubJobView[]) {
  const latest = new Map<string, HubJobView>();
  for (const job of jobs) { const previous = latest.get(job.connectionId); if (!previous || Number(job.revision) > Number(previous.revision)) latest.set(job.connectionId, job); }
  const latestIds = new Set([...latest.values()].map(job => job.id));
  // An uncertain earlier send blocks later versions on that destination.
  // It must remain actionable even when the latest version is queued.
  return [...jobs.filter(job => job.state === "unknown" && !latestIds.has(job.id)), ...latest.values()];
}

function PostEditor({ initial, jobs, connections, busy, error, onClose, onSave }: { initial: HubPostInput; jobs: HubJobView[]; connections: HubConnectionView[]; busy: boolean; error: unknown; onClose: () => void; onSave: (post: HubPostInput) => Promise<void> }) {
  const [post, setPost] = useState(initial);
  const [validation, setValidation] = useState("");
  const formId = "hub-post-editor";
  const count = `${post.title}\n\n${post.body}`.length;
  const photoChange = telegramPhotoChange(jobs, post.imageUrl?.trim() || null);
  async function save() {
    const parsed = HubPostInputSchema.safeParse({ ...post, imageUrl: post.imageUrl?.trim() || null });
    if (!parsed.success) { setValidation(parsed.error.issues[0]?.message || "Проверьте поля поста"); return; }
    setValidation(""); await onSave(parsed.data);
  }
  return <Modal title={initial.revision ? "Редактировать публикацию" : "Новая публикация"} wide busy={busy} onClose={onClose} actions={<><Button className={styles.button} disabled={busy} onClick={onClose}>Отмена</Button><Button className={styles.primary} appearance="primary" icon={busy ? <Spinner size="tiny" /> : <ArrowRight20Regular />} type="submit" form={formId} disabled={busy}>{connections.length ? initial.revision ? "Сохранить и обновить" : "Сохранить и отправить" : "Сохранить пост"}</Button></>}>
    <div className={styles.editorGrid}><form id={formId} className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}><ErrorNote error={error} />{validation && <div className={styles.error} role="alert">{validation}</div>}
      <Field label="Тип публикации"><Select value={post.kind} onChange={(_, data) => setPost(value => ({ ...value, kind: data.value as HubPostInput["kind"] }))}><option value="news">Новость</option><option value="arrival">Поступление</option></Select></Field>
      <Field label="Заголовок" required><Input value={post.title} maxLength={160} onChange={(_, data) => setPost(value => ({ ...value, title: data.value }))} /></Field>
      <Field label="Текст поста" required hint={`${count} / ${post.imageUrl ? "1024 с изображением" : "3862"} символов с заголовком`}><Textarea value={post.body} maxLength={3700} rows={9} resize="vertical" onChange={(_, data) => setPost(value => ({ ...value, body: data.value }))} /></Field>
      <Field label="Ссылка на изображение" hint="Публичная ссылка HTTPS. В Telegram подпись к фото — до 1024 символов."><Input type="url" placeholder="https://…" value={post.imageUrl ?? ""} onChange={(_, data) => setPost(value => ({ ...value, imageUrl: data.value || null }))} /></Field>
      {photoChange && <p className={styles.callout} role="note">{photoChange === "added" ? "В Telegram этот пост уже опубликован без фото, и добавить фото туда нельзя: остальные площадки обновятся, а Telegram покажет ошибку. Чтобы фото появилось и в Telegram, опубликуйте новый пост." : "В Telegram этот пост опубликован с фото, и убрать его оттуда нельзя: остальные площадки обновятся, а Telegram покажет ошибку. Оставьте изображение или замените его другим."}</p>}
    </form><aside className={styles.editorAside}><span className={styles.eyebrow}>КУДА УЙДЁТ ПОСТ</span><div className={styles.targetList}>{connections.length ? connections.map(connection => <div key={connection.id}><strong>{connection.name}</strong><span>{connection.isTest ? "Имитация отправки" : connection.platform === "whatsapp" ? "Ручная задача" : "Автоматическая публикация"}</span></div>) : <p>Пока нет включённых площадок. Пост сохранится на сайте.</p>}</div><div className={styles.preview}><span className={styles.eyebrow}>ПРЕДПРОСМОТР ТЕКСТА</span><h3>{post.title || "Заголовок публикации"}</h3><p>{post.body || "Ваш текст появится здесь."}</p>{post.imageUrl && <span className={styles.small}>+ изображение</span>}</div>{initial.revision && <p className={styles.small}>Изменения обновят существующие посты по сохранённым ID. История предыдущих версий останется в журнале.</p>}</aside></div>
  </Modal>;
}

function ReplyComposer({ conversation, session, busy, onSend }: { conversation: HubConversationView; session: SessionView; busy: boolean; onSend: (body: { clientKey: string; body: string }) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const enabled = conversation.state === "assigned" && conversation.assignedTo === session.userId;
  async function submit() {
    const body = text.trim(); if (!body || busy || !enabled) return;
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: randomUuid() };
    if (await onSend({ clientKey: attempt.current.key, body })) { setText(""); attempt.current = null; }
  }
  return <form className={styles.composer} onSubmit={event => { event.preventDefault(); void submit(); }}><Field label={`Ответ в ${PLATFORM[conversation.platform]}`} hint={enabled ? "Ответ отправится в исходный диалог клиента. Автоответы приостановлены." : conversation.state === "closed" ? "Обращение закрыто. Новое сообщение клиента откроет его снова." : conversation.assignedTo ? "Обращение назначено другому менеджеру." : "Включите «Принимать обращения» в верхней панели. Очередь назначается автоматически."}><Textarea disabled={!enabled || busy} value={text} maxLength={3700} rows={3} resize="vertical" onChange={(_, data) => setText(data.value)} placeholder="Напишите клиенту…" /></Field><div><span className={styles.small}>{text.length} / 3700</span><Button className={styles.primary} appearance="primary" icon={<Send20Regular />} type="submit" disabled={!enabled || busy || !text.trim()}>Отправить ответ</Button></div></form>;
}

function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Step-by-step: what to open on the platform and what to paste where. */
const SETUP_STEPS: Partial<Record<HubPlatform, string[]>> = {
  telegram: [
    "В Telegram откройте @BotFather, отправьте /newbot (или выберите существующего бота) и скопируйте токен.",
    "Добавьте бота в канал АН30 администратором с правами «Публикация сообщений» и «Редактирование сообщений».",
    "Вставьте токен ниже, укажите адрес канала, снимите «Тестовый режим» и сохраните — сайт сразу проверит подключение.",
    "На карточке нажмите «Подключить обращения»: сообщения клиентов боту начнут приходить в раздел «Входящие».",
  ],
  max: [
    "В кабинете MAX для партнёров (business.max.ru) создайте бота или откройте существующего и скопируйте токен в разделе интеграции.",
    "Вставьте токен ниже, отметьте «Принимать сообщения клиентов», снимите «Тестовый режим» и сохраните.",
    "На карточке нажмите «Подключить обращения». Затем добавьте бота администратором канала АН30 в MAX.",
    "Нажмите «Проверить» — сайт покажет ID канала. Откройте «Настроить», вставьте ID в «Канал для постов» и включите «Публиковать посты».",
  ],
  vk: [
    "В ВК откройте сообщество → Управление → Сообщения и включите сообщения сообщества.",
    "Управление → Работа с API → Ключи доступа: создайте ключ с правом «Сообщения сообщества» и вставьте его ниже.",
    "Для постов на стене нужен ещё токен администратора (права wall и photos). Его один раз получает разработчик через приложение ВК. Без него работают только сообщения.",
    "Работа с API → Callback API: скопируйте «Строку, которую должен вернуть сервер» и вставьте ниже. Снимите «Тестовый режим» и сохраните.",
    "На карточке ВКонтакте скопируйте «Адрес для Callback API», вставьте его в ВК вместе с секретным ключом (кнопка «Копировать для ВК»), нажмите в ВК «Подтвердить» и отметьте тип события «Входящее сообщение».",
  ],
};
function SetupGuide({ platform, saved }: { platform: HubPlatform; saved: boolean }) {
  const steps = SETUP_STEPS[platform];
  if (!steps) return null;
  return <details className={styles.secretSection} open={!saved}>
    <summary>Как подключить {PLATFORM[platform]} — по шагам</summary>
    <ol className={styles.small}>{steps.map(step => <li key={step}>{step}</li>)}</ol>
    <p className={styles.small}>Кнопка «Проверить» на карточке ничего не публикует: она только читает настройки и показывает, что осталось сделать.</p>
  </details>;
}

function ConnectionEditor({ initial, busy, error, onClose, onSave }: { initial: HubConnectionView | "new"; busy: boolean; error: unknown; onClose: () => void; onSave: (body: unknown) => Promise<void> }) {
  const [data, setData] = useState(() => initial === "new" ? { id: randomUuid(), platform: "telegram" as HubPlatform, name: "", isTest: true, publishEnabled: false, inboxEnabled: false, publishTarget: "", inboxTarget: "", publicUrl: "", version: undefined as number | undefined } : { id: initial.id, platform: initial.platform, name: initial.name, isTest: initial.isTest, publishEnabled: initial.publishEnabled, inboxEnabled: initial.inboxEnabled, publishTarget: initial.publishTarget, inboxTarget: initial.inboxTarget, publicUrl: initial.publicUrl, version: initial.version });
  // A new bot connection gets a ready secret: Telegram and MAX receive it from
  // the site itself, the owner only copies it once for VK.
  const [secrets, setSecrets] = useState<HubSecrets>(() => initial === "new" ? { webhookSecret: randomSecret() } : {});
  const [revealed, setRevealed] = useState(false);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const publicAccount = MESSENGERS.find(item => item.id === data.platform);
  const secretLimit = data.platform === "vk" ? 50 : 128;
  const fields: Array<{ key: keyof HubSecrets; label: string; saved: boolean; hint?: string }> = [
    {
      key: "token",
      label: data.platform === "whatsapp" ? "Токен WhatsApp Business" : data.platform === "vk" ? "Ключ доступа сообщества" : "Токен бота",
      saved: initial !== "new" && initial.hasToken,
      hint: data.platform === "telegram" ? "Длинная строка вида 123456789:AA…, которую прислал @BotFather." : data.platform === "max" ? "Строка из кабинета MAX для партнёров, раздел интеграции бота." : data.platform === "vk" ? "ВК → Управление сообществом → Работа с API → Ключи доступа. Отметьте «Сообщения сообщества»." : undefined,
    },
    ...(data.platform === "vk" ? [{
      key: "publishingToken" as const, label: "Токен администратора для постов на стене",
      saved: initial !== "new" && initial.hasPublishingToken,
      hint: "Ключ сообщества не умеет публиковать на стене. Нужен токен администратора с правами «стена» и «фотографии» (wall, photos). Нужен только для публикаций.",
    }] : []),
    ...(data.platform !== "whatsapp" ? [{
      key: "webhookSecret" as const, label: "Секретный ключ для сообщений клиентов",
      saved: initial !== "new" && initial.hasWebhookSecret,
      hint: data.platform === "vk" ? "Уже создан. Нажмите «Копировать для ВК» и вставьте в поле «Секретный ключ» в Callback API." : "Уже создан, ничего делать не нужно: сайт сам передаст его боту. По нему сайт отличает настоящие сообщения от подделок.",
    }] : [{ key: "appSecret" as const, label: "App Secret", saved: initial !== "new" && initial.hasAppSecret }, { key: "verifyToken" as const, label: "Verify Token (от 24 символов)", saved: false }]),
    ...(data.platform === "vk" ? [{
      key: "confirmationCode" as const, label: "Строка подтверждения из Callback API", saved: false,
      hint: "В ВК на странице Callback API написано «Строка, которую должен вернуть сервер» — скопируйте её сюда.",
    }] : []),
  ];
  function generateWebhookSecret() {
    setSecrets(current => ({ ...current, webhookSecret: randomSecret() }));
    setSecretCopied(false);
  }
  async function copySecret() {
    if (!secrets.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(secrets.webhookSecret);
      setCopyError(null);
      setSecretCopied(true);
    } catch {
      setCopyError(new Error("Включите «Показать вводимые значения» и скопируйте секрет из поля."));
    }
  }
  return <Modal title={initial === "new" ? "Подключить площадку" : `Настройка · ${initial.name}`} busy={busy} onClose={onClose} actions={<><Button className={styles.button} disabled={busy} onClick={onClose}>Отмена</Button><Button className={styles.primary} appearance="primary" type="submit" form="hub-connection-form" disabled={busy}>Сохранить подключение</Button></>}>
    <form id="hub-connection-form" className={styles.form} onSubmit={event => { event.preventDefault(); void onSave({ ...data, secrets: Object.fromEntries(Object.entries(secrets).filter(([, value]) => !!value)) }); }}><ErrorNote error={error} />
      <div className={styles.twoColumns}><Field label="Площадка"><Select disabled={initial !== "new"} value={data.platform} onChange={(_, field) => {
        setData(value => ({
          ...value,
          platform: field.value as HubPlatform,
          name: value.name === `АН30 · ${PLATFORM[value.platform]}` ? "" : value.name,
          publishTarget: "",
          inboxTarget: "",
          publicUrl: "",
        }));
        setSecrets(initial === "new" ? { webhookSecret: randomSecret() } : {});
        setSecretCopied(false);
        setCopyError(null);
      }}>{Object.entries(PLATFORM).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field><Field label="Название подключения" required><Input required maxLength={120} value={data.name} placeholder="Например, АН30 · Telegram" onChange={(_, field) => setData(value => ({ ...value, name: field.value }))} /></Field></div>
      {initial === "new" && publicAccount && (data.platform === "telegram" || data.platform === "vk") && (
        <div>
          <Button className={styles.button} type="button" disabled={busy} onClick={() => setData(value => ({
            ...value,
            name: value.name || `АН30 · ${PLATFORM[value.platform]}`,
            publicUrl: value.publicUrl || publicAccount.href,
            publishTarget: value.publishTarget || (value.platform === "telegram" ? `@${new URL(publicAccount.href).pathname.slice(1)}` : ""),
          }))}>Подставить публичные данные АН30</Button>
        </div>
      )}
      <SetupGuide platform={data.platform} saved={initial !== "new"} />
      <Checkbox checked={data.isTest} label="Тестовый режим: ничего не отправлять на площадку" onChange={(_, field) => setData(value => ({ ...value, isTest: !!field.checked }))} />
      <p className={styles.small}>{data.isTest ? "Посты и ответы только имитируются на сайте — удобно, чтобы попробовать. Для настоящей работы снимите галочку." : "Посты и ответы будут уходить на настоящую площадку. Настоящие отправки работают только на рабочем сайте."}</p>
      <div className={styles.connectionFlags}><Checkbox checked={data.publishEnabled} label="Публиковать посты" onChange={(_, field) => setData(value => ({ ...value, publishEnabled: !!field.checked }))} /><Checkbox checked={data.inboxEnabled} label="Принимать сообщения клиентов" onChange={(_, field) => setData(value => ({ ...value, inboxEnabled: !!field.checked }))} /></div>
      {data.platform !== "whatsapp" && <Field label={data.platform === "telegram" ? "Канал для постов" : data.platform === "vk" ? "Стена сообщества для постов" : "ID канала MAX для постов"} hint={data.platform === "telegram" ? "Адрес канала: @an30_autoparts или ссылка https://t.me/… Бот должен быть администратором канала." : data.platform === "vk" ? "Можно оставить пустым — сайт возьмёт сообщество, которому выдан ключ. Вручную: минус и число, например -123456." : "Добавьте бота администратором канала, включите приём сообщений и нажмите «Проверить» на карточке — сайт покажет ID канала. Вставьте его сюда."}><Input value={data.publishTarget} maxLength={500} placeholder={data.platform === "telegram" ? "@an30_autoparts" : data.platform === "vk" ? "Определится автоматически" : "-70000000000"} onChange={(_, field) => setData(value => ({ ...value, publishTarget: field.value }))} /></Field>}
      {(data.platform === "vk" || data.platform === "whatsapp") && <Field label={data.platform === "whatsapp" ? "Phone Number ID" : "ID сообщества (число без минуса)"} hint={data.platform === "vk" ? "Можно оставить пустым — сайт определит его по ключу сообщества." : undefined}><Input value={data.inboxTarget} maxLength={200} placeholder={data.platform === "vk" ? "Определится автоматически" : undefined} onChange={(_, field) => setData(value => ({ ...value, inboxTarget: field.value }))} /></Field>}
      <Field label="Публичная ссылка на площадку"><Input type="url" value={data.publicUrl} placeholder="https://…" onChange={(_, field) => setData(value => ({ ...value, publicUrl: field.value }))} /></Field>
      <details className={styles.secretSection} open={initial === "new"}>
        <summary>Ключи и токены</summary>
        <p className={styles.small}>Хранятся на сервере в зашифрованном виде и больше не показываются. Если поле оставить пустым, сохранится прежнее значение.</p>
        {fields.map(field => (
          <div key={field.key}>
            <Field label={field.label} hint={field.saved ? `Значение сохранено. Заполните для замены. ${field.hint ?? ""}` : field.hint}>
              <Input
                autoComplete="off"
                type={revealed ? "text" : "password"}
                maxLength={field.key === "webhookSecret" ? secretLimit : undefined}
                value={secrets[field.key] ?? ""}
                onChange={(_, next) => {
                  setSecrets(value => ({ ...value, [field.key]: next.value }));
                  if (field.key === "webhookSecret") setSecretCopied(false);
                }}
              />
            </Field>
            {field.key === "webhookSecret" && (
              <div className={styles.secretActions}>
                <Button className={styles.button} size="small" type="button" disabled={busy} onClick={generateWebhookSecret}>
                  {field.saved ? "Сгенерировать замену" : "Сгенерировать секрет"}
                </Button>
                {data.platform === "vk" && secrets.webhookSecret && (
                  <Button className={styles.button} size="small" type="button" icon={<Copy20Regular />} onClick={() => void copySecret()}>
                    {secretCopied ? "Скопировано" : "Копировать для ВК"}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
        <Checkbox checked={revealed} label="Показать вводимые значения" onChange={(_, field) => setRevealed(!!field.checked)} />
      </details>
      {initial !== "new" && (data.platform === "vk" || data.platform === "whatsapp") && <Field label="Адрес сайта для сообщений клиентов" hint={addressCopied ? "Адрес скопирован" : data.platform === "vk" ? "Вставьте его в ВК: Callback API → Адрес. В «Типах событий» отметьте «Входящее сообщение» и «Редактирование сообщения»." : "Укажите адрес в Meta Business и подпишитесь на события messages."}><Input readOnly value={initial.webhookUrl} contentAfter={<Button appearance="subtle" icon={<Copy20Regular />} aria-label="Скопировать адрес входящих событий" onClick={() => void copyText(initial.webhookUrl).then(() => { setAddressCopied(true); setCopyError(null); }).catch(() => setCopyError(new Error("Не удалось скопировать адрес. Выделите его в поле и скопируйте вручную.")))} />} /></Field>}
      <ErrorNote error={copyError} />
      {data.platform === "whatsapp" && <p className={styles.callout}>Автоматическая публикация в WhatsApp-канале недоступна. Для канала создаётся ручная задача; личные ответы работают через WhatsApp Business API в течение 24 часов после сообщения клиента.</p>}
    </form>
  </Modal>;
}

function ResolveDialog({ job, post, destination, busy, error, onClose, onResolve }: { job: HubJobView; post?: HubPostView; destination?: HubConnectionView; busy: boolean; error: unknown; onClose: () => void; onResolve: (body: unknown) => Promise<void> }) {
  const [action, setAction] = useState<"bind" | "not_published" | "mark_sent">(job.state === "unknown" ? post ? "bind" : "mark_sent" : "not_published");
  const [externalId, setExternalId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<unknown>(null);
  const manual = job.state === "manual";
  const outdated = manual && post && job.revision !== post.revision;
  const bound = action === "bind" && externalId.trim() ? postIdFromInput(destination ?? { platform: job.platform, publishTarget: "", publicUrl: "" }, externalId) : null;
  const boundError = bound && "error" in bound ? bound.error === "other_channel" ? "Это ссылка на пост другого канала или сообщества. Нужен пост площадки, указанной выше." : "Не получилось найти номер поста. Вставьте ссылку на сам пост или число из её конца." : undefined;
  const byLink = job.platform === "telegram" || job.platform === "vk";
  return <Modal title={manual ? "Публикация в WhatsApp-канале" : job.state === "unknown" ? "Проверить результат отправки" : "Повторить отправку"} busy={busy} onClose={onClose} actions={<><Button className={styles.button} disabled={busy} onClick={onClose}>Отмена</Button><Button className={styles.primary} appearance="primary" disabled={busy || !confirmed || !!outdated || (!manual && action === "bind" && (!bound || "error" in bound))} onClick={() => void onResolve(manual ? { action: "manual_done", confirmed: true } : { action, confirmed: true, ...(action === "bind" && bound && "id" in bound ? { externalId: bound.id } : action === "mark_sent" && externalId.trim() ? { externalId: externalId.trim() } : {}) })}>{manual ? "Отметить опубликованным" : action === "bind" ? "Сохранить ID поста" : action === "mark_sent" ? "Отметить отправленным" : "Добавить в очередь"}</Button></>}>
    <div className={styles.form}><ErrorNote error={error} /><ErrorNote error={copyError} /><p>{job.connectionName} · {PLATFORM[job.platform]}{job.revision ? ` · версия ${job.revision}` : ""}</p>{manual && post ? <><p>Скопируйте текст, добавьте изображение при необходимости и опубликуйте его в канале. Затем отметьте результат здесь.</p><div className={styles.copyBlock}><strong>{post.title}</strong><p>{post.body}</p></div><Button className={styles.button} icon={<Copy20Regular />} onClick={() => void copyText(`${post.title}\n\n${post.body}`).then(() => { setCopied(true); setCopyError(null); }).catch(() => setCopyError(new Error("Не удалось скопировать текст. Выделите его в окне и скопируйте вручную.")))}>{copied ? "Текст скопирован" : "Скопировать текст"}</Button>{post.imageUrl && <a className={styles.link} href={post.imageUrl} target="_blank" rel="noopener noreferrer">Открыть изображение</a>}{outdated && <div className={styles.error}>Этот пост уже изменён. Закройте окно и откройте задачу последней версии.</div>}<Checkbox checked={confirmed} label="Я опубликовал эту версию в канале" onChange={(_, field) => setConfirmed(!!field.checked)} /></> : <>
      <p className={styles.callout}>Сначала откройте площадку и проверьте, появился ли {post ? "пост" : "ответ"}. Повторная отправка без проверки может создать дубликат.</p>{(post || job.state === "unknown") && <Field label="Результат проверки"><Select value={action} onChange={(_, field) => { setAction(field.value as typeof action); setConfirmed(false); }}>{post ? <option value="bind">Пост есть — сохранить его ID</option> : <option value="mark_sent">Ответ уже отправлен — подтвердить</option>}<option value="not_published">{post ? "Поста" : "Ответа"} нет — повторить отправку</option></Select></Field>}{(action === "bind" || action === "mark_sent") && <Field label={action === "bind" ? byLink ? "Ссылка на пост или его номер" : "ID поста на площадке" : "ID ответа на площадке (необязательно)"} required={action === "bind"} validationMessage={boundError} hint={action === "bind" && byLink ? job.platform === "telegram" ? "В канале нажмите на пост → «Копировать ссылку» и вставьте её сюда: https://t.me/канал/123." : "Откройте запись на стене и скопируйте её адрес: https://vk.com/wall-…_123." : undefined}><Input value={externalId} maxLength={action === "bind" ? 500 : 200} onChange={(_, field) => setExternalId(field.value)} /></Field>}<Checkbox checked={confirmed} label={action === "bind" ? "Проверил площадку: это ID нужного поста" : action === "mark_sent" ? "Проверил площадку: клиент получил этот ответ" : `Проверил площадку: ${post ? "пост" : "ответ"} не отправлен`} onChange={(_, field) => setConfirmed(!!field.checked)} />
    </>}</div>
  </Modal>;
}

function ActivationDialog({ connection, busy, error, onClose, onActivate }: { connection: HubConnectionView; busy: boolean; error: unknown; onClose: () => void; onActivate: (replaceExisting: boolean) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [replace, setReplace] = useState(false);
  return <Modal title="Подключить сообщения клиентов" busy={busy} onClose={onClose} actions={<><Button className={styles.button} disabled={busy} onClick={onClose}>Отмена</Button><Button className={styles.primary} appearance="primary" disabled={busy || !confirmed} onClick={() => void onActivate(replace)}>Подключить</Button></>}><div className={styles.form}><ErrorNote error={error} /><p>Сообщения, которые клиенты пишут боту «{connection.name}», начнут приходить на сайт в раздел «Входящие». Ответы менеджеров уйдут клиенту в тот же чат.</p><Field label="Адрес сайта, куда бот будет пересылать сообщения"><Input readOnly value={connection.webhookUrl} /></Field><p className={styles.callout}>Если этот бот уже отвечает клиентам через другой сервис, после подключения сообщения будут приходить только сюда.</p><Checkbox checked={replace} label="Бот уже подключён к другому сервису — перенести его сообщения на этот сайт" onChange={(_, field) => setReplace(!!field.checked)} /><Checkbox checked={confirmed} label="Я проверил, что это бот АН30" onChange={(_, field) => setConfirmed(!!field.checked)} /></div></Modal>;
}

function FaqEditor({ canConfigure, refresh, busy, onSave }: { canConfigure: boolean; refresh: number; busy: boolean; onSave: (body: FaqSettings) => Promise<boolean> }) {
  const settings = usePolling<FaqSettings>("/client-hub/settings", true, refresh, 30_000);
  const [draft, setDraft] = useState<FaqSettings | null>(null);
  const data = draft ?? settings.data;
  const dirty = !!draft;
  const rules = useMemo(() => data?.faq ?? [], [data]);
  function update(index: number, change: Partial<Faq>) { if (data) setDraft({ ...data, faq: data.faq.map((rule, current) => current === index ? { ...rule, ...change } : rule) }); }
  return <div className={styles.faq}><div className={styles.sectionIntro}><div><h2>Проверенные автоответы</h2><p>Только согласованная информация о магазине. Подбор, цены и наличие передаются менеджеру.</p></div>{canConfigure && <Button className={styles.primary} appearance="primary" disabled={busy || !data || !dirty} onClick={() => { if (data) void onSave(data).then(ok => { if (ok) setDraft(null); }); }}>Сохранить автоответы</Button>}</div><ErrorNote error={settings.error} /><div className={styles.callout}>Бот отвечает только по утверждённым правилам. Если вопрос не распознан или связан с запчастями, он передаёт диалог менеджеру. Пока менеджер работает с обращением, автоответов нет.</div>{!data && settings.loading ? <Spinner label="Загружаем автоответы" /> : rules.length ? rules.map((rule, index) => <article className={styles.faqRule} key={index}><div className={styles.twoColumns}><Field label="Название правила"><Input disabled={!canConfigure || busy} value={rule.title} maxLength={120} onChange={(_, field) => update(index, { title: field.value })} /></Field><Field label="Ключевые слова" hint="Отдельные слова через запятую, например: график, часы"><Input disabled={!canConfigure || busy} value={rule.keywords.join(", ")} onChange={(_, field) => update(index, { keywords: field.value.split(",").map(value => value.trim()) })} /></Field></div><Field label="Текст ответа"><Textarea disabled={!canConfigure || busy} value={rule.answer} maxLength={1000} rows={3} resize="vertical" onChange={(_, field) => update(index, { answer: field.value })} /></Field><div className={styles.cardActions}><Checkbox disabled={!canConfigure || busy} checked={rule.approved} label="Проверено и разрешено для автоответов" onChange={(_, field) => update(index, { approved: !!field.checked })} />{canConfigure && <Button className={styles.button} disabled={busy} onClick={() => data && setDraft({ ...data, faq: data.faq.filter((_, current) => current !== index) })}>Удалить правило</Button>}</div></article>) : <Empty title="Автоответов пока нет">Добавьте проверенный график работы или условия получения заказа. Без правил бот приветствует клиента и передаёт вопрос менеджеру.</Empty>}{canConfigure && <div className={styles.cardActions}><Button className={styles.button} icon={<Add20Regular />} disabled={!data || busy || rules.length >= 20} onClick={() => data && setDraft({ ...data, faq: [...data.faq, { title: "", keywords: [], answer: "", approved: false }] })}>Добавить правило</Button>{dirty && <Button className={styles.button} disabled={busy} onClick={() => setDraft(null)}>Отменить изменения</Button>}</div>}</div>;
}
