"use client";

import {
  Apps24Regular,
  Call20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Dismiss24Regular,
  Location24Regular,
  Navigation24Regular,
  Person24Regular,
} from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  MESSENGERS, SITE_LEGAL_NAME, STORE_HOURS, STORE_LOCALITY, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET,
} from "../../site-config";
import { catalogDrawerSections, type CatalogMenuSection } from "../_lib/store-categories";
import { BrandLockup } from "./brand-mark";
import { CarLineIcon } from "./car-picture";
import { DrawerVehicle } from "./header-vehicle";
import { MessengerIcon } from "./messenger-icon";
import { useAccountDestination } from "./session-navigation";
import styles from "./storefront.module.css";

/** How many sections the drawer lists before «Все разделы». */
const COLLAPSED_SECTIONS = 8;
const customerLinks = [
  ["/how-to-order", "Как сделать заказ"],
  ["/delivery", "Доставка и самовывоз"],
  ["/returns", "Возврат товара"],
  ["/contacts", "Контакты"],
] as const;

/** One drawer per page; the compact bar's button opens it by this id. */
export const MOBILE_MENU_DIALOG_ID = "store-mobile-menu";
let lastOpener: HTMLElement | null = null;

function openMobileMenu(opener: HTMLElement) {
  const dialog = document.getElementById(MOBILE_MENU_DIALOG_ID);
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  lastOpener = opener;
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  dialog.showModal();
  if (opener.dataset.openCatalogue) {
    const catalogue = dialog.querySelector<HTMLElement>("[data-mobile-catalogue]");
    if (catalogue) dialog.scrollTop += catalogue.getBoundingClientRect().top - (dialog.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
  } else {
    dialog.scrollTop = 0;
  }
}

/**
 * The burger that stays next to the search once the header collapses on
 * scroll (the main row with the logo and its own burger is hidden then).
 */
export function CompactMenuButton() {
  return (
    <button type="button" className={styles.compactMenu} aria-label="Открыть меню" aria-haspopup="dialog"
      aria-controls={MOBILE_MENU_DIALOG_ID} onClick={(event) => openMobileMenu(event.currentTarget)}>
      <Navigation24Regular aria-hidden="true" />
    </button>
  );
}

export function MobileCatalogButton({ current, children }: { current: boolean; children: React.ReactNode }) {
  return (
    <button aria-controls={MOBILE_MENU_DIALOG_ID} aria-current={current ? "page" : undefined}
      aria-haspopup="dialog" className={styles.mobileNavItem} data-open-catalogue="true"
      onClick={(event) => openMobileMenu(event.currentTarget)} type="button">
      {children}
    </button>
  );
}

export function MobileStoreMenu({ catalogMenu }: { catalogMenu: CatalogMenuSection[] }) {
  const sections = catalogDrawerSections(catalogMenu);
  const [allSections, setAllSections] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = MOBILE_MENU_DIALOG_ID;
  const account = useAccountDestination();
  const guest = account.href.startsWith("/auth");

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    function closeOnDesktop() {
      if (desktop.matches) dialogRef.current?.close();
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function close() { dialogRef.current?.close(); }

  return (
    <>
      <button ref={openerRef} type="button" className={styles.mobileMenu} aria-label="Открыть меню" aria-haspopup="dialog" aria-controls={dialogId}
        onClick={(event) => openMobileMenu(event.currentTarget)}>
        <Navigation24Regular aria-hidden="true" />
      </button>
      <dialog id={dialogId} ref={dialogRef} className={styles.mobileDrawer} aria-label="Меню магазина"
        onClose={() => {
          // Back to whichever burger opened it, unless that one is hidden now.
          const target = lastOpener && lastOpener.offsetParent !== null ? lastOpener : openerRef.current;
          target?.focus({ preventScroll: true });
        }}
        onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div className={styles.mobileDrawerContent}>
          <div className={styles.drawerHeader}>
            <button type="button" onClick={close} aria-label="Закрыть меню"><Dismiss24Regular aria-hidden="true" /></button>
            <Link href="/" onClick={close} aria-label={SITE_LEGAL_NAME}>
              <BrandLockup className={styles.drawerBrand} />
            </Link>
          </div>
          <div className={styles.drawerBody}>

          <Link href={account.href} className={styles.drawerAccount} onClick={close}>
            <span className={styles.drawerAccountIcon} aria-hidden="true"><Person24Regular /></span>
            <span><strong>{guest ? "Вход или регистрация" : account.label}</strong>
              {guest ? <small>Заказы, избранное и адреса</small> : null}
            </span>
            <ChevronRight20Regular aria-hidden="true" />
          </Link>
          <DrawerVehicle className={styles.drawerLocation} icon={<CarLineIcon />} onNavigate={close} />
          <Link href="/map" className={styles.drawerLocation} onClick={close}>
            <Location24Regular aria-hidden="true" />
            <span><strong>{STORE_LOCALITY}, {STORE_STREET}</strong><small>{STORE_HOURS}</small></span>
          </Link>

          <nav className={styles.drawerCatalog} aria-labelledby={`${dialogId}-catalog`} data-mobile-catalogue>
            <h2 id={`${dialogId}-catalog`}>Каталог</h2>
            <ul>
              {(allSections ? sections : sections.slice(0, COLLAPSED_SECTIONS)).map((section) => {
                const subsectionsId = `${dialogId}-sub-${section.key}`;
                const expanded = openSection === section.key;
                return (
                  <li key={section.key}>
                    <div className={styles.drawerSectionRow}>
                      <Link href={section.href} prefetch={false} onClick={close}>
                        {section.image
                          ? <Image src={section.image} alt="" width={48} height={48} />
                          : <span className={styles.drawerSectionIcon}><Apps24Regular aria-hidden="true" /></span>}
                        <span>{section.label}</span>
                        {section.children.length === 0 ? <ChevronRight20Regular aria-hidden="true" /> : null}
                      </Link>
                      {section.children.length > 0 && (
                        <button aria-controls={expanded ? subsectionsId : undefined} aria-expanded={expanded} aria-label={`Подразделы: ${section.label}`}
                          className={styles.drawerSectionToggle} type="button"
                          onClick={() => setOpenSection(expanded ? null : section.key)}>
                          <ChevronDown20Regular aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {expanded && section.children.length > 0 && (
                      <ul className={styles.drawerSubsections} id={subsectionsId}>
                        {section.children.map((child) => (
                          <li key={child.key}><Link href={child.href} prefetch={false} onClick={close}>{child.label}</Link></li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {sections.length > COLLAPSED_SECTIONS && (
              <button aria-expanded={allSections} className={styles.drawerMore} type="button" onClick={() => setAllSections((value) => !value)}>
                {allSections ? "Свернуть разделы" : `Все разделы (${sections.length})`}
              </button>
            )}
            <Link className={styles.drawerAll} href="/catalog" onClick={close}>Весь каталог</Link>
          </nav>

          <nav className={styles.drawerCustomer} aria-labelledby={`${dialogId}-customers`}>
            <h2 id={`${dialogId}-customers`}>Покупателям</h2>
            <ul>
              {customerLinks.map(([href, title]) => <li key={href}><Link href={href} onClick={close}>{title}</Link></li>)}
            </ul>
          </nav>

          <div className={styles.drawerContact}>
            <a className={styles.drawerPhone} href={`tel:${STORE_PHONE}`}>
              <Call20Regular aria-hidden="true" />{STORE_PHONE_DISPLAY}
            </a>
            <ul aria-label="Мессенджеры" className={styles.drawerMessengers}>
              {MESSENGERS.map((messenger) => (
                <li key={messenger.id}>
                  <a aria-label={messenger.label} href={messenger.href} rel="noreferrer" target="_blank">
                    <MessengerIcon id={messenger.id} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
