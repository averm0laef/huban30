"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, errorText, readSession, type SessionView } from "../_lib/storefront-api";
import styles from "./storefront.module.css";

interface AccountView {
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
  awaiting_delivery_terms: "Согласование доставки",
  cancelled: "Отменён",
  completed: "Завершён",
  paid: "Оплачен",
  pending_payment: "Ожидает оплаты",
  processing: "В работе",
  ready: "Готов к выдаче",
  refunded: "Возвращён",
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

function ProductList({ empty, items, onRemove }: { empty: string; items: ProductView[]; onRemove?: (id: string) => void }) {
  if (!items.length) return <p className={styles.emptyInline}>{empty}</p>;
  return (
    <div className={styles.compactProductList}>
      {items.map((product) => (
        <article key={product.id}>
          <div><small>{product.brandName ?? "Без бренда"} · {product.sku}</small><h3><Link href={`/catalog/product/${product.slug}`}>{product.name}</Link></h3></div>
          <div className={styles.compactProductActions}>
            <strong>{product.price ? money(product.price.amountKopeks) : "Цена уточняется"}</strong>
            {onRemove ? <button type="button" onClick={() => onRemove(product.id)}>Удалить</button> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProfileClient() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [session, setSession] = useState<SessionView | null>(null);
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
      setSession(currentSession);
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
      setData((current) => current ? { ...current, history: [] } : current);
      setNotice("История очищена");
    } catch (caught) { setError(errorText(caught)); } finally { setPending(""); }
  }

  async function logout() {
    setPending("logout"); setError("");
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      router.replace("/auth?mode=login");
      router.refresh();
    } catch (caught) { setError(errorText(caught)); setPending(""); }
  }

  if (phase === "loading") return <div className={`${styles.page} ${styles.loadingState}`} role="status"><h1>Открываем кабинет</h1><p>Проверяем сессию и загружаем данные.</p></div>;
  if (phase === "guest") return <div className={`${styles.page} ${styles.emptyState}`}><h1>Нужен вход</h1><p>Личный кабинет защищён серверной сессией.</p><Link className={styles.primaryAction} href="/auth?mode=login">Войти</Link></div>;
  if (phase === "staff") return <div className={`${styles.page} ${styles.emptyState}`}><h1>Кабинет сотрудника</h1><p>Для роли {session?.role} доступна рабочая панель с обязательной проверкой TOTP.</p><Link className={styles.primaryAction} href="/admin">Открыть панель</Link></div>;
  if (phase === "error" || !data) return <div className={`${styles.page} ${styles.errorState}`} role="alert"><h1>Кабинет не загрузился</h1><p>{error}</p><button className={styles.secondaryAction} type="button" onClick={() => void load()}>Повторить</button></div>;

  return (
    <div className={styles.page}>
      <header className={styles.profileHeading}>
        <div><p className={styles.eyebrow}>Личный кабинет</p><h1>{data.account.displayName ?? "Профиль клиента"}</h1><p>{data.account.email}</p></div>
        <button className={styles.secondaryAction} type="button" disabled={pending === "logout"} onClick={() => void logout()}>Выйти</button>
      </header>
      {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к сети. Изменения нельзя сохранить до восстановления связи.</div> : null}
      {profileDirty || addressDirty ? <div className={styles.unsavedNotice} role="status">Есть несохранённые изменения.</div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>Не получилось</strong><p>{error}</p></div> : null}
      {notice ? <div className={styles.formSuccess} role="status"><strong>Готово</strong><p>{notice}</p></div> : null}
      <nav className={styles.profileNav} aria-label="Разделы кабинета">
        <a href="#orders">Заказы</a><a href="#account">Профиль</a><a href="#addresses">Адреса</a><a href="#wishlist">Избранное</a><a href="#history">История</a><a href="#security">Безопасность</a>
      </nav>

      <section id="orders" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Покупки</p><h2>Заказы</h2></div><Link href="/checkout">Оформить заказ</Link></div>
        {data.orders.length ? <div className={styles.orderList}>{data.orders.map((order) => (
          <Link key={order.id} href={`/profile/orders/${order.id}`}>
            <span><strong>{order.publicNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("ru-RU")}</small></span>
            <span>{statusLabels[order.status] ?? order.status}</span><strong>{money(order.totalAmountKopeks)}</strong>
          </Link>
        ))}</div> : <p className={styles.emptyInline}>Заказов пока нет. Добавьте товары из каталога и оформите покупку.</p>}
      </section>

      <section id="account" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Контакты</p><h2>Данные профиля</h2></div></div>
        <form className={styles.twoColumnForm} onSubmit={saveProfile} onChange={() => setProfileDirty(true)}>
          <label className={styles.field}>Имя<input name="displayName" required minLength={2} maxLength={160} defaultValue={data.account.displayName ?? ""} autoComplete="name" /></label>
          <label className={styles.field}>Телефон<input name="phone" type="tel" pattern="\+[1-9][0-9]{6,14}" placeholder="+79240000000" defaultValue={data.account.phone ?? ""} autoComplete="tel" /></label>
          <label className={styles.field}>Email<input value={data.account.email} disabled aria-describedby="email-note" /></label>
          <p id="email-note" className={styles.fieldNote}>Email подтверждён и меняется только через поддержку.</p>
          <button className={styles.submitButton} type="submit" disabled={!online || !profileDirty || pending === "profile"}>{pending === "profile" ? "Сохраняем..." : "Сохранить профиль"}</button>
        </form>
      </section>

      <section id="addresses" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Получение</p><h2>Адреса</h2></div></div>
        {data.addresses.length ? <div className={styles.addressList}>{data.addresses.map((address) => (
          <article key={address.id}>
            <div><h3>{address.label} {address.isDefault ? <small>Основной</small> : null}</h3><p>{address.region}, {address.city}, {address.street}, {address.house}{address.apartment ? `, кв. ${address.apartment}` : ""}</p><p>{address.recipientName}, {address.phone}</p></div>
            <div><button type="button" onClick={() => { setEditingAddress(address); setAddressDirty(false); document.getElementById("address-form")?.scrollIntoView({ behavior: "smooth" }); }}>Редактировать</button><button type="button" disabled={pending === `delete-${address.id}`} onClick={() => void deleteAddress(address)}>Удалить</button></div>
          </article>
        ))}</div> : <p className={styles.emptyInline}>Сохранённых адресов нет. Для самовывоза адрес не требуется.</p>}
        <form id="address-form" key={editingAddress?.id ?? "new"} className={styles.addressForm} onSubmit={saveAddress} onChange={() => setAddressDirty(true)}>
          <h3>{editingAddress ? `Редактирование: ${editingAddress.label}` : "Новый адрес"}</h3>
          <label className={styles.field}>Название<input name="label" required maxLength={80} defaultValue={editingAddress?.label ?? ""} placeholder="Дом" /></label>
          <label className={styles.field}>Получатель<input name="recipientName" required maxLength={160} defaultValue={editingAddress?.recipientName ?? data.account.displayName ?? ""} autoComplete="name" /></label>
          <label className={styles.field}>Телефон<input name="phone" required type="tel" pattern="\+[1-9][0-9]{6,14}" defaultValue={editingAddress?.phone ?? data.account.phone ?? ""} autoComplete="tel" /></label>
          <label className={styles.field}>Индекс<input name="postalCode" inputMode="numeric" pattern="[0-9]{6}" defaultValue={editingAddress?.postalCode ?? ""} autoComplete="postal-code" /></label>
          <label className={styles.field}>Регион<input name="region" required maxLength={200} defaultValue={editingAddress?.region ?? "Забайкальский край"} autoComplete="address-level1" /></label>
          <label className={styles.field}>Город или посёлок<input name="city" required maxLength={200} defaultValue={editingAddress?.city ?? "Чернышевск"} autoComplete="address-level2" /></label>
          <label className={styles.field}>Улица<input name="street" required maxLength={200} defaultValue={editingAddress?.street ?? ""} autoComplete="street-address" /></label>
          <label className={styles.field}>Дом<input name="house" required maxLength={40} defaultValue={editingAddress?.house ?? ""} /></label>
          <label className={styles.field}>Квартира<input name="apartment" maxLength={40} defaultValue={editingAddress?.apartment ?? ""} /></label>
          <label className={`${styles.field} ${styles.fullField}`}>Комментарий<textarea name="deliveryNote" maxLength={500} defaultValue={editingAddress?.deliveryNote ?? ""} /></label>
          <label className={`${styles.checkboxField} ${styles.fullField}`}><input name="isDefault" type="checkbox" defaultChecked={editingAddress?.isDefault ?? false} /> Использовать как основной</label>
          <div className={`${styles.formActions} ${styles.fullField}`}><button className={styles.submitButton} type="submit" disabled={!online || pending === "address"}>{pending === "address" ? "Сохраняем..." : editingAddress ? "Сохранить адрес" : "Добавить адрес"}</button>{editingAddress ? <button className={styles.secondaryAction} type="button" onClick={() => { setEditingAddress(null); setAddressDirty(false); }}>Отменить</button> : null}</div>
        </form>
      </section>

      <section id="wishlist" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Сохранено</p><h2>Избранное</h2></div></div>
        <ProductList items={data.wishlist} empty="В избранном пока ничего нет." onRemove={(id) => { if (!pending) void removeWishlist(id); }} />
      </section>

      <section id="history" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Недавно</p><h2>История просмотра</h2></div>{data.history.length ? <button type="button" disabled={pending === "history"} onClick={() => void clearHistory()}>Очистить</button> : null}</div>
        <ProductList items={data.history} empty="История просмотра пуста." />
      </section>

      <section id="security" className={styles.profileSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Доступ</p><h2>Сменить пароль</h2></div></div>
        <form className={styles.stackForm} onSubmit={changePassword}>
          <label className={styles.field}>Текущий пароль<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></label>
          <label className={styles.field}>Новый пароль<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>Не менее 12 символов.</small></label>
          <label className={styles.field}>Повторите новый пароль<input name="passwordConfirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
          <button className={styles.submitButton} type="submit" disabled={!online || pending === "password"}>{pending === "password" ? "Меняем..." : "Изменить пароль"}</button>
        </form>
      </section>
    </div>
  );
}
