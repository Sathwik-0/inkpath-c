import { Suspense } from "react";
import { AuthForm } from "../AuthForm";

export const metadata = { title: "Sign up" };

export default function Page() {
  return <Suspense><AuthForm mode="signup" /></Suspense>;
}
