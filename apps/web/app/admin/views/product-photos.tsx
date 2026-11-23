"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@fluentui/react-components";
import { Camera20Regular } from "@fluentui/react-icons";

import { api, queryString } from "../api";
import { errorText, formatDate, Pagination, RequestError, useResource } from "../workspace-utils";
import panel from "./catalog-enrichment.module.css";
import styles from "./product-photos.module.css";

type Mode = "shoot" | "pack" | "takedown";
type Source = "one_c" | "own_photo" | "licensed";

interface Summary {
  inStock: number; inStockWithoutPhoto: number; photos: Record<Source, number>; products: number; withdrawn: number; withoutPhoto: number;
}
interface Product {
  availableQuantity: number; brand: string | null; category: string | null; code: string; id: string; name: string; shownName: string; sku: string;
}
interface Page<T> { items: T[]; limit: number; offset: number; total: number }
interface Photo {
  code: string; createdAt: string; id: string; rightsSource: string | null; shownName: string; sku: string; source: Source; uploadedBy: string | null; url: string;
}
interface RightsSource { basis: string; createdAt: string; id: string; name: string; photos: number; revokedAt: string | null }
type PackResult =
  | { fileName: string; outcome: "attached" | "unchanged"; product: Product }
  | { candidates: Product[]; fileName: string; outcome: "ambiguous" }
  | { fileName: string; outcome: "not_found" }
  | { fileName: string; message: string; outcome: "error" };

const MODES: Record<Mode, string> = { shoot: "Снять на телефон", pack: "Загрузить пакет", takedown: "Фото на сайте" };
const SOURCE_LABELS: Record<Source, string> = { licensed: "По разрешению", one_c: "Из 1С", own_photo: "Снято магазином" };
const number = (value: number) => value.toLocaleString("ru-RU");

/**
 * A phone shoots 12–50 megapixels; the card needs two. Shrinking in the browser sends a tenth of the bytes over the
 * shop's mobile connection. The server gives the picture its final shape either way, so a browser that cannot do
 * this simply sends the file as it is.
 */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2_000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function send<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", await shrink(file), file.name);
  return api<T>(path, { body, method: "POST" });
}

/**
 * «Фото товаров» (docs/PRODUCT_PHOTOS.md): the shop's own photos, shot on a phone straight into the card; a pack a
 * manufacturer or supplier allowed, attached by the article in the file name; and taking any photo down.
 */
