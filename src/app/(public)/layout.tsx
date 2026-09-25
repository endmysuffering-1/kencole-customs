import { PublicHeader } from "@/components/shell/public-header";
import { SiteFooter } from "@/components/site-footer";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      {children}
      <SiteFooter />
    </>
  );
}
