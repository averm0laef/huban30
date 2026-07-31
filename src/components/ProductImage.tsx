import { useState, forwardRef } from "react";

interface ProductImageProps {
  src: string;
  alt: string;
  className?: string;
  watermarkSize?: "sm" | "md";
}

export const ProductImage = forwardRef<HTMLImageElement, ProductImageProps>(
  ({ src, alt, className = "" }, ref) => {
    const [imgSrc, setImgSrc] = useState(src);
    const [hasError, setHasError] = useState(false);

    const handleError = () => {
      if (!hasError) {
        setHasError(true);
        setImgSrc("/placeholder.svg");
      }
    };

    // Reset when src changes
    if (src !== imgSrc && !hasError) {
      setImgSrc(src);
    }
    if (src !== imgSrc && hasError && src !== "/placeholder.svg") {
      setHasError(false);
      setImgSrc(src);
    }

    return (
      <img
        ref={ref}
        src={imgSrc}
        alt={alt}
        className={className}
        onError={handleError}
        loading="lazy"
      />
    );
  }
);

ProductImage.displayName = "ProductImage";