export function ProductPhotosPanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("shoot");
  const summary = useResource(() => (open ? api<Summary>("/staff/catalog/photos/summary") : Promise.resolve(null)), [open]);
  const counts = summary.data;

  return (
    <section className={panel.panel}>
      <div className={panel.header}>
        <div>
          <h2>Фото товаров</h2>
          <p>Свои снимки с телефона прямо в карточку и фото от производителя по письменному разрешению. У каждого фото записано, откуда оно; любое снимается с сайта одним действием.</p>
        </div>
        <Button aria-controls="product-photos" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Свернуть" : "Открыть"}</Button>
      </div>
      {open ? (
        <div className={panel.body} id="product-photos">
          {summary.error ? <RequestError error={summary.error} onRetry={summary.reload} /> : null}
          {counts ? (
            <dl className={styles.counts}>
              <div><dt>В наличии без фото</dt><dd>{number(counts.inStockWithoutPhoto)}</dd></div>
              <div><dt>Всего без фото</dt><dd>{number(counts.withoutPhoto)}</dd></div>
              <div><dt>Фото на сайте</dt><dd>{number(counts.photos.own_photo + counts.photos.one_c + counts.photos.licensed)}</dd></div>
              <div><dt>Снято с сайта</dt><dd>{number(counts.withdrawn)}</dd></div>
            </dl>
          ) : null}
          <div className={styles.modes} role="group" aria-label="Что сделать">
            {(Object.keys(MODES) as Mode[]).map((key) => (
              <Button appearance={key === mode ? "primary" : "secondary"} aria-pressed={key === mode} key={key} onClick={() => setMode(key)}>{MODES[key]}</Button>
            ))}
          </div>
          {mode === "shoot" ? <ShootQueue onChange={summary.reload} /> : null}
          {mode === "pack" ? <Pack onChange={summary.reload} /> : null}
          {mode === "takedown" ? <Takedown onChange={summary.reload} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function ShootQueue({ onChange }: { onChange: () => void }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [inStock, setInStock] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const limit = 24;
  const queue = useResource(
    () => api<Page<Product>>(`/staff/catalog/photos/queue${queryString({ inStock: String(inStock), limit, offset, search })}`),
    [inStock, offset, search],
  );

  const shoot = async (product: Product, file: File | undefined) => {
    if (!file) return;
    setBusy(product.id);
    setFailed(({ [product.id]: _removed, ...rest }) => rest);
    try {
      const result = await send<{ url?: string }>(`/staff/catalog/photos/products/${product.id}`, file);
      setDone((value) => ({ ...value, [product.id]: result.url ?? "" }));
      onChange();
    } catch (error) {
      setFailed((value) => ({ ...value, [product.id]: errorText(error) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className={panel.note}>
        Идите вдоль полок: товары стоят по разделам. Нажмите «Сфотографировать» — откроется камера телефона; снимок сам
        уменьшится, повернётся и встанет в карточку. Снимайте сам товар на светлом фоне. Не переснимайте чужие каталоги,
        экраны и картинки из интернета: на сайт идут только свои снимки.
      </p>
      <div className={styles.filters}>
        <input aria-label="Найти товар: название, артикул или код 1С" onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder="Название, артикул или код 1С" type="search" value={search} />
        <label className={styles.check}>
          <input checked={inStock} onChange={(event) => { setInStock(event.target.checked); setOffset(0); }} type="checkbox" />
          Только то, что в наличии
        </label>
      </div>
      {queue.error ? <RequestError error={queue.error} onRetry={queue.reload} /> : null}
      {queue.data && queue.data.items.length === 0 ? <p className={panel.note}>Здесь товаров без фото нет.</p> : null}
      <ul className={styles.queue}>
        {(queue.data?.items ?? []).map((product) => (
          <li className={`${styles.item} ${done[product.id] !== undefined ? styles.done : ""}`} key={product.id}>
            <div>
              <strong>{product.shownName}</strong>
              <small>Артикул {product.sku} · код 1С {product.code}</small>
              <small>{product.category ?? "Без раздела"}{product.brand ? ` · ${product.brand}` : ""} · {product.availableQuantity} шт.</small>
            </div>
            <div aria-live="polite">
              {failed[product.id] ? <p className={styles.meta} role="alert">Не получилось: {failed[product.id]}</p> : null}
              {done[product.id] !== undefined ? <p className={styles.meta}>Фото в карточке. Можно добавить ещё ракурс.</p> : null}
              <label aria-disabled={busy !== null} className={styles.shoot}>
                <Camera20Regular aria-hidden="true" />
                {busy === product.id ? "Отправляется…" : done[product.id] !== undefined ? "Ещё снимок" : "Сфотографировать"}
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={`Сфотографировать: ${product.shownName}`}
                  capture="environment"
                  className={styles.hidden}
                  disabled={busy !== null}
                  onChange={(event) => { void shoot(product, event.target.files?.[0]); event.target.value = ""; }}
                  type="file"
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      {queue.data ? <div className={styles.pager}><Pagination limit={limit} offset={offset} onChange={(next) => { setOffset(next); setDone({}); }} total={queue.data.total} /></div> : null}
    </>
  );
}

function Pack({ onChange }: { onChange: () => void }) {
  const sources = useResource(() => api<{ items: RightsSource[] }>("/staff/catalog/photos/sources"), []);
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [basis, setBasis] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<PackResult[]>([]);
  const live = (sources.data?.items ?? []).filter((source) => !source.revokedAt);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await api<{ id: string }>("/staff/catalog/photos/sources", { body: JSON.stringify({ basis, name }), method: "POST" });
      setName("");
      setBasis("");
      sources.reload();
      setSourceId(created.id);
    } catch (error) {
      setFormError(errorText(error));
    }
  };

  const upload = async (files: File[]) => {
    setResults([]);
    setProgress({ done: 0, total: files.length });
    const path = `/staff/catalog/photos/by-file-name${queryString({ rightsSourceId: sourceId || undefined })}`;
    for (const [index, file] of files.entries()) {
      let result: PackResult;
      try {
        result = { ...(await send<PackResult>(path, file)), fileName: file.name };
      } catch (error) {
        result = { fileName: file.name, message: errorText(error), outcome: "error" };
      }
      setResults((value) => [...value, result]);
      setProgress({ done: index + 1, total: files.length });
    }
    setProgress(null);
    onChange();
    sources.reload();
  };

  const attached = results.filter((result) => result.outcome === "attached" || result.outcome === "unchanged").length;
  const uploading = progress !== null;

  return (
    <>
      <p className={panel.note}>
        Назовите файлы артикулом или кодом 1С («W914-2.jpg», второй ракурс — «W914-2_2.jpg») и выберите все сразу:
        каждый встанет в карточку своего товара. Файл, на артикул которого отзываются две карточки, не прикрепляется —
        он останется в списке ниже.
      </p>
      {sources.error ? <RequestError error={sources.error} onRetry={sources.reload} /> : null}
      <label className={styles.field}>
        <span>Чьи это фото</span>
        <select onChange={(event) => setSourceId(event.target.value)} value={sourceId}>
          <option value="">Наши: снял сотрудник магазина</option>
          {live.map((source) => <option key={source.id} value={source.id}>{source.name} — по разрешению</option>)}
        </select>
      </label>
      <details className={panel.note}>
        <summary>Записать нового правообладателя (производитель, поставщик)</summary>
        <form className={styles.row} onSubmit={(event) => { void create(event); }}>
          <label className={styles.field}>
            <span>Кто разрешил</span>
            <input maxLength={200} minLength={2} onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className={styles.field}>
            <span>Основание: письмо, договор, дата</span>
            <input maxLength={1000} minLength={5} onChange={(event) => setBasis(event.target.value)} placeholder="Письмо от 20.11.2026: разрешено размещать фото продукции на сайте" required value={basis} />
          </label>
          <Button type="submit">Записать</Button>
        </form>
        {formError ? <p role="alert">{formError}</p> : null}
        <p>Без письменного разрешения правообладателя фото не загружайте: картинки с сайтов поставщиков, маркетплейсов и из каталогов подбора чужие.</p>
      </details>
      <div aria-live="polite">
        <label aria-disabled={uploading} className={styles.shoot}>
          {progress ? `Загружается ${progress.done} из ${progress.total}…` : "Выбрать файлы"}
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="Выбрать файлы пакета"
            className={styles.hidden}
            disabled={uploading}
            multiple
            onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) void upload(files); }}
            type="file"
          />
        </label>
      </div>
      {results.length > 0 ? (
        <>
          <p className={panel.note}>В карточках: {attached} из {results.length}.</p>
          <ul className={styles.log}>
            {results.filter((result) => result.outcome !== "attached" && result.outcome !== "unchanged").map((result, index) => (
              <li key={`${result.fileName}:${index}`}>
                <strong>{result.fileName}</strong>{" — "}
                {result.outcome === "not_found" ? "товара с таким артикулом или кодом 1С нет." : null}
                {result.outcome === "error" ? result.message : null}
                {result.outcome === "ambiguous" ? `артикул у нескольких карточек: ${result.candidates.map((candidate) => `${candidate.shownName} (код 1С ${candidate.code})`).join("; ")}. Назовите файл кодом 1С нужной.` : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function Takedown({ onChange }: { onChange: () => void }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const limit = 24;
  const photos = useResource(() => api<Page<Photo>>(`/staff/catalog/photos/images${queryString({ limit, offset, search })}`), [offset, search]);
  const sources = useResource(() => api<{ items: RightsSource[] }>("/staff/catalog/photos/sources"), []);

  const act = async (path: string) => {
    setError(null);
    try {
      await api(path, { body: JSON.stringify({ reason }), method: "POST" });
      setAsking(null);
      setReason("");
      photos.reload();
      sources.reload();
      onChange();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const reasonForm = (path: string, label: string) => (
    <form onSubmit={(event) => { event.preventDefault(); void act(path); }}>
      <label className={styles.field}>
        <span>Причина: чьё требование или что не так</span>
        <input autoFocus maxLength={1000} minLength={3} onChange={(event) => setReason(event.target.value)} required value={reason} />
      </label>
      {error ? <p className={styles.meta} role="alert">{error}</p> : null}
      <div className={styles.row}>
        <Button appearance="primary" type="submit">{label}</Button>
        <Button onClick={() => { setAsking(null); setError(null); }}>Отмена</Button>
      </div>
    </form>
  );

  return (
    <>
      <p className={panel.note}>
        Пришла претензия или фото оказалось чужим — снимите его: оно сразу пропадёт со всех карточек, файл удалится, а
        запись (что, откуда, почему, кто снял) останется. Тот же файл больше не встанет, даже если его снова пришлёт 1С.
      </p>
      <div className={styles.filters}>
        <input aria-label="Найти фото по товару: название, артикул или код 1С" onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder="Название, артикул или код 1С" type="search" value={search} />
      </div>
      {photos.error ? <RequestError error={photos.error} onRetry={photos.reload} /> : null}
      {photos.data && photos.data.items.length === 0 ? <p className={panel.note}>Фото пока нет.</p> : null}
      <ul className={styles.photos}>
        {(photos.data?.items ?? []).map((photo) => (
          <li className={styles.photo} key={photo.id}>
            <img alt="" height={88} loading="lazy" src={photo.url} width={88} />
            <div>
              <strong>{photo.shownName}</strong>
              <div className={styles.meta}>Код 1С {photo.code}</div>
              <div className={styles.meta}>{photo.rightsSource ? `${SOURCE_LABELS[photo.source]}: ${photo.rightsSource}` : SOURCE_LABELS[photo.source]}{photo.uploadedBy ? ` · ${photo.uploadedBy}` : ""} · {formatDate(photo.createdAt, false)}</div>
            </div>
            {asking === photo.id
              ? reasonForm(`/staff/catalog/photos/images/${photo.id}/withdraw`, "Снять с сайта")
              : <Button onClick={() => { setAsking(photo.id); setReason(""); setError(null); }} style={{ gridColumn: "1 / -1" }}>Снять с сайта</Button>}
          </li>
        ))}
      </ul>
      {photos.data && photos.data.total > limit ? <div className={styles.pager}><Pagination limit={limit} offset={offset} onChange={setOffset} total={photos.data.total} /></div> : null}
      {sources.data && sources.data.items.length > 0 ? (
        <>
          <h3>Разрешения правообладателей</h3>
          <ul className={styles.sources}>
            {sources.data.items.map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <p className={styles.meta}>{source.basis}</p>
                  <p className={styles.meta}>{source.revokedAt ? `Отозвано ${formatDate(source.revokedAt, false)}` : `Фото на сайте: ${source.photos}`}</p>
                </div>
                {source.revokedAt ? null : asking === source.id
                  ? reasonForm(`/staff/catalog/photos/sources/${source.id}/revoke`, "Отозвать и снять все его фото")
                  : <Button onClick={() => { setAsking(source.id); setReason(""); setError(null); }}>Разрешение отозвано</Button>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
