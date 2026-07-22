import { Suspense } from "react";
import LoginReturn from "@/features/sign-in/LoginReturn";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginReturn />
    </Suspense>
  );
}
