import { MainLayout } from "@/components/layout/MainLayout";
import { MapPin, Phone, Clock, ExternalLink, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { usePublicStoreSettings } from "@/hooks/usePublicStoreSettings";

const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const dayNames: Record<string, string> = {
  monday: "Пн", tuesday: "Вт", wednesday: "Ср", thursday: "Чт",
  friday: "Пт", saturday: "Сб", sunday: "Вс",
};

const Map = () => {
  const { settings, isLoading } = usePublicStoreSettings();

  const phone = settings?.phone || "+7 (924) 474-26-05";
  const address = settings?.address || "пгт. Чернышевск, ул. Куйбышева 118А";
  const title = settings?.title || "АН-30 Автозапчасти";
  const whatsappLink = settings?.social_whatsapp || "https://wa.me/79244742605";

  const formatHours = () => {
    if (!settings?.shop_hours) return null;
    const hours = settings.shop_hours as Record<string, { open: string; close: string } | null>;
    return dayOrder.map((day) => {
      const h = hours[day];
      return { day: dayNames[day], hours: h ? `${h.open} — ${h.close}` : "выходной" };
    });
  };

  const storeInfo = {
    name: title,
    address,
    phone,
    yandexMapLink: "https://yandex.ru/maps/org/an_30/207536410283/?ll=117.020509%2C52.524339&z=13",
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
        {/* Header */}
        <ScrollReveal>
          <div className="container py-6 md:py-8">
            <p className="text-sm text-muted-foreground mb-1">Компания</p>
            <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">Адрес магазина</h1>
          </div>
        </ScrollReveal>

        {/* Main content */}
        <div className="container pb-8 md:pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Store info panel */}
            <div className="lg:col-span-4 xl:col-span-3">
              <ScrollReveal delay={100} direction="left">
                <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-background shadow-lg sticky top-24">
                <CardContent className="p-5 md:p-6">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-md">
                      <MapPin className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-lg">{storeInfo.name}</h2>
                      <p className="text-sm text-muted-foreground">Забайкальский край</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                      <Navigation className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Адрес</p>
                        <p className="text-sm text-muted-foreground">{storeInfo.address}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                      <Phone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Телефон</p>
                        <a 
                          href={`tel:${storeInfo.phone.replace(/\D/g, '')}`}
                          className="text-sm text-primary hover:underline"
                        >
                          {storeInfo.phone}
                        </a>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                      <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Режим работы</p>
                        <p className="text-sm text-muted-foreground">Ежедневно: 09:00 — 19:00</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    <a
                      href={storeInfo.yandexMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button className="w-full shadow-md" size="lg">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Построить маршрут
                      </Button>
                    </a>
                    <a
                      href={whatsappLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button variant="outline" className="w-full" size="lg">
                        Написать в WhatsApp
                      </Button>
                    </a>
                  </div>
                </CardContent>
                </Card>
              </ScrollReveal>
            </div>

            {/* Map container with frame */}
            <div className="lg:col-span-8 xl:col-span-9">
              <ScrollReveal delay={200} direction="right">
              <Card className="overflow-hidden shadow-xl border-2 border-border/50">
                <div className="relative aspect-[4/3] md:aspect-[16/10] lg:aspect-auto lg:h-[600px]">
                  <iframe
                    src="https://yandex.ru/map-widget/v1/?ll=117.020509%2C52.524339&mode=search&ol=biz&oid=207536410283&z=17"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                    title="Карта магазина АН-30"
                  />
                </div>
              </Card>
              
              {/* Open in Yandex Maps link */}
              <div className="mt-4 flex justify-center">
                <a
                  href={storeInfo.yandexMapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <div className="w-5 h-5 rounded-full bg-destructive flex items-center justify-center">
                    <MapPin className="h-3 w-3 text-white" />
                  </div>
                  Открыть в Яндекс Картах
                </a>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default Map;
