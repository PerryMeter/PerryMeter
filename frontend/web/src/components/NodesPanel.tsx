import type { LinkState, NodeState } from '../lib/contract';

type NodesPanelProps = {
  nodes: NodeState[] | null;
  links: LinkState[] | null;
  isFresh: boolean;
  className?: string;
};

const STANDARD_NODES = ['hub', 'left', 'right', 'radar'] as const;

function getNodeRole(id: string): string {
  switch (id) {
    case 'hub':
      return 'receiver';
    case 'left':
    case 'right':
      return 'sender';
    case 'radar':
      return 'inside presence';
    default:
      return '';
  }
}

export function NodesPanel({
  nodes,
  links,
  isFresh,
  className,
}: NodesPanelProps) {
  const hasBase = links?.some((l) => l.id === 'base') ?? false;

  return (
    <div
      className={`p-3.5 rounded-[10px] border border-line bg-surface flex flex-col shrink-0 transition-opacity duration-200 ${
        !isFresh ? 'opacity-40' : ''
      } ${className ?? ''}`}
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-line mb-1.5 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          NODES
        </span>
      </div>

      {nodes === null ? (
        <p className="text-faint text-xs py-2 font-mono">
          Node status not reported
        </p>
      ) : (
        <div className="space-y-1">
          {STANDARD_NODES.map((id) => {
            const role = getNodeRole(id);
            const reported = nodes.find((n) => n.id === id);

            if (!reported) {
              return (
                <div
                  key={id}
                  className="flex items-center justify-between py-0.5 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full border border-faint shrink-0" />
                    <span className="uppercase font-medium text-faint">
                      {id}
                    </span>
                    {role && <span className="text-faint text-[11px]">{role}</span>}
                  </div>
                  <div>
                    <span className="text-faint font-mono">not installed</span>
                  </div>
                </div>
              );
            }

            const matchingLink = links?.find((l) => l.id === id);

            return (
              <div
                key={id}
                className="flex items-center justify-between py-0.5 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      reported.online ? 'bg-accent' : 'bg-error'
                    }`}
                  />
                  <span className="uppercase font-medium text-text">
                    {id}
                  </span>
                  {role && <span className="text-muted text-[11px]">{role}</span>}
                </div>

                <div>
                  {!reported.online ? (
                    <span className="text-error font-mono">offline</span>
                  ) : (
                    <div className="flex items-center gap-2 text-muted tabular-nums text-[11px]">
                      {matchingLink?.rssi !== null &&
                        matchingLink?.rssi !== undefined && (
                          <span>{matchingLink.rssi} dBm</span>
                        )}
                      {matchingLink?.pps !== null &&
                        matchingLink?.pps !== undefined && (
                          <span>{matchingLink.pps}/s</span>
                        )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {nodes
            .filter((n) => !STANDARD_NODES.includes(n.id as (typeof STANDARD_NODES)[number]))
            .map((node) => {
              const role = getNodeRole(node.id);
              const matchingLink = links?.find((l) => l.id === node.id);

              return (
                <div
                  key={node.id}
                  className="flex items-center justify-between py-0.5 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        node.online ? 'bg-accent' : 'bg-error'
                      }`}
                    />
                    <span className="uppercase font-medium text-text">
                      {node.id}
                    </span>
                    {role && <span className="text-muted text-[11px]">{role}</span>}
                  </div>

                  <div>
                    {!node.online ? (
                      <span className="text-error font-mono">offline</span>
                    ) : (
                      <div className="flex items-center gap-2 text-muted tabular-nums text-[11px]">
                        {matchingLink?.rssi !== null &&
                          matchingLink?.rssi !== undefined && (
                            <span>{matchingLink.rssi} dBm</span>
                          )}
                        {matchingLink?.pps !== null &&
                          matchingLink?.pps !== undefined && (
                            <span>{matchingLink.pps}/s</span>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          {!hasBase && (
            <div className="pt-1.5 border-t border-line/40">
              <p className="text-[11px] text-faint font-mono">
                Bottom side: not monitored (expansion kit)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
