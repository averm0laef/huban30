import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, ShoppingBag, AlertTriangle, CheckCircle, Scale, CreditCard, Undo2, Truck, Building2 } from "lucide-react";

const Terms = () => {
  return (
    <MainLayout>
      {/* Hero */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container">
          <h1 className="font-display text-4xl lg:text-5xl font-bold mb-4">
            Публичная оферта
          </h1>
          <p className="text-primary-foreground/80 text-lg max-w-2xl">
            Договор розничной купли-продажи товаров дистанционным способом
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container max-w-4xl space-y-8">
          {/* Реквизиты */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">Продавец</h2>
                  <div className="text-muted-foreground space-y-1.5 text-sm">
                    <p><strong className="text-foreground">Индивидуальный предприниматель:</strong> Ермолаева Марина Юрьевна</p>
                    <p><strong className="text-foreground">ОГРНИП:</strong> уточняется</p>
                    <p><strong className="text-foreground">ИНН:</strong> уточняется</p>
                    <p><strong className="text-foreground">Адрес:</strong> Забайкальский край, пгт Чернышевск</p>
                    <p><strong className="text-foreground">Торговое наименование:</strong> Магазин автозапчастей «АН-30»</p>
                    <p><strong className="text-foreground">Телефон:</strong> <a href="tel:+79244742605" className="text-primary hover:underline">+7 (924) 474-26-05</a></p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 1. Общие положения */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">1. Общие положения</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Настоящий документ является официальной публичной офертой ИП Ермолаевой М.Ю. (далее — «Продавец») в соответствии со ст. 435 и п. 2 ст. 437 Гражданского кодекса Российской Федерации.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Оферта адресована неопределённому кругу лиц и определяет условия розничной купли-продажи товаров, представленных на сайте an30.lovable.app (далее — «Сайт»).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Отношения между Продавцом и Покупателем регулируются Гражданским кодексом РФ, Законом РФ «О защите прав потребителей» от 07.02.1992 №2300-1, Правилами продажи товаров по договору розничной купли-продажи (Постановление Правительства РФ от 31.12.2020 №2463).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Акцептом оферты является оформление заказа любым доступным способом (через сайт, по телефону, через мессенджеры, при личном обращении).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Цены на сайте носят информационный характер и не являются публичной офертой. Окончательная стоимость товара уточняется при оформлении заказа.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Предмет договора */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">2. Предмет договора</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Продавец обязуется передать Покупателю товар (автомобильные запасные части и аксессуары), а Покупатель обязуется оплатить и принять товар.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Ассортимент товаров представлен на Сайте и в торговом зале магазина. Наличие и цена товара уточняются у Продавца.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Для корректного подбора запасных частей Покупатель предоставляет VIN-номер, марку, модель и год выпуска транспортного средства.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Порядок оформления заказа */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Scale className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">3. Порядок оформления и исполнения заказа</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Заказ оформляется по телефону, через мессенджеры (Telegram, WhatsApp), через чат на Сайте или при личном визите в магазин.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Срок исполнения заказа на товар, отсутствующий в наличии, составляет от 1 до 14 рабочих дней в зависимости от наличия у поставщика.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Продавец уведомляет Покупателя о поступлении товара по телефону или через мессенджер.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Товар хранится в магазине в течение 7 календарных дней с момента уведомления. По истечении этого срока Продавец вправе отменить заказ.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 4. Оплата */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">4. Оплата</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Оплата товара производится при получении в магазине.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Способы оплаты: наличный расчёт, безналичный перевод (СБП, перевод по реквизитам).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Для юридических лиц возможна оплата по выставленному счёту.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Товар, заказанный под конкретный автомобиль, может потребовать предоплату в размере до 100% стоимости.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 5. Доставка */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Truck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">5. Доставка</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Товар доставляется в магазин по адресу: Забайкальский край, пгт Чернышевск. Самовывоз из торгового зала.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Передача товара осуществляется лично Покупателю или его представителю при предъявлении документа, удостоверяющего личность.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>При получении товара Покупатель обязан проверить его комплектность, внешний вид и соответствие заказу.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 6. Возврат и обмен */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Undo2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">6. Возврат и обмен товара</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Возврат и обмен товара надлежащего качества осуществляется в соответствии со ст. 25 Закона РФ «О защите прав потребителей» в течение 14 дней, не считая дня покупки.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Товар надлежащего качества принимается к возврату при сохранении товарного вида, потребительских свойств, пломб, ярлыков и документов об оплате.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Автозапчасти, заказанные под конкретный автомобиль по VIN-номеру, обмену и возврату не подлежат, если они соответствуют заказу (Перечень непродовольственных товаров надлежащего качества, не подлежащих обмену, утв. Постановлением Правительства РФ от 31.12.2020 №2463).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Возврат товара ненадлежащего качества осуществляется в порядке, предусмотренном ст. 18–24 Закона РФ «О защите прав потребителей». Срок рассмотрения претензии — до 10 дней.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Покупатель несёт ответственность за правильность предоставленных данных о транспортном средстве. Товар, приобретённый по некорректным данным Покупателя, возврату не подлежит.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 7. Ответственность */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">7. Ответственность сторон</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 flex-shrink-0" />
                      <span>Стороны несут ответственность за неисполнение или ненадлежащее исполнение обязательств в соответствии с законодательством Российской Федерации.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 flex-shrink-0" />
                      <span>Продавец не несёт ответственности за ненадлежащее использование товара Покупателем и за ущерб, причинённый вследствие неправильной установки.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 flex-shrink-0" />
                      <span>Все споры разрешаются путём переговоров. При невозможности достижения соглашения спор передаётся на рассмотрение в суд по месту нахождения Продавца в соответствии с законодательством РФ.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 8. Гарантии */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">8. Гарантийные обязательства</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Гарантийный срок на товар устанавливается производителем и указывается в сопроводительной документации.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Гарантия не распространяется на повреждения, вызванные неправильной установкой, эксплуатацией с нарушением требований производителя, механическими повреждениями или воздействием внешних факторов.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Для реализации гарантийных прав необходимо предоставить документ, подтверждающий покупку (чек, квитанция).</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-center pt-4">
            Дата последнего обновления: {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </section>
    </MainLayout>
  );
};

export default Terms;
