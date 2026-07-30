import { permanentRedirect } from "next/navigation";

export default function LeaderboardPage() {
  permanentRedirect("/ranked#standings");
}
