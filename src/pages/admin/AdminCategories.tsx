import { useEffect, useState } from "react";
import { Plus, Edit, Trash2, FolderTree, Search, Loader2, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Category {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_enabled: boolean;
  sort_order: number;
  parent_id: string | null;
}

interface SearchImage {
  url: string;
  title: string;
  source: string;
  base64Preview?: string;
}

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: "", slug: "", is_enabled: true, image_url: "" });
  const { toast } = useToast();

  // Image search state
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageSearchResults, setImageSearchResults] = useState<SearchImage[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error("Error fetching categories:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        name: formData.name,
        slug: formData.slug,
        is_enabled: formData.is_enabled,
        image_url: formData.image_url || null,
      };

      if (editingCategory) {
        const { error } = await supabase
          .from("categories")
          .update(payload)
          .eq("id", editingCategory.id);
        if (error) throw error;
        toast({ title: "Категория обновлена" });
      } else {
        const { error } = await supabase
          .from("categories")
          .insert({ ...payload, sort_order: categories.length });
        if (error) throw error;
        toast({ title: "Категория создана" });
      }

      setIsDialogOpen(false);
      setEditingCategory(null);
      setFormData({ name: "", slug: "", is_enabled: true, image_url: "" });
      setImageSearchResults([]);
      fetchCategories();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка", description: error.message });
    }
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Удалить категорию?")) return;
    try {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
      setCategories(categories.filter(c => c.id !== id));
      toast({ title: "Категория удалена" });
    } catch (error) {
      console.error("Error deleting category:", error);
    }
  };

  const openEditDialog = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      slug: category.slug,
      is_enabled: category.is_enabled,
      image_url: category.image_url || "",
    });
    setImageSearchQuery(category.name);
    setImageSearchResults([]);
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingCategory(null);
    setFormData({ name: "", slug: "", is_enabled: true, image_url: "" });
    setImageSearchQuery("");
    setImageSearchResults([]);
    setIsDialogOpen(true);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[а-яё]/g, (char) => {
        const map: { [key: string]: string } = {
          а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
          з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
          п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
          ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
        };
        return map[char] || char;
      })
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  };

  const searchImages = async () => {
    const query = imageSearchQuery.trim() || formData.name.trim();
    if (!query) return;

    setIsSearchingImages(true);
    setImageSearchResults([]);

    try {
      const { data, error } = await supabase.functions.invoke("search-product-images", {
        body: { query, limit: 8 },
      });

      if (error) throw error;

      if (data?.images) {
        // Load base64 previews for each image
        const withPreviews = await Promise.all(
          data.images.map(async (img: SearchImage) => {
            try {
              const { data: proxyData } = await supabase.functions.invoke("search-product-images", {
                body: { proxy_url: img.url },
              });
              return { ...img, base64Preview: proxyData?.base64 || undefined };
            } catch {
              return img;
            }
          })
        );
        setImageSearchResults(withPreviews);
      }
    } catch (error) {
      console.error("Image search error:", error);
      toast({ variant: "destructive", title: "Ошибка поиска изображений" });
    } finally {
      setIsSearchingImages(false);
    }
  };

  const selectImage = (url: string) => {
    setFormData({ ...formData, image_url: url });
    toast({ title: "Фото выбрано" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Категории</h1>
          <p className="text-muted-foreground mt-1">Управление категориями товаров</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Добавить категорию
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingCategory ? "Редактировать категорию" : "Новая категория"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setFormData({ ...formData, name, slug: generateSlug(name) });
                    if (!imageSearchQuery) setImageSearchQuery(name);
                  }}
                  placeholder="Моторные масла"
                />
              </div>
              <div className="space-y-2">
                <Label>URL (slug)</Label>
                <Input
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  placeholder="motornye-masla"
                />
              </div>

              {/* Current image preview */}
              {formData.image_url && (
                <div className="space-y-2">
                  <Label>Текущее фото</Label>
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border">
                    <img
                      src={formData.image_url}
                      alt="Фото категории"
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => setFormData({ ...formData, image_url: "" })}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* Image URL manual input */}
              <div className="space-y-2">
                <Label>URL изображения</Label>
                <Input
                  value={formData.image_url}
                  onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                />
              </div>

              {/* Image search section */}
              <div className="space-y-3 border-t border-border pt-4">
                <Label className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Поиск фото в интернете
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={imageSearchQuery}
                    onChange={(e) => setImageSearchQuery(e.target.value)}
                    placeholder="Введите запрос для поиска..."
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchImages())}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={searchImages}
                    disabled={isSearchingImages}
                  >
                    {isSearchingImages ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {isSearchingImages && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Поиск изображений...
                  </div>
                )}

                {imageSearchResults.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {imageSearchResults.map((img, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => selectImage(img.url)}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                          formData.image_url === img.url
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <img
                          src={img.base64Preview || img.url}
                          alt={img.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        {formData.image_url === img.url && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">✓</div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Label>Активна</Label>
                <Switch
                  checked={formData.is_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_enabled: checked })}
                />
              </div>
              <Button onClick={handleSave} className="w-full">
                {editingCategory ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : categories.length === 0 ? (
            <div className="text-center py-12">
              <FolderTree className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">Категории не найдены</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Фото</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      {category.image_url ? (
                        <img
                          src={category.image_url}
                          alt={category.name}
                          className="w-10 h-10 rounded-lg object-cover border border-border"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="text-muted-foreground">/{category.slug}</TableCell>
                    <TableCell>
                      <Badge variant={category.is_enabled ? "default" : "secondary"}>
                        {category.is_enabled ? "Активна" : "Скрыта"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(category)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteCategory(category.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}