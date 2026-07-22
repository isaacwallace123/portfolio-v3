import Planned from "@/shared/ui/Planned";

export const metadata = { title: "AI" };

export default function AiPage() {
  return (
    <Planned
      kicker="Estate"
      title="AI"
      intro="A built-in assistant + model workbench, wired to the ailab stack — an Open WebUI-style chat that lives inside the control plane."
      bullets={[
        "Chat over the ailab LiteLLM gateway (multiple models)",
        "The lab-status-assistant, answering questions about the estate",
        "RAG over your notes, docs, and project catalog",
        "Prompt / agent library and saved conversations",
        "Token & cost usage per model",
        "Guardrails: which models, who can use them (by role)",
      ]}
    />
  );
}
