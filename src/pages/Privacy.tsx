import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Eye, Lock, UserCheck, FileText, Building2, Database, Globe } from "lucide-react";

const Privacy = () => {
  return (
    <MainLayout>
      {/* Hero */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container">
          <h1 className="font-display text-4xl lg:text-5xl font-bold mb-4">
            Политика конфиденциальности
          </h1>
          <p className="text-primary-foreground/80 text-lg max-w-2xl">
            Политика в отношении обработки персональных данных в соответствии с Федеральным законом №152-ФЗ «О персональных данных»
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container max-w-4xl space-y-8">
          {/* Оператор */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">Оператор персональных данных</h2>
                  <div className="text-muted-foreground space-y-1.5 text-sm">
                    <p><strong className="text-foreground">Оператор:</strong> ИП Ермолаева Марина Юрьевна</p>
                    <p><strong className="text-foreground">Адрес:</strong> Забайкальский край, пгт Чернышевск</p>
                    <p><strong className="text-foreground">Телефон:</strong> <a href="tel:+79244742605" className="text-primary hover:underline">+7 (924) 474-26-05</a></p>
                    <p><strong className="text-foreground">Сайт:</strong> an30.lovable.app</p>
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
                      <span>Настоящая Политика конфиденциальности разработана в соответствии с Федеральным законом от 27.07.2006 №152-ФЗ «О персональных данных» и определяет порядок обработки и защиты персональных данных пользователей сайта.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Используя Сайт и/или предоставляя свои персональные данные, Пользователь выражает согласие на обработку персональных данных на условиях настоящей Политики.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Оператор обеспечивает защиту обрабатываемых персональных данных от несанкционированного доступа и разглашения в соответствии с требованиями законодательства РФ.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Какие данные собираем */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Eye className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">2. Перечень обрабатываемых данных</h2>
                  <p className="text-muted-foreground text-sm mb-4">Оператор может обрабатывать следующие персональные данные Пользователя:</p>
                  <ul className="space-y-2 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Фамилия, имя, отчество;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Номер телефона;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Адрес электронной почты;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Идентификатор Telegram;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Данные об автомобиле (VIN-номер, марка, модель, год выпуска) — для целей подбора запчастей;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Данные о посещении Сайта (IP-адрес, файлы cookie, сведения о браузере).</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Цели обработки */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <UserCheck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">3. Цели обработки персональных данных</h2>
                  <ul className="space-y-2 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Идентификация Пользователя для оформления заказа;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Подбор автомобильных запасных частей;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Обратная связь с Пользователем (уведомление о статусе заказа, ответы на обращения);</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Исполнение договора розничной купли-продажи;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Улучшение качества обслуживания и работы Сайта.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 4. Правовые основания */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Database className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">4. Правовые основания и сроки обработки</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Обработка персональных данных осуществляется на основании: согласия субъекта персональных данных; необходимости исполнения договора; требований законодательства РФ.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Персональные данные хранятся не дольше, чем этого требуют цели обработки, если иной срок не установлен законодательством.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Оператор не передаёт персональные данные третьим лицам, за исключением случаев, предусмотренных законодательством РФ.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 5. Защита данных */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">5. Меры по защите данных</h2>
                  <p className="text-muted-foreground text-sm">
                    Оператор принимает необходимые и достаточные организационные и технические меры для защиты персональных данных от неправомерного или случайного доступа, уничтожения, изменения, блокирования, копирования, распространения, а также от иных неправомерных действий третьих лиц. Передача данных осуществляется по защищённым каналам связи (HTTPS/TLS).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 6. Cookies */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Globe className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">6. Файлы cookie</h2>
                  <ul className="space-y-3 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Сайт использует файлы cookie для обеспечения корректной работы, авторизации пользователей и сбора статистики посещений.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Пользователь может отключить обработку cookie в настройках браузера, однако это может ограничить функциональность Сайта.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 7. Права пользователя */}
          <Card>
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold mb-4">7. Права субъекта персональных данных</h2>
                  <p className="text-muted-foreground text-sm mb-4">В соответствии с Федеральным законом №152-ФЗ Пользователь имеет право:</p>
                  <ul className="space-y-2 text-muted-foreground text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Получить информацию об обработке своих персональных данных;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Требовать уточнения, блокирования или уничтожения персональных данных;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Отозвать согласие на обработку персональных данных путём направления письменного уведомления Оператору;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <span>Обжаловать действия или бездействие Оператора в Роскомнадзор или в судебном порядке.</span>
                    </li>
                  </ul>
                  <p className="text-muted-foreground text-sm mt-4">
                    По всем вопросам обращайтесь по телефону <a href="tel:+79244742605" className="text-primary hover:underline">+7 (924) 474-26-05</a> или в мессенджерах.
                  </p>
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

export default Privacy;
