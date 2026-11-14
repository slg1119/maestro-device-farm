import { t } from "../lib/i18n";
import { Link } from "react-router";

import { Empty } from "../components/ui";

export function NotFoundPage() {
  return (
    <Empty>
      {t("m_172c62d6f3")} <Link className="underline" to="/devices">{t("m_29abc95074")}</Link>
    </Empty>
  );
}
