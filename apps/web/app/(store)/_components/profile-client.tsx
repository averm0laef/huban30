"use client";

import { ChevronRight20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, errorText, readSession } from "../_lib/storefront-api";
import { customerAvatarKey, customerAvatarSrc, type CustomerAvatarKey } from "../_lib/customer-avatars";
import { forgetRecordedProductView } from "../_lib/product-view-history";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import { AvatarPicker } from "./avatar-picker";
import { AddToCartButton } from "./cart-actions";
import { CatalogPhoto } from "./catalog-photo";
import { GaragePanel } from "./garage-panel";
import { SocialConnections } from "./social-login";
import styles from "./storefront.module.css";
import { notifyAfterNavigation } from "../_lib/toast";
import { PhoneField } from "./masked-fields";

interface AccountView {
  /** False while the picture is the automatic one. */
  avatarChosen?: boolean;
  avatarKey?: string;
  createdAt: string;
  displayName: string | null;
  email: string;
  phone: string | null;
}

interface AddressView {
  apartment: string | null;
  city: string;
  deliveryNote: string | null;
  house: string;
  id: string;
  isDefault: boolean;
  label: string;
  phone: string;
  postalCode: string | null;
  recipientName: string;
  region: string;
  street: string;
}

interface ProductView {
  availableQuantity: number;
  brandName: string | null;
  category?: { name: string | null; slug: string } | null;
  id: string;
  imageUrl: string | null;
  name: string;
  price: { amountKopeks: number; currency: string } | null;
  sku: string;
  slug: string;
}

interface OrderSummary {
  createdAt: string;
  id: string;
  publicNumber: string;
  status: string;
  totalAmountKopeks: number;
}

interface ProfileData {
  account: AccountView;
  addresses: AddressView[];
  history: ProductView[];
  orders: OrderSummary[];
  wishlist: ProductView[];
}

const statusLabels: Record<string, string> = {
  awaiting_confirmation: "Ожидает подтверждения",
  awaiting_delivery_terms: "Согласование доставки",
  cancelled: "Отменён",
  completed: "Завершён",
  processing: "В работе",
  ready: "Готов к выдаче",
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value / 100);
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

const GENITIVE_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

type AccountTab = "orders" | "garage" | "wishlist" | "history" | "addresses" | "account" | "security";

const accountTabs: Array<{ id: AccountTab; label: string }> = [
  { id: "orders", label: "Заказы" },
  { id: "garage", label: "Мои автомобили" },
  { id: "wishlist", label: "Избранное" },
  { id: "history", label: "Вы смотрели" },
  { id: "addresses", label: "Адреса" },
  { id: "account", label: "Личные данные" },
  { id: "security", label: "Безопасность" },
];

function isAccountTab(value: string): value is AccountTab {
  return accountTabs.some((tab) => tab.id === value);
}

/** Status → tone for the order badge; the word always carries the meaning. */
const statusTones: Record<string, "brand" | "success" | "warning" | "muted"> = {
  awaiting_confirmation: "warning",
  awaiting_delivery_terms: "warning",
  cancelled: "muted",
  completed: "muted",
  processing: "brand",
  ready: "success",
};

function pluralItems(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} товар`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} товара`;
  return `${count} товаров`;
}

function EmptyPanel({ action, text, title }: { action?: { href: string; label: string }; text: string; title: string }) {
  return (
    <div className={styles.accountEmpty}>
      <h3>{title}</h3>
      <p>{text}</p>
      {action ? <Link className={styles.primaryAction} href={action.href}>{action.label}</Link> : null}
    </div>
  );
}

