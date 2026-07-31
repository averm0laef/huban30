import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "Как оформить заказ?",
    answer: "Выберите нужные запчасти в каталоге, добавьте в корзину и оставьте заявку. Наш менеджер свяжется с вами для подтверждения заказа и уточнения деталей.",
  },
  {
    question: "Можно ли подобрать запчасти по VIN-номеру?",
    answer: "Да! Отправьте нам VIN-номер вашего автомобиля через форму на сайте или в чат — мы бесплатно подберём все необходимые детали и сообщим наличие и цену.",
  },
  {
    question: "Какие сроки доставки?",
    answer: "Запчасти в наличии доставляем в магазин в течение 1-3 дней. Запчасти на заказ — от 3 до 14 дней в зависимости от позиции и поставщика.",
  },
  {
    question: "Есть ли гарантия на запчасти?",
    answer: "Да, на все запчасти действует гарантия производителя. При обнаружении брака — замена или возврат средств без вопросов.",
  },
  {
    question: "Какие способы оплаты?",
    answer: "Оплата наличными или переводом при получении в магазине. Мы не берём предоплату — вы платите только после проверки товара.",
  },
  {
    question: "Работаете ли вы с юридическими лицами?",
    answer: "Да, мы работаем с организациями и ИП. Предоставляем полный комплект документов: счёт, накладную, счёт-фактуру.",
  },
];

export function FAQSection() {
  return (
    <section className="mx-3 sm:mx-4 lg:mx-6 py-8 sm:py-12">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-6 sm:mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
            Часто задаваемые <span className="text-primary">вопросы</span>
          </h2>
        </div>

        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`faq-${index}`}
              className="border border-border rounded-xl px-4 sm:px-5 bg-card shadow-sm data-[state=open]:shadow-md transition-shadow"
            >
              <AccordionTrigger className="text-sm sm:text-base font-semibold text-foreground hover:no-underline py-4">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
