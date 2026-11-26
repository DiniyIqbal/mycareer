import { Suspense } from "react";
import { CareersFooter, FooterShell } from "./careers-footer";

export default function CareersLayout({ children, params }: LayoutProps<"/careers/[org]">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex-1">{children}</div>
      {/* The org slug is URL data, so it streams behind Suspense (Cache Components). */}
      <Suspense fallback={<FooterShell />}>
        <CareersFooter params={params} />
      </Suspense>
    </div>
  );
}
