import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home, Search, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import sparkPlug from "@/assets/404-spark-plug.png";
import logo from "@/assets/logo.svg";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Logo */}
      <Link to="/" className="mb-8">
        <img src={logo} alt="АН30" className="h-32 sm:h-40 lg:h-48" />
      </Link>

      {/* Spark plug character */}
      <img
        src={sparkPlug}
        alt="Свечка ищет страницу"
        className="h-48 w-48 mb-6 drop-shadow-lg animate-bounce"
        style={{ animationDuration: "3s" }}
      />

      {/* Error code */}
      <h1 className="text-7xl font-black text-primary mb-2">404</h1>

      {/* Message */}
      <p className="text-xl font-semibold text-foreground mb-1">
        Деталь не найдена!
      </p>
      <p className="text-muted-foreground text-center max-w-md mb-8">
        Похоже, эта страница уехала на ТО. Попробуйте вернуться в каталог или на главную.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild variant="default" size="lg" className="gap-2">
          <Link to="/">
            <Home className="h-4 w-4" />
            На главную
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="gap-2">
          <Link to="/catalog">
            <Search className="h-4 w-4" />
            В каталог
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="gap-2"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
