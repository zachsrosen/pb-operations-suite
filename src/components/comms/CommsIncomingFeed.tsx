"use client";

interface IncomingMessage {
  id: string;
  from: string;
  fromEmail?: string;
  subject?: string;
  source: string;
  date: string;
}

interface Props {
  messages: IncomingMessage[];
  topSenders: Array<{ email: string; count: number }>;
}

function emailToName(email: string): string {
  const local = email.split("@")[0];
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

const SOURCE_DOTS: Record<string, string> = {
  gmail: "#ea4335",
  hubspot: "#ff7a59",
  chat: "#0f9d58",
};

export default function CommsIncomingFeed({ messages, topSenders }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
      {/* Incoming messages (last 15 min) */}
      <div className="rounded-xl bg-surface/50 border border-t-border/15 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-t-border/15">
          <h3 className="text-sm font-semibold text-foreground/80">
            Incoming (Last 15m)
          </h3>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 ring-1 ring-emerald-500/20">
            {messages.length} items
          </span>
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {messages.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted/40">
              No incoming items in the last 15 minutes.
            </div>
          ) : (
            <ul className="divide-y divide-t-border/10">
              {messages.map((m) => (
                <li key={m.id} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-surface-2/20 transition-colors">
                  <span
                    className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                    style={{ background: SOURCE_DOTS[m.source] || "#6b7280" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground/80 truncate">
                        {m.from?.split("<")[0]?.trim()?.replace(/["']/g, "") || emailToName(m.fromEmail || "")}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted/50 truncate">
                      {m.subject || "(no subject)"}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted/40 shrink-0 tabular-nums">
                    {timeAgo(m.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Top Senders (unread) */}
      <div className="rounded-xl bg-surface/50 border border-t-border/15 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-t-border/15">
          <h3 className="text-sm font-semibold text-foreground/80">
            Top Senders (Unread)
          </h3>
          <span className="text-[11px] text-muted/40">
            {topSenders.length} people
          </span>
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {topSenders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted/40">
              No unread messages from anyone.
            </div>
          ) : (
            <ul className="divide-y divide-t-border/10">
              {topSenders.map((s) => {
                const maxCount = topSenders[0]?.count || 1;
                const pct = Math.round((s.count / maxCount) * 100);
                return (
                  <li key={s.email} className="relative flex items-center gap-3 px-4 py-2.5">
                    {/* Background bar */}
                    <div
                      className="absolute inset-y-0 left-0 bg-cyan-500/5"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative text-xs text-foreground/70 truncate flex-1" title={s.email}>
                      {emailToName(s.email)}
                    </span>
                    <span className="relative text-sm font-bold text-cyan-400 tabular-nums">
                      {s.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
