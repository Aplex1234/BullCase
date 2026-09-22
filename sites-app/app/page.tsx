import { ResearchTerminal } from "../../frontend/components/ResearchTerminal";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { readCachedAnalysis } from "@/lib/server/analysis-cache";
import { buildOverviewSnapshot, markSnapshotFreshness } from "@/lib/server/analysis-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [cached, user] = await Promise.all([readCachedAnalysis("AAPL"), getChatGPTUser()]);
  const initialAnalysis = cached
    ? buildOverviewSnapshot(markSnapshotFreshness(cached.analysis, cached.isFresh ? "cached" : "stale"))
    : null;
  return <ResearchTerminal
    initialAnalysis={initialAnalysis}
    account={user ? { displayName: user.displayName, email: user.email } : null}
    signInPath={chatGPTSignInPath("/")}
    signOutPath={chatGPTSignOutPath("/")}
  />;
}
