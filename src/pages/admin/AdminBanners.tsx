import { useEffect, useState } from "react";
import { Plus, Edit, Trash2, Image as ImageIcon, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Banner {
  id: string;
  headline: string | null;
  subheadline: string | null;
  button_text: string | null;
  link_url: string | null;
  image_desktop_url: string | null;
  is_active: boolean;
  sort_order: number;
}

export default function AdminBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [formData, setFormData] = useState({
    headline: "",
    subheadline: "",
    button_text: "",
    link_url: "",
    image_desktop_url: "",
    is_active: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchBanners();
  }, []);

  const fetchBanners = async () => {
    try {
      const { data, error } = await supabase
        .from("banners")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setBanners(data || []);
    } catch (error) {
      console.error("Error fetching banners:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (editingBanner) {
        const { error } = await supabase
          .from("banners")
          .update(formData)
          .eq("id", editingBanner.id);

        if (error) throw error;
        toast({ title: "Баннер обновлён" });
      } else {
        const { error } = await supabase
          .from("banners")
          .insert({
            ...formData,
            sort_order: banners.length,
          });

        if (error) throw error;
        toast({ title: "Баннер создан" });
      }

      setIsDialogOpen(false);
      setEditingBanner(null);
      resetForm();
      fetchBanners();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message,
      });
    }
  };

  const deleteBanner = async (id: string) => {
    if (!confirm("Удалить баннер?")) return;

    try {
      const { error } = await supabase
        .from("banners")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setBanners(banners.filter(b => b.id !== id));
      toast({ title: "Баннер удалён" });
    } catch (error) {
      console.error("Error deleting banner:", error);
    }
  };

  const toggleActive = async (banner: Banner) => {
    try {
      const { error } = await supabase
        .from("banners")
        .update({ is_active: !banner.is_active })
        .eq("id", banner.id);

      if (error) throw error;

      setBanners(banners.map(b => 
        b.id === banner.id ? { ...b, is_active: !b.is_active } : b
      ));
    } catch (error) {
      console.error("Error updating banner:", error);
    }
  };

  const openEditDialog = (banner: Banner) => {
    setEditingBanner(banner);
    setFormData({
      headline: banner.headline || "",
      subheadline: banner.subheadline || "",
      button_text: banner.button_text || "",
      link_url: banner.link_url || "",
      image_desktop_url: banner.image_desktop_url || "",
      is_active: banner.is_active,
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      headline: "",
      subheadline: "",
      button_text: "",
      link_url: "",
      image_desktop_url: "",
      is_active: true,
    });
  };

  const openCreateDialog = () => {
    setEditingBanner(null);
    resetForm();
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Баннеры</h1>
          <p className="text-muted-foreground mt-1">
            Управление баннерами на главной странице
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Добавить баннер
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingBanner ? "Редактировать баннер" : "Новый баннер"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Заголовок</Label>
                <Input
                  value={formData.headline}
                  onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
                  placeholder="Автозапчасти для любых авто"
                />
              </div>
              <div className="space-y-2">
                <Label>Подзаголовок</Label>
                <Input
                  value={formData.subheadline}
                  onChange={(e) => setFormData({ ...formData, subheadline: e.target.value })}
                  placeholder="Доставка в магазин за 1-3 дня"
                />
              </div>
              <div className="space-y-2">
                <Label>Текст кнопки</Label>
                <Input
                  value={formData.button_text}
                  onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
                  placeholder="Перейти в каталог"
                />
              </div>
              <div className="space-y-2">
                <Label>Ссылка кнопки</Label>
                <Input
                  value={formData.link_url}
                  onChange={(e) => setFormData({ ...formData, link_url: e.target.value })}
                  placeholder="/catalog"
                />
              </div>
              <div className="space-y-2">
                <Label>URL изображения</Label>
                <Input
                  value={formData.image_desktop_url}
                  onChange={(e) => setFormData({ ...formData, image_desktop_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Активен</Label>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
              <Button onClick={handleSave} className="w-full">
                {editingBanner ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Загрузка...
        </div>
      ) : banners.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ImageIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground">Баннеры не найдены</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {banners.map((banner) => (
            <Card key={banner.id} className={!banner.is_active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                  
                  <div className="w-32 h-20 rounded-lg bg-secondary flex items-center justify-center overflow-hidden">
                    {banner.image_desktop_url ? (
                      <img 
                        src={banner.image_desktop_url} 
                        alt={banner.headline || "Banner"} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className="font-semibold">
                      {banner.headline || "Без заголовка"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {banner.subheadline || "Без подзаголовка"}
                    </p>
                    {banner.button_text && (
                      <Badge variant="outline" className="mt-2">
                        {banner.button_text} → {banner.link_url}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={banner.is_active}
                      onCheckedChange={() => toggleActive(banner)}
                    />
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => openEditDialog(banner)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => deleteBanner(banner.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
