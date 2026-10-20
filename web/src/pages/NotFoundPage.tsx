import { Link } from "react-router";

import { Empty } from "../components/ui";

export function NotFoundPage() {
  return (
    <Empty>
      페이지가 없습니다. <Link className="underline" to="/devices">기기 목록으로</Link>
    </Empty>
  );
}
