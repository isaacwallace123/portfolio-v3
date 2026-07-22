import PageHead from "@/shared/ui/PageHead";
import UsersManager from "@/features/manage-users/UsersManager";

export const metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <>
      <PageHead
        kicker="Access"
        title="Users"
        sub="Everyone who has signed in across the network. Toggle any role on any account; admin is protected on your own."
      />
      <UsersManager />
    </>
  );
}
