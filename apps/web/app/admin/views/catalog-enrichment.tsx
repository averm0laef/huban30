"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Field, Input, MessageBar, MessageBarBody, Select, Spinner } from "@fluentui/react-components";
import { CatalogEnrichmentResponseSchema, type CatalogEnrichmentResponse } from "@an30/contracts";
import { api } from "../api";
import { formatDate, RequestError } from "../workspace-utils";
import styles from "./catalog-enrichment.module.css";

export function CatalogEnrichmentPanel() {
  const [open,setOpen]=useState(false);
  const [status,setStatus]=useState<{enabled:boolean;configured:boolean;dailyCreditLimit:number}|null>(null);
  const [article,setArticle]=useState("");
  const [brand,setBrand]=useState("");
  const [mode,setMode]=useState<"part"|"oe">("part");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const [result,setResult]=useState<CatalogEnrichmentResponse|null>(null);
  const submitting=useRef(false);
  useEffect(()=>{
    if(!open) return;
    let live=true;
    api<{enabled:boolean;configured:boolean;dailyCreditLimit:number}>("/catalog/enrichment/status")
      .then(value=>{if(live) setStatus(value);}).catch(reason=>{if(live) setError(reason);});
    return()=>{live=false;};
  },[open]);
  async function lookup() {
    if(submitting.current) return;
    submitting.current=true;setBusy(true);setError(null);setResult(null);
    try {
      const payload=await api<unknown>("/catalog/enrichment/match",{method:"POST",body:JSON.stringify({article:article.trim(),brand:brand.trim(),mode})});
      const parsed=CatalogEnrichmentResponseSchema.safeParse(payload);
      if(!parsed.success) throw new Error("Справочник вернул неполные данные. Повторите проверку позже.");
      setResult(parsed.data);
    } catch(reason) {setError(reason);} finally {submitting.current=false;setBusy(false);}
  }
  return <section className={styles.panel}>
    <div className={styles.header}>
      <div><h2>Сопоставление деталей</h2><p>Проверьте артикул и бренд по внешнему справочнику и найдите ту же позицию в каталоге 1С.</p></div>
      <Button aria-controls="catalog-enrichment" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open ? "Свернуть":"Открыть проверку"}</Button>
    </div>
    {open ? <div id="catalog-enrichment" className={styles.body}>
      <p className={styles.note}>Цены и остатки остаются из 1С. Результаты справочника не подтверждают совместимость с автомобилем и не создают замену автоматически.</p>
      {status && !status.enabled ? <MessageBar intent="info"><MessageBarBody>Справочник отключён. Для подключения администратору нужно настроить ключ на сервере. Каталог 1С доступен как обычно.</MessageBarBody></MessageBar>:null}
      {!status && !error ? <Spinner size="small" label="Проверяем доступность справочника"/>:null}
      <form className={styles.form} onSubmit={event=>{event.preventDefault();void lookup();}}>
        <Field label="Какой номер проверяем"><Select value={mode} onChange={event=>{setMode(event.target.value as "part"|"oe");setResult(null);}} disabled={busy}>
          <option value="part">Артикул производителя детали</option><option value="oe">Оригинальный номер автопроизводителя (OE)</option>
        </Select></Field>
        <Field label={mode === "part" ? "Артикул":"Оригинальный номер OE"} required><Input value={article} onChange={(_event,data)=>{setArticle(data.value);setResult(null);}} minLength={3} maxLength={80} required disabled={busy} placeholder={mode === "part" ? "Например, W 914/2":"Номер с оригинальной детали"}/></Field>
        <Field label={mode === "part" ? "Бренд детали":"Марка автомобиля"} required><Input value={brand} onChange={(_event,data)=>{setBrand(data.value);setResult(null);}} maxLength={200} required disabled={busy} placeholder={mode === "part" ? "Например, MANN-FILTER":"Например, BMW"}/></Field>
        <Button appearance="primary" type="submit" disabled={busy || !status?.enabled || article.trim().length<3 || !brand.trim()}>{busy ? "Проверяем…":"Найти совпадения"}</Button>
      </form>
      {error ? <RequestError error={error} onRetry={()=>{if(status?.enabled) void lookup();else {setError(null);setOpen(false);}}}/>:null}
      {result ? <div aria-live="polite" aria-busy={busy} className={styles.results}>
        <p>{result.message}</p>
        {result.checkedAt ? <small>Проверено {formatDate(result.checkedAt)}</small>:null}
        {result.candidates.map(candidate=><article key={`${candidate.brand}:${candidate.article}`} className={styles.candidate}>
          <div className={styles.candidateHeader}><strong>{candidate.brand} · {candidate.article}</strong><Badge appearance="tint" color={candidate.matchesRequestedIdentity ? "success":"warning"}>{candidate.matchesRequestedIdentity ? "Артикул и бренд совпали":mode === "oe" ? "Кандидат по OE":"Другой артикул или бренд"}</Badge></div>
          {candidate.name ? <p>{candidate.name}</p>:null}
          {candidate.localProducts.length ? <ul className={styles.products}>{candidate.localProducts.map(product=><li key={product.id}>
            <span><strong>В каталоге 1С:</strong> {product.name} · {product.sku}</span>
            {product.isActive ? <Link href={`/catalog/product/${product.id}`}>Открыть товар</Link>:<span>Скрыт с сайта</span>}
          </li>)}</ul>:<small>Пары с этим артикулом и брендом в каталоге 1С не найдено.</small>}
        </article>)}
      </div>:null}
    </div>:null}
  </section>;
}
