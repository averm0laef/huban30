import { Link } from "react-router-dom";
import { Phone, MapPin, Clock, MessageSquare, Send, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { useChat } from "@/contexts/ChatContext";
import logo from "@/assets/logo.svg";

// MAX icon
const MaxIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-11l-1.5 6h1.2l.6-2.4h1.4l.6 2.4h1.2L12 9h-2zm1 .9l.5 2.1h-1l.5-2.1zm3-.9v6h1.2v-2.1l1.5 2.1H18l-1.8-2.4L18 9h-1.3l-1.5 2.1V9H14z"/>
  </svg>
);

export function ContactSection() {
  const { openChat } = useChat();

  const contactCards = [
    {
      icon: Phone,
      title: "Телефон",
      content: (
        <a href="tel:+79244742605" className="text-primary hover:underline font-medium text-sm">
          +7 (924) 474-26-05
        </a>
      ),
    },
    {
      icon: MapPin,
      title: "Адрес магазина",
      content: (
        <p className="text-muted-foreground text-sm">
          Чернышевск,<br />ул. Куйбышева, 118А
        </p>
      ),
    },
    {
      icon: Clock,
      title: "Режим работы",
      content: (
        <p className="text-muted-foreground text-sm">
          Ежедневно<br />09:00 — 19:00
        </p>
      ),
    },
    {
      icon: MessageSquare,
      title: "Онлайн-чат",
      content: (
        <span className="text-primary font-medium inline-flex items-center gap-1 text-sm">
          Написать сейчас
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      ),
      onClick: openChat,
    },
    {
      icon: Send,
      title: "Telegram",
      content: (
        <a 
          href="https://t.me/an30_autoparts" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium text-sm"
        >
          @an30_autoparts
        </a>
      ),
    },
    {
      icon: MaxIcon,
      title: "MAX",
      content: (
        <a 
          href="https://max.ru" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium text-sm"
        >
          Написать в MAX
        </a>
      ),
    },
  ];

  return (
    <section className="py-12 sm:py-16 lg:py-20 relative overflow-hidden">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
      
      <div className="container px-4 sm:px-6 relative z-10">
        <ScrollReveal>
          <div className="text-center mb-8 sm:mb-12">
            <img src={logo} alt="АН-30" className="h-12 w-auto mx-auto mb-4 opacity-20" />
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold text-foreground mb-2">
              Свяжитесь с нами
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
              Приезжайте в магазин или свяжитесь удобным способом
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {contactCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <ScrollReveal key={index} delay={index * 80}>
                <div 
                  className={`backdrop-blur-md bg-card/70 border border-border/40 rounded-2xl p-4 sm:p-5 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30 ${card.onClick ? 'cursor-pointer group' : ''}`}
                  onClick={card.onClick}
                >
                  <div className={`w-10 h-10 rounded-xl bg-primary/10 backdrop-blur-sm flex items-center justify-center mb-3 ${card.onClick ? 'group-hover:bg-primary group-hover:text-primary-foreground transition-colors' : ''}`}>
                    <Icon className={`h-5 w-5 text-primary ${card.onClick ? 'group-hover:text-primary-foreground' : ''}`} />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1.5 text-sm">
                    {card.title}
                  </h3>
                  {card.content}
                </div>
              </ScrollReveal>
            );
          })}
        </div>

        <ScrollReveal delay={500}>
          <div className="text-center mt-8 sm:mt-12">
            <Link to="/contacts">
              <Button size="lg" className="px-8 w-full sm:w-auto rounded-xl shadow-lg shadow-primary/20">
                <Phone className="mr-2 h-4 w-4" />
                Все контакты
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
