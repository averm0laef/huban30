import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Banner {
  id: string;
  headline: string | null;
  subheadline: string | null;
  button_text: string | null;
  link_url: string | null;
  image_desktop_url: string | null;
  image_mobile_url: string | null;
}

const SLIDE_DURATION = 10000; // 10 seconds

export function BannersCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHovering = useRef(false);

  useEffect(() => {
    fetchBanners();
  }, []);

  // Progress animation and auto-scroll
  useEffect(() => {
    if (banners.length <= 1) return;

    const startProgress = () => {
      setProgress(0);
      
      if (progressRef.current) {
        clearInterval(progressRef.current);
      }
      if (autoPlayRef.current) {
        clearTimeout(autoPlayRef.current);
      }

      const step = 100 / (SLIDE_DURATION / 100); // Update every 100ms
      progressRef.current = setInterval(() => {
        if (!isHovering.current) {
          setProgress((prev) => {
            if (prev >= 100) {
              return prev;
            }
            return prev + step;
          });
        }
      }, 100);

      autoPlayRef.current = setTimeout(() => {
        if (!isHovering.current) {
          setCurrentIndex((prev) => (prev >= banners.length - 1 ? 0 : prev + 1));
        }
      }, SLIDE_DURATION);
    };

    startProgress();

    return () => {
      if (progressRef.current) {
        clearInterval(progressRef.current);
      }
      if (autoPlayRef.current) {
        clearTimeout(autoPlayRef.current);
      }
    };
  }, [banners.length, currentIndex]);

  const fetchBanners = async () => {
    try {
      const { data, error } = await supabase
        .from("banners")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setBanners(data || []);
    } catch (error) {
      console.error("Error fetching banners:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const goToSlide = useCallback((index: number) => {
    setCurrentIndex(index);
    setProgress(0);
  }, []);

  if (isLoading || banners.length === 0) {
    return null;
  }

  const currentBanner = banners[currentIndex];

  return (
    <section 
      className="relative overflow-hidden"
      onMouseEnter={() => { isHovering.current = true; }}
      onMouseLeave={() => { isHovering.current = false; }}
    >
      <div className="relative min-h-[500px] lg:min-h-[600px] flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 transition-opacity duration-500">
          {currentBanner.image_desktop_url ? (
            <img
              src={currentBanner.image_desktop_url}
              alt={currentBanner.headline || "Banner"}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-primary to-primary/70" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-foreground/80 via-foreground/60 to-transparent" />
        </div>

        {/* Content */}
        <div className="container relative z-10 py-16">
          <div className="max-w-2xl">
            {currentBanner.headline && (
              <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-background mb-4 transition-all duration-300">
                {currentBanner.headline}
              </h2>
            )}
            {currentBanner.subheadline && (
              <p className="text-lg text-background/80 mb-8 max-w-lg transition-all duration-300">
                {currentBanner.subheadline}
              </p>
            )}
            {currentBanner.button_text && currentBanner.link_url && (
              <Link to={currentBanner.link_url}>
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow">
                  {currentBanner.button_text}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Progress indicators */}
      {banners.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className="relative h-1 rounded-full overflow-hidden transition-all duration-300 bg-background/30"
              style={{ width: index === currentIndex ? '40px' : '12px' }}
              aria-label={`Слайд ${index + 1}`}
            >
              {index === currentIndex && (
                <div 
                  className="absolute inset-0 bg-background rounded-full transition-all duration-100 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              )}
              {index !== currentIndex && (
                <div className="absolute inset-0 bg-background/50 rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
