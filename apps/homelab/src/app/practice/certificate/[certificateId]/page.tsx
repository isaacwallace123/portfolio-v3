import type { Metadata } from "next";
import { CertificateVerify } from "@/features/academy";

export const metadata: Metadata = {
  title: "Verify certificate",
  description: "Verify a HomeOps certificate of completion.",
  robots: { index: false, follow: false },
};

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;
  return <CertificateVerify certificateId={certificateId} />;
}
