import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Lock, User, Phone, Send, Loader2, Eye, EyeOff, ShieldCheck, Car, Clock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PhoneInput } from "@/components/ui/phone-input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.svg";

const loginSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(6, "Пароль минимум 6 символов"),
});

const signupSchema = z.object({
  fullName: z.string().min(2, "Имя минимум 2 символа"),
  email: z.string().email("Введите корректный email"),
  phone: z.string().optional().or(z.literal("")),
  password: z.string().min(6, "Пароль минимум 6 символов"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

const telegramCodeSchema = z.object({
  telegramUsername: z.string().min(1, "Введите ваш @username"),
  code: z.string().length(6, "Код должен быть 6 цифр"),
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignupFormData = z.infer<typeof signupSchema>;
type TelegramCodeFormData = z.infer<typeof telegramCodeSchema>;

// Telegram icon component
const TelegramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, signIn, signUp, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [authMethod, setAuthMethod] = useState<"telegram-code" | "email">("telegram-code");
  
  // Password visibility states
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirmPassword, setShowSignupConfirmPassword] = useState(false);


  useEffect(() => {
    if (authLoading) return; // Wait for role to load
    if (user) {
      if (isAdmin || isManager) {
        navigate("/admin");
      } else {
        navigate("/");
      }
    }
  }, [user, isAdmin, isManager, authLoading, navigate]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  const telegramCodeForm = useForm<TelegramCodeFormData>({
    resolver: zodResolver(telegramCodeSchema),
    defaultValues: { telegramUsername: "", code: "" },
  });

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const { error } = await signIn(data.email, data.password);
      if (error) {
        toast({
          variant: "destructive",
          title: "Ошибка входа",
          description: error.message === "Invalid login credentials" 
            ? "Неверный email или пароль" 
            : error.message,
        });
      } else {
        toast({ title: "Добро пожаловать!" });
        // Role-based redirect will happen via useEffect
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (data: SignupFormData) => {
    setIsLoading(true);
    try {
      const { error } = await signUp(data.email, data.password, data.fullName, data.phone);
      if (error) {
        toast({
          variant: "destructive",
          title: "Ошибка регистрации",
          description: error.message.includes("already registered") 
            ? "Пользователь с таким email уже существует" 
            : error.message,
        });
      } else {
        toast({ title: "Регистрация успешна!", description: "Добро пожаловать!" });
        // Role-based redirect will happen via useEffect
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyTelegramCode = async (data: TelegramCodeFormData) => {
    setIsLoading(true);
    try {
      const username = data.telegramUsername.replace(/^@/, '').trim();
      
      const response = await supabase.functions.invoke("verify-telegram-code", {
        body: { telegram_username: username, code: data.code },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);

      if (response.data?.redirect_url) {
        toast({ title: "Авторизация успешна!", description: "Перенаправляем..." });
        window.location.href = response.data.redirect_url;
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message || "Неверный код",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-background">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/20" />
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 via-accent/50 to-primary/50" />
      
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <Link to="/" className="inline-block">
              <img src={logo} alt="АН-30" className="h-36 md:h-44 mx-auto mb-4" />
            </Link>
            <h1 className="text-3xl font-display font-bold text-foreground">
              Вход в личный кабинет
            </h1>
            <p className="text-muted-foreground mt-2">
              Войдите для доступа к заказам и истории покупок
            </p>
          </div>

          {/* Features badges */}
          <div className="flex justify-center gap-3 mb-6">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-border/50">
              <Car className="h-4 w-4 text-primary" />
              <span>Автозапчасти</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-border/50">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <span>Безопасно</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-border/50">
              <Clock className="h-4 w-4 text-primary" />
              <span>Быстрый вход</span>
            </div>
          </div>

          <Card className="backdrop-blur-sm bg-card/95 border-border/50 shadow-2xl">
            <CardHeader className="pb-4">
              <div className="flex gap-2">
                <Button
                  variant={authMethod === "telegram-code" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAuthMethod("telegram-code")}
                  className={`flex-1 transition-all ${authMethod === "telegram-code" ? "shadow-lg" : ""}`}
                >
                  <TelegramIcon className="h-4 w-4 mr-1.5" />
                  Телеграм
                </Button>
                <Button
                  variant={authMethod === "email" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAuthMethod("email")}
                  className={`flex-1 transition-all ${authMethod === "email" ? "shadow-lg" : ""}`}
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  Email / Пароль
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              {authMethod === "telegram-code" && (
                <div className="space-y-6">
                  {/* Step 1: Get code from bot */}
                  <div className="bg-gradient-to-r from-[#0088cc]/10 to-[#0088cc]/5 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-[#0088cc] text-white rounded-full flex items-center justify-center font-bold shrink-0">
                        1
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium mb-1">Получите код в Telegram</h4>
                        <p className="text-sm text-muted-foreground mb-3">
                          Откройте бота — он пришлёт 6-значный код для входа
                        </p>
                        <Button
                          onClick={() => window.open("https://t.me/an30pushbot?start=login", "_blank")}
                          className="w-full bg-[#0088cc] hover:bg-[#0077b5] text-white"
                        >
                          <TelegramIcon className="h-5 w-5 mr-2" />
                          Открыть бота АН-30
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Enter username and code */}
                  <div className="bg-secondary/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold shrink-0">
                        2
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium mb-3">Введите данные</h4>
                        <Form {...telegramCodeForm}>
                          <form onSubmit={telegramCodeForm.handleSubmit(handleVerifyTelegramCode)} className="space-y-3">
                            <FormField
                              control={telegramCodeForm.control}
                              name="telegramUsername"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Ваш Telegram (например @durov)</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <TelegramIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input 
                                        placeholder="@ваш_ник" 
                                        className="pl-10"
                                        {...field} 
                                      />
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={telegramCodeForm.control}
                              name="code"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Код из бота (6 цифр)</FormLabel>
                                  <FormControl>
                                    <Input 
                                      placeholder="123456" 
                                      className="text-center text-xl tracking-[0.5em] font-mono" 
                                      maxLength={6}
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      {...field}
                                      onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, '');
                                        field.onChange(val);
                                      }}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Button 
                              type="submit" 
                              className="w-full" 
                              disabled={isLoading || !telegramCodeForm.watch("telegramUsername") || !telegramCodeForm.watch("code")}
                            >
                              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Войти
                            </Button>
                          </form>
                        </Form>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-center text-muted-foreground">
                    Код действителен 5 минут. Получите новый, если истёк.
                  </p>
                </div>
              )}

              {authMethod === "email" && (
                <Tabs defaultValue="login" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="login">Вход</TabsTrigger>
                    <TabsTrigger value="signup">Регистрация</TabsTrigger>
                  </TabsList>

                  <TabsContent value="login">
                    <Form {...loginForm}>
                      <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                        <FormField
                          control={loginForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input type="email" placeholder="mail@example.com" className="pl-10" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={loginForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Пароль</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input 
                                    type={showLoginPassword ? "text" : "password"} 
                                    className="pl-10 pr-10" 
                                    {...field} 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full h-11" disabled={isLoading}>
                          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Войти
                        </Button>
                      </form>
                    </Form>
                  </TabsContent>

                  <TabsContent value="signup">
                    <Form {...signupForm}>
                      <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4">
                        <FormField
                          control={signupForm.control}
                          name="fullName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Имя</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input placeholder="Иван Иванов" className="pl-10" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signupForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input type="email" placeholder="mail@example.com" className="pl-10" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signupForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Телефон <span className="text-muted-foreground text-xs">(опционально)</span></FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                                  <PhoneInput 
                                    value={field.value || ""} 
                                    onChange={field.onChange}
                                    className="pl-10" 
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signupForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Пароль</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input 
                                    type={showSignupPassword ? "text" : "password"} 
                                    className="pl-10 pr-10" 
                                    {...field} 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowSignupPassword(!showSignupPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signupForm.control}
                          name="confirmPassword"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Подтвердите пароль</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input 
                                    type={showSignupConfirmPassword ? "text" : "password"} 
                                    className="pl-10 pr-10" 
                                    {...field} 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowSignupConfirmPassword(!showSignupConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {showSignupConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full h-11" disabled={isLoading}>
                          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Зарегистрироваться
                        </Button>
                      </form>
                    </Form>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>

          <div className="text-center mt-6">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
              ← Вернуться на главную
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
