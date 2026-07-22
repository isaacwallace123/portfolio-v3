import PageHead from "@/shared/ui/PageHead";
import RolesManager from "@/features/manage-roles/RolesManager";

export const metadata = { title: "Roles" };

export default function RolesPage() {
  return (
    <>
      <PageHead
        kicker="Access"
        title="Roles"
        sub="Create the roles your network needs and assign them on the Users page. The admin role is a protected system role."
      />
      <RolesManager />
    </>
  );
}
