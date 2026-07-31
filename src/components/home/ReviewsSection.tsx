import { Star, Quote } from "lucide-react";

const reviews = [
  {
    name: "Алексей М.",
    rating: 5,
    text: "Заказывал колодки и фильтры на Land Cruiser. Всё привезли за 3 дня, качество отличное. Цены ниже чем у конкурентов!",
    date: "Февраль 2026",
    car: "Toyota LC 200",
  },
  {
    name: "Сергей К.",
    rating: 5,
    text: "Ребята помогли подобрать запчасти по VIN, сам бы не разобрался. Очень благодарен за консультацию и быструю доставку.",
    date: "Январь 2026",
    car: "Mitsubishi Pajero",
  },
  {
    name: "Олег В.",
    rating: 5,
    text: "Покупаю здесь уже 2 года. Ни разу не подвели — всегда оригинал или качественный аналог. Рекомендую!",
    date: "Март 2026",
    car: "Toyota Hilux",
  },
  {
    name: "Дмитрий Т.",
    rating: 4,
    text: "Хороший выбор масел и фильтров. Менеджер всегда на связи, помогает с подбором. Единственное — хотелось бы доставку побыстрее.",
    date: "Декабрь 2025",
    car: "Nissan Patrol",
  },
];

export function ReviewsSection() {
  return (
    <section className="mx-3 sm:mx-4 lg:mx-6 py-8 sm:py-12">
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
          Отзывы наших <span className="text-primary">клиентов</span>
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base mt-2">Нам доверяют автовладельцы Забайкалья</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {reviews.map((review, index) => (
          <div key={index} className="relative p-4 sm:p-5 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-shadow">
            <Quote className="absolute top-4 right-4 h-6 w-6 text-primary/10" />
            
            <div className="flex items-center gap-1 mb-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
                />
              ))}
            </div>

            <p className="text-foreground text-sm leading-relaxed mb-4">"{review.text}"</p>

            <div className="border-t border-border pt-3">
              <p className="font-semibold text-foreground text-sm">{review.name}</p>
              <p className="text-muted-foreground text-xs">{review.car} · {review.date}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
