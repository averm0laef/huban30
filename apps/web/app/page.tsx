import Image from "next/image";
import Link from "next/link";

import heroImage from "../../../src/assets/hero-banner.jpg";

export default function StorefrontPage() {
  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="АН-30, на главную">
          <span className="brand-mark">АН-30</span>
          <span className="brand-copy">Автозапчасти</span>
        </Link>
        <nav aria-label="Основная навигация">
          <Link href="/catalog">Каталог</Link>
          <Link href="/delivery">Доставка</Link>
          <Link href="/contacts">Контакты</Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Магазин в Чернышевске</p>
          <h1>Нужная запчасть без лишней переписки</h1>
          <p className="lead">Каталог заполняется из 1С. Пока данных нет, мы честно не показываем вымышленные товары и остатки.</p>
          <div className="hero-actions">
            <Link className="primary-action" href="/catalog">Открыть каталог</Link>
            <Link className="secondary-action" href="/contacts">Связаться с магазином</Link>
          </div>
        </div>

        <aside className="availability" aria-labelledby="availability-title">
          <div className="hero-image">
            <Image
              src={heroImage}
              alt="Автомобиль и детали для подбора запчастей"
              fill
              priority
              sizes="(max-width: 800px) 100vw, 38vw"
            />
          </div>
          <h2 id="availability-title">Каталог готовится к импорту</h2>
          <p>Цены и наличие появятся после подтверждённой выгрузки из 1С.</p>
          <dl>
            <div><dt>Источник данных</dt><dd>1С</dd></div>
            <div><dt>Онлайн-оплата</dt><dd>Тестовый режим закрыт</dd></div>
          </dl>
        </aside>
      </section>

      <section className="service-section" aria-labelledby="service-title">
        <div>
          <p className="eyebrow">Помощь специалиста</p>
          <h2 id="service-title">Подбор по автомобилю и артикулу</h2>
        </div>
        <p>Сотрудник проверит совместимость и согласует условия получения. Заказ не будет оплачен без серверной проверки цены и остатка.</p>
      </section>
    </main>
  );
}
