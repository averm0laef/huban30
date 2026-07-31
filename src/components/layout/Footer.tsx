import { Link } from "react-router-dom";
import { Phone, MapPin, Clock, Send, MessageCircle } from "lucide-react";
import logo from "@/assets/logo.svg";
import { usePublicStoreSettings } from "@/hooks/usePublicStoreSettings";

// VK icon component
const VKIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.785 16.241s.288-.032.436-.194c.136-.148.132-.427.132-.427s-.02-1.304.576-1.496c.588-.19 1.341 1.26 2.14 1.818.605.422 1.064.33 1.064.33l2.137-.03s1.117-.071.587-.964c-.043-.073-.308-.661-1.588-1.87-1.34-1.264-1.16-1.059.453-3.246.983-1.332 1.376-2.145 1.253-2.493-.117-.332-.84-.244-.84-.244l-2.406.015s-.178-.025-.31.056c-.13.079-.212.264-.212.264s-.382 1.03-.89 1.907c-1.07 1.85-1.499 1.948-1.674 1.832-.407-.267-.305-1.075-.305-1.648 0-1.793.267-2.54-.521-2.733-.262-.065-.454-.107-1.123-.114-.858-.01-1.585.003-1.996.208-.274.136-.485.44-.356.458.159.022.519.099.71.363.246.341.237 1.107.237 1.107s.142 2.11-.33 2.371c-.325.18-.77-.187-1.725-1.865-.489-.859-.859-1.81-.859-1.81s-.07-.176-.198-.272c-.154-.115-.37-.151-.37-.151l-2.286.015s-.343.01-.469.163c-.112.136-.009.418-.009.418s1.796 4.258 3.83 6.404c1.865 1.967 3.98 1.837 3.98 1.837h.96z"/>
  </svg>
);

// MAX icon component
const MaxIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-11l-1.5 6h1.2l.6-2.4h1.4l.6 2.4h1.2L12 9h-2zm1 .9l.5 2.1h-1l.5-2.1zm3-.9v6h1.2v-2.1l1.5 2.1H18l-1.8-2.4L18 9h-1.3l-1.5 2.1V9H14z"/>
  </svg>
);

import { forwardRef } from "react";

export const Footer = forwardRef<HTMLElement>(function Footer(_, ref) {
  const { settings } = usePublicStoreSettings();

  const phone = settings?.phone || "+7 (924) 474-26-05";
  const address = settings?.address || "Чернышевск, ул. Куйбышева, 118А";
  const telegramNick = settings?.telegram_nick || "@an30_autoparts";

  const socialVk = settings?.social_vk || "https://vk.com/an30_autoparts";
  const socialWhatsapp = settings?.social_whatsapp || "https://wa.me/79244742605";
  const socialTelegram = settings?.social_telegram || "https://t.me/an30_autoparts";
  const socialMax = settings?.social_max || "https://max.ru";

  return (
    <footer ref={ref} className="bg-foreground text-background">
      {/* Top accent line */}
      <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />
      
      <div className="container py-10 sm:py-12 lg:py-16 px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
          {/* Logo & About */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt="АН-30 Автозапчасти" className="h-20 w-auto brightness-0 invert" />
            </div>
            <p className="text-background/65 text-sm leading-relaxed">
              Автозапчасти для легковых и грузовых автомобилей. 
              Широкий ассортимент, низкие цены, быстрая доставка в магазин.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-2.5">
              {socialVk && (
                <a 
                  href={socialVk}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-background/10 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-all duration-200 hover:scale-105"
                  title="ВКонтакте"
                >
                  <VKIcon className="h-5 w-5" />
                </a>
              )}
              {socialWhatsapp && (
                <a 
                  href={socialWhatsapp}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-background/10 flex items-center justify-center hover:bg-success hover:text-primary-foreground transition-all duration-200 hover:scale-105"
                  title="WhatsApp"
                >
                  <MessageCircle className="h-5 w-5" />
                </a>
              )}
              {socialTelegram && (
                <a 
                  href={socialTelegram}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-background/10 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-all duration-200 hover:scale-105"
                  title="Telegram"
                >
                  <Send className="h-5 w-5" />
                </a>
              )}
              {socialMax && (
                <a 
                  href={socialMax}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-background/10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all duration-200 hover:scale-105"
                  title="MAX мессенджер"
                >
                  <MaxIcon className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="font-display font-bold text-base mb-4 text-background/90">Навигация</h4>
            <ul className="space-y-2.5">
              {[
                { to: "/", label: "Главная" },
                { to: "/catalog", label: "Каталог" },
                { to: "/about", label: "О нас" },
                { to: "/delivery", label: "Доставка в магазин" },
                { to: "/contacts", label: "Контакты" },
                { to: "/terms", label: "Публичная оферта" },
                { to: "/privacy", label: "Политика конфиденциальности" },
                { to: "/returns", label: "Возврат и обмен" },
                { to: "/careers", label: "Вакансии" },
              ].map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-background/60 hover:text-background transition-colors text-sm">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h4 className="font-display font-bold text-base mb-4 text-background/90">Контакты</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <Phone className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="hover:text-accent transition-colors text-sm">
                  {phone}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <span className="text-background/65 text-sm">{address}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <span className="text-background/65 text-sm">
                  Ежедневно: 09:00 — 19:00
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Send className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <a 
                  href={socialTelegram}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors text-sm"
                >
                  {telegramNick}
                </a>
              </li>
            </ul>
          </div>

          {/* Info */}
          <div>
            <h4 className="font-display font-bold text-base mb-4 text-background/90">Информация</h4>
            <p className="text-background/60 text-sm mb-5 leading-relaxed">
              Если нужной детали нет в наличии — привезём очень быстро в магазин!
            </p>
            <Link 
              to="/map" 
              target="_blank"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground rounded-xl hover:opacity-90 transition-opacity font-medium text-sm"
            >
              <MapPin className="h-4 w-4" />
              Как добраться
            </Link>
          </div>
        </div>

        <div className="border-t border-background/10 mt-10 pt-6 space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-background/40 text-sm">
              © {new Date().getFullYear()} ИП Ермолаева М.Ю. Магазин автозапчастей «АН-30». Все права защищены.
            </p>
            <div className="flex items-center gap-2">
              <img src={logo} alt="АН-30" className="h-6 w-auto brightness-0 invert opacity-30" />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-background/30 text-xs">
            <Link to="/terms" className="hover:text-background/60 transition-colors">Публичная оферта</Link>
            <span className="hidden sm:inline">·</span>
            <Link to="/privacy" className="hover:text-background/60 transition-colors">Политика конфиденциальности</Link>
            <span className="hidden sm:inline">·</span>
            <Link to="/returns" className="hover:text-background/60 transition-colors">Возврат и обмен</Link>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';
