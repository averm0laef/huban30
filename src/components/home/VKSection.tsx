import { ExternalLink, Users, MessageCircle, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { usePublicStoreSettings } from "@/hooks/usePublicStoreSettings";

// VK icon
const VKIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.785 16.241s.288-.032.436-.194c.136-.148.132-.427.132-.427s-.02-1.304.576-1.496c.588-.19 1.341 1.26 2.14 1.818.605.422 1.064.33 1.064.33l2.137-.03s1.117-.071.587-.964c-.043-.073-.308-.661-1.588-1.87-1.34-1.264-1.16-1.059.453-3.246.983-1.332 1.376-2.145 1.253-2.493-.117-.332-.84-.244-.84-.244l-2.406.015s-.178-.025-.31.056c-.13.079-.212.264-.212.264s-.382 1.03-.89 1.907c-1.07 1.85-1.499 1.948-1.674 1.832-.407-.267-.305-1.075-.305-1.648 0-1.793.267-2.54-.521-2.733-.262-.065-.454-.107-1.123-.114-.858-.01-1.585.003-1.996.208-.274.136-.485.44-.356.458.159.022.519.099.71.363.246.341.237 1.107.237 1.107s.142 2.11-.33 2.371c-.325.18-.77-.187-1.725-1.865-.489-.859-.859-1.81-.859-1.81s-.07-.176-.198-.272c-.154-.115-.37-.151-.37-.151l-2.286.015s-.343.01-.469.163c-.112.136-.009.418-.009.418s1.796 4.258 3.83 6.404c1.865 1.967 3.98 1.837 3.98 1.837h.96z" />
  </svg>
);

export function VKSection() {
  const { settings } = usePublicStoreSettings();
  const vkUrl = settings?.social_vk || "https://vk.com/magazinan30";

  // Extract group slug for embed
  const vkSlug = vkUrl.replace(/https?:\/\/(www\.)?vk\.com\//, "");

  return (
    <section className="py-12 sm:py-16 lg:py-20 relative overflow-hidden">
      {/* BG */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(var(--primary)/0.03)] to-background" />

      <div className="container px-4 sm:px-6 relative z-10">
        <ScrollReveal>
          <div className="text-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#0077FF]/10 border border-[#0077FF]/20 mb-4">
              <VKIcon className="w-4 h-4 text-[#0077FF]" />
              <span className="text-xs font-bold text-[#0077FF] uppercase tracking-wider">ВКонтакте</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold text-foreground mb-2">
              Мы в <span className="text-[#0077FF]">ВКонтакте</span>
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto">
              Подписывайтесь на нашу группу — акции, новинки и полезные советы
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-[1fr_320px] gap-6 items-start">

              {/* Left: info + CTA */}
              <div className="flex flex-col gap-5">
                {/* Stats cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: Users, label: "Подписчики", value: "Растём!" },
                    { icon: MessageCircle, label: "Посты", value: "Регулярно" },
                    { icon: ThumbsUp, label: "Отзывы", value: "Только +" },
                  ].map((stat, i) => (
                    <div key={i} className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-4 text-center">
                      <stat.icon className="h-5 w-5 text-[#0077FF] mx-auto mb-2" />
                      <p className="font-bold text-sm text-foreground">{stat.value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* What you'll find */}
                <div className="bg-card/70 backdrop-blur-sm border border-border/40 rounded-2xl p-5 space-y-3">
                  <h3 className="font-bold text-sm text-foreground">Что у нас в группе:</h3>
                  <ul className="space-y-2">
                    {[
                      "🔧 Новые поступления запчастей",
                      "💰 Акции и специальные предложения",
                      "📸 Фото и видео из магазина",
                      "💡 Полезные советы по обслуживанию авто",
                    ].map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{item}</li>
                    ))}
                  </ul>
                </div>

                {/* CTA */}
                <a href={vkUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button size="lg" className="w-full bg-[#0077FF] hover:bg-[#0066DD] text-white rounded-xl h-12 font-bold shadow-lg shadow-[#0077FF]/20 gap-2">
                    <VKIcon className="w-5 h-5" />
                    Подписаться на группу
                    <ExternalLink className="h-4 w-4 ml-1" />
                  </Button>
                </a>
              </div>

              {/* Right: VK group preview card */}
              <a href={vkUrl} target="_blank" rel="noopener noreferrer" className="block">
                <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow">
                  <div className="bg-[#0077FF] px-4 py-3 flex items-center gap-2">
                    <VKIcon className="w-5 h-5 text-white" />
                    <span className="text-white font-bold text-sm">Наша группа</span>
                  </div>
                  <div className="p-5 flex flex-col items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-[#0077FF]/10 flex items-center justify-center">
                      <VKIcon className="w-10 h-10 text-[#0077FF]" />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-foreground text-base">Магазин AN30</p>
                      <p className="text-xs text-muted-foreground mt-1">Автозапчасти · Сообщество</p>
                    </div>
                    <div className="w-full bg-[#0077FF] hover:bg-[#0066DD] text-white text-center py-2.5 rounded-xl font-bold text-sm transition-colors">
                      Перейти в группу
                    </div>
                    <p className="text-[11px] text-muted-foreground text-center">
                      Новости, акции и отзывы клиентов
                    </p>
                  </div>
                </div>
              </a>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
