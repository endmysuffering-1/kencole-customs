import { getSessionUser } from "@/lib/auth/session";
import { can, isStaff } from "@/lib/auth/rbac";
import { ROLE_NAMES } from "@/lib/auth/roles";
import { navCounts } from "@/lib/services/nav-counts";
import { AppFrame, type NavSection } from "./app-frame";

/**
 * The signed-in frame, DockDrop style: an ocean sidebar grouped into sections,
 * a white top bar with the page title and search, and a tab bar on phones.
 * What appears depends on what the person's role may do.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // Every page in the app checks its own access; signed out, it redirects.
  if (!user) return <>{children}</>;

  const counts = await navCounts(user);
  const staff = isStaff(user.role);
  const sections: NavSection[] = [];

  if (!staff && can(user.role, "shipment:read:own")) {
    sections.push({
      title: "Main",
      items: [
        { href: "/dashboard", label: "Home", icon: "home" },
        { href: "/shipments", label: "Shipments", icon: "box", badge: counts.shipments || undefined },
        ...(can(user.role, "shipment:create") ? [{ href: "/shipments/new", label: "Clear a shipment", icon: "plus" as const }] : []),
        { href: "/calculator", label: "Calculator", icon: "calculator" },
      ],
    });
  }
  if (staff) {
    sections.push({
      title: "Work",
      items: [
        ...(can(user.role, "ops:queue") ? [{ href: "/ops", label: "Operations", icon: "queue" as const, badge: counts.ops || undefined }] : []),
        ...(can(user.role, "classification:approve") ? [{ href: "/broker", label: "Broker review", icon: "check" as const, badge: counts.broker || undefined }] : []),
        { href: "/calculator", label: "Calculator", icon: "calculator" },
      ],
    });
    const admin = [
      ...(can(user.role, "rates:read") ? [{ href: "/admin/rates", label: "Rates", icon: "percent" as const }] : []),
      ...(can(user.role, "users:manage") ? [{ href: "/admin/users", label: "Users", icon: "users" as const }] : []),
    ];
    if (admin.length) sections.push({ title: "Admin", items: admin });
  }

  const initials = user.fullName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <AppFrame
      sections={sections}
      user={{ name: user.fullName, initials, role: ROLE_NAMES[user.role] }}
      canCreate={!staff && can(user.role, "shipment:create")}
    >
      {children}
    </AppFrame>
  );
}
