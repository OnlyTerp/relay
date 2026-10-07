// Relay integration for omp (oh-my-pi). Auto-loaded from ~/.omp/agent/extensions/.
// Reports prompts, questions (the `ask` tool), replies and idle state to the Relay hub.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export default function (pi: any) {
	const hub = (process.env.RELAY_HUB || "http://127.0.0.1:7777").replace(/\/$/, "");
	let token = process.env.RELAY_TOKEN || "";
	if (!token) try { token = fs.readFileSync(path.join(os.homedir(), ".relay", "token"), "utf8").trim(); } catch {}
	const sid = process.env.RELAY_SID || `omp-${process.pid}`;
	const host = process.env.RELAY_HOST_LABEL || os.hostname();
	const post = (ev: Record<string, unknown>) =>
		fetch(`${hub}/hook`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-relay-token": token },
			body: JSON.stringify({ sid, agent: "omp", cwd: process.cwd(), host, ...ev }),
			signal: AbortSignal.timeout(1500),
		}).catch(() => {});

	const lastText = (messages: any[]) => {
		for (let i = (messages || []).length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.role !== "assistant") continue;
			const c = m.content;
			const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
			if (t.trim()) return t.trim().slice(0, 4000);
		}
		return "";
	};

	pi.on("session_start", async () => { post({ kind: "start" }); });
	pi.on("input", async (e: any) => { if (e?.source !== "extension") post({ kind: "prompt", text: e?.text || "" }); });
	pi.on("agent_start", async () => { post({ kind: "working" }); });
	pi.on("tool_call", async (e: any) => {
		if (e?.toolName !== "ask") return;
		const qs = (e.input?.questions || []).map((q: any) => ({
			question: q.question, header: q.id || "", multiSelect: !!q.multi,
			options: (q.options || []).map((o: any) => ({ label: o.label, description: o.description || "" })),
		}));
		if (qs.length) post({ kind: "question", questions: qs });
	});
	pi.on("agent_end", async (e: any) => { if (!e?.willContinue) post({ kind: "stop", text: lastText(e?.messages) }); });
	pi.on("session_shutdown", async () => { post({ kind: "end" }); });
}
