import { MainLayout } from "@/components/layout/MainLayout";
import { HeroSection } from "@/components/home/HeroSection";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { ExpertHelpBanner } from "@/components/home/ExpertHelpBanner";
import { ProductsShowcase } from "@/components/home/ProductsShowcase";
import { WhyUsSection } from "@/components/home/WhyUsSection";
import { VKSection } from "@/components/home/VKSection";
import { ContactSection } from "@/components/home/ContactSection";
import { RecentlyViewedSection } from "@/components/home/RecentlyViewedSection";
import { StatsSection } from "@/components/home/StatsSection";
import { ReviewsSection } from "@/components/home/ReviewsSection";
import { FAQSection } from "@/components/home/FAQSection";
import { VINSearchSection } from "@/components/home/VINSearchSection";

const Index = () => {
  return (
    <MainLayout>
      <HeroSection />
      <CategoriesSection />
      <StatsSection />
      <RecentlyViewedSection />
      <ProductsShowcase />
      <VINSearchSection />
      <ExpertHelpBanner />
      <ReviewsSection />
      <WhyUsSection />
      <FAQSection />
      <VKSection />
      <ContactSection />
    </MainLayout>
  );
};

export default Index;
