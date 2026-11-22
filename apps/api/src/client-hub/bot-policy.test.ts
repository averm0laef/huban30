import { describe, expect, it } from "vitest";
import { botDecision } from "./bot-policy.js";
const faq=[{title:"Доставка",keywords:["доставка","доставки"],answer:"Условия доставки уточняем перед заказом.",approved:true}];
describe("client hub bot policy",()=>{
  it("greets without promising stock",()=>{ expect(botDecision("/start",faq).handoff).toBe(false); });
  it("only answers a single approved FAQ",()=>{ expect(botDecision("Как работает доставка?",faq)).toEqual({body:faq[0]!.answer,handoff:false}); });
  it.each(["Есть колодки?","доставка и цена фильтра","доставка 1234","Хочу менеджера","Подойдет ли на Toyota?","Сколько стоит?","Проверьте VIN"])("hands product questions to the operator: %s",text=>{expect(botDecision(text,faq).handoff).toBe(true);});
  it("does not answer an unapproved rule or ambiguous FAQ",()=>{
    expect(botDecision("Доставка?",[{...faq[0]!,approved:false}]).handoff).toBe(true);
    expect(botDecision("Доставка?",[...faq,...faq]).handoff).toBe(true);
  });
  it("does not match fragments inside unrelated words",()=>{expect(botDecision("Недоставка",faq).handoff).toBe(true);});
});
