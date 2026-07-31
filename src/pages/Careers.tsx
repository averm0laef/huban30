import { MainLayout } from "@/components/layout/MainLayout";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Clock, MapPin, Phone, Banknote, Users, Briefcase, CheckCircle2 } from "lucide-react";
import vacancyBanner from "@/assets/vacancy-banner.jpg";

const vacancies = [
  {
    title: "Продавец-консультант",
    type: "Полная занятость",
    schedule: "5/2, с 9:00 до 19:00",
    description: "Ищем ответственного и коммуникабельного продавца-консультанта в магазин автозапчастей. Опыт работы приветствуется, но не обязателен — мы всему научим!",
    requirements: [
      "Коммуникабельность и ответственность",
      "Желание развиваться в сфере автозапчастей",
      "Умение работать с клиентами",
      "Базовые навыки работы с компьютером",
    ],
    benefits: [
      "Достойная заработная плата",
      "Дружный коллектив",
      "Обучение за счёт компании",
      "Стабильная работа",
    ],
  },
];

export default function Careers() {
  return (
    <MainLayout>
      <div className="min-h-screen bg-background">

        <div className="container mx-auto px-4 py-8 max-w-4xl -mt-16 relative z-10">
          {/* Breadcrumbs */}
          <ScrollReveal>
            <Breadcrumb className="mb-6">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/">Главная</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Вакансии</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </ScrollReveal>

          {/* Title */}
          <ScrollReveal>
            <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-2">
              Вакансии
            </h1>
            <p className="text-muted-foreground text-lg mb-8">
              Присоединяйтесь к нашей команде! Мы ищем увлечённых людей, которые хотят расти вместе с нами.
            </p>
          </ScrollReveal>

          {/* Why us */}
          <ScrollReveal delay={100}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
              {[
                { icon: Banknote, text: "Достойная зарплата" },
                { icon: Users, text: "Дружный коллектив" },
                { icon: Clock, text: "Удобный график" },
                { icon: Briefcase, text: "Стабильность" },
              ].map((item) => (
                <Card key={item.text} className="bg-card/80 backdrop-blur border-border/50">
                  <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                    <item.icon className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium text-foreground">{item.text}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollReveal>

          {/* Vacancies list */}
          {vacancies.map((vacancy, idx) => (
            <ScrollReveal key={idx} delay={200}>
              <Card className="mb-6 overflow-hidden border-border/50 bg-card/80 backdrop-blur">
                <CardContent className="p-6 lg:p-8">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h2 className="text-2xl font-bold text-foreground">{vacancy.title}</h2>
                    <Badge variant="secondary">{vacancy.type}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-5">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-primary" />
                      {vacancy.schedule}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-primary" />
                      пгт. Чернышевск, ул. Куйбышева, 118А
                    </span>
                  </div>

                  <p className="text-foreground/90 mb-6">{vacancy.description}</p>

                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Требования:</h3>
                      <ul className="space-y-2">
                        {vacancy.requirements.map((req) => (
                          <li key={req} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Мы предлагаем:</h3>
                      <ul className="space-y-2">
                        {vacancy.benefits.map((ben) => (
                          <li key={ben} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {ben}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button asChild size="lg">
                      <a href="tel:+79244742605">
                        <Phone className="h-4 w-4" />
                        Позвонить: +7 (924) 474-26-05
                      </a>
                    </Button>
                    <Button variant="outline" size="lg" asChild>
                      <a href="https://wa.me/79244742605" target="_blank" rel="noopener noreferrer">
                        Написать в WhatsApp
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </ScrollReveal>
          ))}

          {/* CTA */}
          <ScrollReveal delay={300}>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6 text-center">
                <h3 className="text-lg font-semibold text-foreground mb-2">Не нашли подходящую вакансию?</h3>
                <p className="text-muted-foreground mb-4">
                  Отправьте нам своё резюме, и мы свяжемся с вами, когда появится подходящая позиция.
                </p>
                <Button variant="outline" asChild>
                  <a href="https://wa.me/79244742605?text=Здравствуйте!%20Хочу%20отправить%20резюме" target="_blank" rel="noopener noreferrer">
                    Отправить резюме
                  </a>
                </Button>
              </CardContent>
            </Card>
          </ScrollReveal>
        </div>
      </div>
    </MainLayout>
  );
}