function ProductList({ empty, items, onRemove }: { empty: { text: string; title: string }; items: ProductView[]; onRemove?: (id: string) => void }) {
  if (!items.length) return <EmptyPanel action={{ href: "/catalog", label: "Перейти в каталог" }} text={empty.text} title={empty.title} />;
  return (
    <ul className={styles.accountProducts}>
      {items.map((product) => {
        const inStock = product.availableQuantity > 0;
        return (
          <li key={product.id} className={styles.accountProduct}>
            <CatalogPhoto className={styles.accountProductMedia} noteClassName={styles.accountProductPhotoNote}
              sizes="(max-width: 640px) 64px, 72px" src={product.imageUrl} />
            <div className={styles.accountProductBody}>
              <p className={styles.accountProductMeta}>{product.brandName ? <strong>{product.brandName}</strong> : null}{product.brandName ? " · " : ""}Арт. {product.sku}</p>
              <h3><Link href={`/catalog/product/${product.slug}`}>{product.name}</Link></h3>
              <p className={inStock ? styles.accountStockIn : styles.accountStockOut}>{inStock ? "В наличии" : "Нет в наличии"}</p>
            </div>
            <div className={styles.accountProductSide}>
              <strong className={styles.accountProductPrice}>{product.price ? money(product.price.amountKopeks) : "Цена по запросу"}</strong>
              <div className={styles.accountProductActions}>
                {inStock && product.price ? <AddToCartButton productId={product.id} /> : (
                  <ExpertHelpQueryLink query={product.sku} className={styles.accountProductHelp}>
                    {inStock ? "Уточнить цену" : "Уточнить наличие"}
                  </ExpertHelpQueryLink>
                )}
                {onRemove ? (
                  <button className={styles.accountTextButton} type="button" onClick={() => onRemove(product.id)} aria-label={`Убрать «${product.name}» из избранного`}>Убрать</button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileClient({ initialTab = "orders", socialStatus }: { initialTab?: "orders" | "garage" | "security" | "addresses" | "wishlist"; socialStatus?: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [garageCount, setGarageCount] = useState(0);
  const [data, setData] = useState<ProfileData | null>(null);
  const [phase, setPhase] = useState<"loading" | "guest" | "staff" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const [addressDirty, setAddressDirty] = useState(false);
  const [editingAddress, setEditingAddress] = useState<AddressView | null>(null);
  useUnsavedWarning(profileDirty || addressDirty);

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const currentSession = await readSession();
      if (!currentSession) {
        setPhase("guest");
        return;
      }
      if (currentSession.role !== "customer") {
        setPhase("staff");
        return;
      }
      const [account, addresses, wishlist, history, orders] = await Promise.all([
        apiRequest<AccountView>("/account"),
        apiRequest<{ items: AddressView[] }>("/account/addresses"),
        apiRequest<{ items: ProductView[] }>("/account/wishlist?limit=24"),
        apiRequest<{ items: ProductView[] }>("/account/history?limit=24"),
        apiRequest<OrderSummary[]>("/orders?limit=50"),
      ]);
      setData({ account, addresses: addresses.items, history: history.items, orders, wishlist: wishlist.items });
      setPhase("ready");
      setProfileDirty(false);
      setAddressDirty(false);
    } catch (caught) {
      setError(errorText(caught));
      setPhase("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Sections are addressable as /profile#wishlist etc., so old anchor links
  // and the browser's back button keep working.
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isAccountTab(hash)) setTab(hash);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function openTab(next: AccountTab) {
    if (next === tab) return;
    if ((profileDirty || addressDirty) && !window.confirm("Перейти в другой раздел без сохранения изменений?")) return;
    setTab(next);
    setNotice("");
    setError("");
    setProfileDirty(false);
    setAddressDirty(false);
    setEditingAddress(null);
    window.history.replaceState(null, "", `#${next}`);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending("profile"); setError(""); setNotice("");
    try {
      const account = await apiRequest<AccountView>("/account", {
        method: "PATCH",
        body: { displayName: String(form.get("displayName") ?? "").trim(), phone: nullable(form.get("phone")) },
      });
      setData((current) => current ? { ...current, account } : current);
      setProfileDirty(false);
      setNotice("Контактные данные сохранены");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function saveAvatar(avatarKey: CustomerAvatarKey | null) {
    setPending("avatar"); setError(""); setNotice("");
    try {
      const account = await apiRequest<AccountView>("/account/avatar", { method: "PATCH", body: { avatarKey } });
      setData((current) => current ? { ...current, account } : current);
      setNotice(avatarKey ? "Картинка профиля сохранена" : "Картинка снова подбирается автоматически");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const newPassword = String(form.get("newPassword") ?? "");
    setPending("password"); setError(""); setNotice("");
    try {
      if (newPassword !== form.get("passwordConfirm")) throw new Error("Новые пароли не совпадают");
      const result = await apiRequest<{ message: string }>("/account/password", {
        method: "PUT",
        body: { currentPassword: form.get("currentPassword"), newPassword },
      });
      element.reset();
      setNotice(result.message);
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const body = {
      apartment: nullable(form.get("apartment")), city: String(form.get("city") ?? "").trim(),
      deliveryNote: nullable(form.get("deliveryNote")), house: String(form.get("house") ?? "").trim(),
      isDefault: form.get("isDefault") === "on", label: String(form.get("label") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(), postalCode: nullable(form.get("postalCode")),
      recipientName: String(form.get("recipientName") ?? "").trim(), region: String(form.get("region") ?? "").trim(),
      street: String(form.get("street") ?? "").trim(),
    };
    setPending("address"); setError(""); setNotice("");
    try {
      const address = await apiRequest<AddressView>(editingAddress ? `/account/addresses/${editingAddress.id}` : "/account/addresses", {
        method: editingAddress ? "PATCH" : "POST", body,
      });
      setData((current) => current ? { ...current, addresses: editingAddress
        ? current.addresses.map((item) => item.id === address.id ? address : { ...item, isDefault: address.isDefault ? false : item.isDefault })
        : [address, ...current.addresses.map((item) => ({ ...item, isDefault: address.isDefault ? false : item.isDefault }))] } : current);
      element.reset();
      setEditingAddress(null);
      setAddressDirty(false);
      setNotice(editingAddress ? "Адрес обновлён" : "Адрес добавлен");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function deleteAddress(address: AddressView) {
    if (!window.confirm(`Удалить адрес «${address.label}»?`)) return;
    setPending(`delete-${address.id}`); setError("");
    try {
      await apiRequest<void>(`/account/addresses/${address.id}`, { method: "DELETE" });
      setData((current) => current ? { ...current, addresses: current.addresses.filter((item) => item.id !== address.id) } : current);
      if (editingAddress?.id === address.id) setEditingAddress(null);
      setNotice("Адрес удалён");
      await load();
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function removeWishlist(productId: string) {
    setPending(`wishlist-${productId}`); setError("");
    try {
      await apiRequest(`/account/wishlist/${productId}`, { method: "DELETE" });
      setData((current) => current ? { ...current, wishlist: current.wishlist.filter((item) => item.id !== productId) } : current);
      setNotice("Товар удалён из избранного");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function clearHistory() {
    if (!window.confirm("Очистить историю просмотра?")) return;
    setPending("history"); setError("");
    try {
      await apiRequest<void>("/account/history", { method: "DELETE" });
      forgetRecordedProductView();
      setData((current) => current ? { ...current, history: [] } : current);
      setNotice("История очищена");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function logout() {
    setPending("logout"); setError("");
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      notifyAfterNavigation({ kind: "success", title: "Вы вышли из кабинета" });
      router.replace("/auth?mode=login");
      router.refresh();
    } catch (caught) { setError(errorText(caught)); setPending(""); }
  }

  if (phase === "loading") return <div className={`${styles.page} ${styles.loadingState}`} role="status"><h1>Открываем личный кабинет</h1><p>Загружаем заказы и сохранённые товары.</p></div>;
  if (phase === "guest") return <div className={`${styles.page} ${styles.emptyState}`}><h1>Войдите в личный кабинет</h1><p>Здесь собраны ваши заказы, избранные детали и адреса доставки.</p><Link className={styles.primaryAction} href="/auth?mode=login">Войти</Link></div>;
  if (phase === "staff") return <div className={`${styles.page} ${styles.emptyState}`}><h1>Вы вошли как сотрудник</h1><p>Заказы покупателей, каталог и обращения находятся в рабочей панели магазина.</p><Link className={styles.primaryAction} href="/admin">Открыть рабочую панель</Link></div>;
  if (phase === "error" || !data) return <div className={`${styles.page} ${styles.errorState}`} role="alert"><h1>Не удалось открыть кабинет</h1><p>{error || "Проверьте подключение к интернету и попробуйте ещё раз."}</p><button className={styles.secondaryAction} type="button" onClick={() => void load()}>Повторить</button></div>;

  const counts: Partial<Record<AccountTab, number>> = {
    addresses: data.addresses.length,
    garage: garageCount,
    history: data.history.length,
    orders: data.orders.length,
    wishlist: data.wishlist.length,
  };
  const activeLabel = accountTabs.find((item) => item.id === tab)?.label ?? "";
  const created = new Date(data.account.createdAt);
  const memberSince = `${GENITIVE_MONTHS[created.getMonth()]} ${created.getFullYear()} года`;

  return (
    <div className={`${styles.page} ${styles.accountPage}`}>
      <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
        <Link href="/">Главная</Link><span aria-hidden="true">/</span>
        <span aria-current="page">Личный кабинет</span>
      </nav>

      <div className={styles.accountLayout}>
        <aside className={styles.accountAside}>
          <div className={styles.accountCard}>
            <img alt="" aria-hidden="true" className={styles.accountAvatar} height={52} src={customerAvatarSrc(customerAvatarKey(data.account.email, data.account.avatarKey))} width={52} />
            <div className={styles.accountIdentity}>
              <h1>{data.account.displayName ?? "Покупатель"}</h1>
              <p>{data.account.email}</p>
              <p className={styles.accountSince}>С нами с {memberSince}</p>
            </div>
          </div>
          <nav className={styles.accountNav} aria-label="Разделы кабинета">
            {accountTabs.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); openTab(item.id); }}
              >
                <span>{item.label}</span>
                {counts[item.id] ? <span className={styles.accountNavCount}>{counts[item.id]}</span> : null}
              </a>
            ))}
          </nav>
          <button className={styles.accountLogout} type="button" disabled={pending === "logout"} onClick={() => void logout()}>
            {pending === "logout" ? "Выходим…" : "Выйти из аккаунта"}
          </button>
        </aside>

        <div className={styles.accountMain}>
          {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к интернету. Изменения сохранятся, когда связь восстановится и вы нажмёте «Сохранить».</div> : null}
          {profileDirty || addressDirty ? <div className={styles.unsavedNotice} role="status">Есть несохранённые изменения.</div> : null}
          {error ? <div className={styles.formError} role="alert"><strong>Не получилось</strong><p>{error}</p></div> : null}
          {notice ? <div className={styles.formSuccess} role="status"><strong>Готово</strong><p>{notice}</p></div> : null}

          <section id={tab} className={styles.accountPanel} aria-label={activeLabel}>
            {tab === "orders" ? (
              <>
                <div className={styles.accountPanelHead}>
                  <h2>Заказы</h2>
                  <Link className={styles.secondaryAction} href="/catalog">В каталог</Link>
                </div>
                {data.orders.length ? (
                  <ul className={styles.accountOrders}>
                    {data.orders.map((order) => (
                      <li key={order.id}>
                        <Link className={styles.accountOrder} href={`/profile/orders/${order.id}`}>
                          <span className={styles.accountOrderId}>
                            <strong>Заказ {order.publicNumber}</strong>
                            <small>от {new Date(order.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</small>
                          </span>
                          <span className={styles.accountOrderStatus} data-tone={statusTones[order.status] ?? "muted"}>{statusLabels[order.status] ?? "Обрабатывается"}</span>
                          <strong className={styles.accountOrderTotal}>{money(order.totalAmountKopeks)}</strong>
                          <ChevronRight20Regular aria-hidden="true" className={styles.accountOrderChevron} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyPanel action={{ href: "/catalog", label: "Перейти в каталог" }} title="Заказов пока нет" text="Добавьте детали в корзину и оформите заказ — он появится здесь вместе со статусом." />
                )}
              </>
            ) : null}

            {tab === "garage" ? <GaragePanel onCount={setGarageCount} /> : null}

            {tab === "wishlist" ? (
              <>
                <div className={styles.accountPanelHead}>
                  <h2>Избранное</h2>
                  {data.wishlist.length ? <p>{pluralItems(data.wishlist.length)}</p> : null}
                </div>
                <ProductList items={data.wishlist} empty={{ title: "В избранном пусто", text: "Отмечайте нужные детали в каталоге, чтобы вернуться к ним позже." }} onRemove={(id) => { if (!pending) void removeWishlist(id); }} />
              </>
            ) : null}

            {tab === "history" ? (
              <>
                <div className={styles.accountPanelHead}>
                  <h2>Вы смотрели</h2>
                  {data.history.length ? <button className={styles.accountTextButton} type="button" disabled={pending === "history"} onClick={() => void clearHistory()}>Очистить историю</button> : null}
                </div>
                <ProductList items={data.history} empty={{ title: "История пуста", text: "Здесь появятся товары, которые вы открывали в каталоге." }} />
              </>
            ) : null}

            {tab === "addresses" ? (
              <>
                <div className={styles.accountPanelHead}>
                  <h2>Адреса доставки</h2>
                  <p>Для самовывоза адрес не нужен.</p>
                </div>
                {data.addresses.length ? (
                  <ul className={styles.accountAddresses}>
                    {data.addresses.map((address) => (
                      <li key={address.id} className={styles.accountAddress} data-default={address.isDefault || undefined}>
                        <div>
                          <h3>{address.label}{address.isDefault ? <span className={styles.accountDefaultBadge}>Основной</span> : null}</h3>
                          <p>{address.region}, {address.city}, {address.street}, {address.house}{address.apartment ? `, кв. ${address.apartment}` : ""}</p>
                          <p>{address.recipientName} · {address.phone}</p>
                        </div>
                        <div className={styles.accountAddressActions}>
                          <button className={styles.accountTextButton} type="button" onClick={() => { setEditingAddress(address); setAddressDirty(false); document.getElementById("address-form")?.scrollIntoView({ behavior: "smooth" }); }}>Изменить</button>
                          <button className={styles.accountTextButtonDanger} type="button" disabled={pending === `delete-${address.id}`} onClick={() => void deleteAddress(address)}>Удалить</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <form id="address-form" key={editingAddress?.id ?? "new"} className={styles.addressForm} onSubmit={saveAddress} onChange={() => setAddressDirty(true)}>
                  <h3>{editingAddress ? `Изменить адрес «${editingAddress.label}»` : "Новый адрес"}</h3>
                  <label className={styles.field}>Название<input name="label" required maxLength={80} defaultValue={editingAddress?.label ?? ""} placeholder="Например, Дом" /></label>
                  <label className={styles.field}>Получатель<input name="recipientName" required maxLength={160} defaultValue={editingAddress?.recipientName ?? data.account.displayName ?? ""} autoComplete="name" /></label>
                  <label className={styles.field}>Телефон<PhoneField name="phone" required defaultValue={editingAddress?.phone ?? data.account.phone ?? ""} /></label>
                  <label className={styles.field}>Индекс<input name="postalCode" inputMode="numeric" pattern="[0-9]{6}" defaultValue={editingAddress?.postalCode ?? ""} autoComplete="postal-code" /></label>
                  <label className={styles.field}>Регион<input name="region" required maxLength={200} defaultValue={editingAddress?.region ?? "Забайкальский край"} autoComplete="address-level1" /></label>
                  <label className={styles.field}>Город или посёлок<input name="city" required maxLength={200} defaultValue={editingAddress?.city ?? "Чернышевск"} autoComplete="address-level2" /></label>
                  <label className={styles.field}>Улица<input name="street" required maxLength={200} defaultValue={editingAddress?.street ?? ""} autoComplete="street-address" /></label>
                  <label className={styles.field}>Дом<input name="house" required maxLength={40} defaultValue={editingAddress?.house ?? ""} /></label>
                  <label className={styles.field}>Квартира<input name="apartment" maxLength={40} defaultValue={editingAddress?.apartment ?? ""} /></label>
                  <label className={`${styles.field} ${styles.fullField}`}>Комментарий для доставки<textarea name="deliveryNote" maxLength={500} defaultValue={editingAddress?.deliveryNote ?? ""} placeholder="Подъезд, ориентир, удобное время" /></label>
                  <label className={`${styles.checkboxField} ${styles.fullField}`}><input name="isDefault" type="checkbox" defaultChecked={editingAddress?.isDefault ?? data.addresses.length === 0} /> Сделать основным адресом</label>
                  <div className={`${styles.formActions} ${styles.fullField}`}><button className={styles.submitButton} type="submit" disabled={!online || pending === "address"}>{pending === "address" ? "Сохраняем…" : editingAddress ? "Сохранить адрес" : "Добавить адрес"}</button>{editingAddress ? <button className={styles.secondaryAction} type="button" onClick={() => { setEditingAddress(null); setAddressDirty(false); }}>Отменить</button> : null}</div>
                </form>
              </>
            ) : null}

            {tab === "account" ? (
              <>
                <div className={styles.accountPanelHead}>
                  <h2>Личные данные</h2>
                  <p>Подставляются в заказ автоматически.</p>
                </div>
                <AvatarPicker
                  chosen={data.account.avatarChosen ?? false}
                  current={customerAvatarKey(data.account.email, data.account.avatarKey)}
                  disabled={!online}
                  key={data.account.avatarKey ?? "auto"}
                  onSave={(key) => void saveAvatar(key)}
                  pending={pending === "avatar"}
                />
                <form className={`${styles.twoColumnForm} ${styles.accountContactForm}`} onSubmit={saveProfile} onChange={() => setProfileDirty(true)}>
                  <label className={styles.field}>Имя<input name="displayName" required minLength={2} maxLength={160} defaultValue={data.account.displayName ?? ""} autoComplete="name" /></label>
                  <label className={styles.field}>Телефон<PhoneField name="phone" defaultValue={data.account.phone ?? ""} /></label>
                  <div className={`${styles.field} ${styles.fullField}`}>
                    <label htmlFor="account-email">Email</label>
                    <input id="account-email" type="email" value={data.account.email} readOnly aria-describedby="email-note" />
                    <small id="email-note">Для смены email <Link href="/chat">напишите в чат</Link> или позвоните в магазин.</small>
                  </div>
                  <button className={styles.submitButton} type="submit" disabled={!online || !profileDirty || pending === "profile"}>{pending === "profile" ? "Сохраняем…" : "Сохранить"}</button>
                </form>
              </>
            ) : null}

            {tab === "security" ? (
              <>
                <SocialConnections status={socialStatus} />
                <div className={styles.accountPanelHead}>
                  <h2>Смена пароля</h2>
                  <p>Не менее 12 символов.</p>
                </div>
                <form className={`${styles.stackForm} ${styles.accountNarrowForm}`} onSubmit={changePassword}>
                  <label className={styles.field}>Текущий пароль<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></label>
                  <label className={styles.field}>Новый пароль<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                  <label className={styles.field}>Повторите новый пароль<input name="passwordConfirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                  <button className={styles.submitButton} type="submit" disabled={!online || pending === "password"}>{pending === "password" ? "Меняем…" : "Изменить пароль"}</button>
                </form>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
