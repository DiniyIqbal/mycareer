import { SettingsTabs } from "./settings-tabs";

export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return (
    <div>
      <SettingsTabs />
      {children}
    </div>
  );
}
