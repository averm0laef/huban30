import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Car, Loader2, Copy, Check, RotateCcw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

export default function AdminVINLookup() {
  const [vin, setVin] = useState("");
  const [carDescription, setCarDescription] = useState("");
  const [partDescription, setPartDescription] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSearch = async () => {
    if (!vin.trim() && !carDescription.trim() && !partDescription.trim()) {
      toast({ title: "Заполните хотя бы одно поле", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("vin-lookup", {
        body: {
          vin: vin.trim(),
          carDescription: carDescription.trim(),
          partDescription: partDescription.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: "Ошибка", description: data.error, variant: "destructive" });
      } else {
        setResult(data.result);
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message || "Не удалось выполнить запрос", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    toast({ title: "Скопировано!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setVin("");
    setCarDescription("");
    setPartDescription("");
    setResult(null);
  };

  const quickExamples = [
    { car: "Toyota Camry 2019 2.5", part: "Колодки тормозные передние" },
    { car: "Hyundai Creta 2020 2.0", part: "Фильтр масляный" },
    { car: "Kia Rio 2018 1.6", part: "Свечи зажигания" },
    { car: "Lada Vesta 2021 1.6", part: "Ремень ГРМ" },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          ИИ-подбор артикулов
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Расшифровка VIN, подбор OEM-артикулов и аналогов от популярных производителей
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            Параметры поиска
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">VIN-номер</label>
            <Input
              placeholder="Например: JTDKN3DU5A0123456"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17))}
              className="font-mono h-11 rounded-xl"
              maxLength={17}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {vin.length > 0 && vin.length < 17
                ? `${vin.length}/17 символов`
                : vin.length === 17
                ? "✅ VIN полный"
                : "Необязательно — можно указать марку/модель вместо VIN"}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Марка / Модель / Год</label>
            <Input
              placeholder="Например: Toyota Camry 2019 2.5 бензин"
              value={carDescription}
              onChange={(e) => setCarDescription(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Какая деталь нужна? *</label>
            <Textarea
              placeholder="Например: колодки тормозные передние, фильтр масляный, свечи зажигания..."
              value={partDescription}
              onChange={(e) => setPartDescription(e.target.value)}
              className="rounded-xl min-h-[80px] resize-none"
            />
          </div>

          {/* Quick examples */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Быстрые примеры:</p>
            <div className="flex flex-wrap gap-2">
              {quickExamples.map((ex, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs rounded-lg h-7"
                  onClick={() => {
                    setCarDescription(ex.car);
                    setPartDescription(ex.part);
                  }}
                >
                  {ex.car.split(" ").slice(0, 2).join(" ")} → {ex.part}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleSearch}
              disabled={loading}
              className="flex-1 h-11 rounded-xl font-bold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ИИ подбирает артикулы...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Подобрать артикулы
                </>
              )}
            </Button>
            {(vin || carDescription || partDescription || result) && (
              <Button variant="outline" onClick={handleReset} className="h-11 rounded-xl">
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Результаты подбора</CardTitle>
            <Button variant="outline" size="sm" onClick={handleCopy} className="rounded-lg h-8">
              {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
              {copied ? "Скопировано" : "Копировать"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none
              prose-table:border prose-table:border-border prose-table:rounded-lg prose-table:overflow-hidden
              prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold
              prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:border-t prose-td:border-border
              prose-h3:text-base prose-h3:mt-6 prose-h3:mb-3
              prose-p:text-sm prose-li:text-sm
              prose-strong:text-foreground">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
