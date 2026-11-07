import type { LinkState, NodeState } from '../lib/contract';

type NodesPanelProps = {
  nodes: NodeState[] | null;
  links: LinkState[] | null;
  isFresh: boolean;
  className?: string;
};

const orderMap: Record<string, number> = {
  hub: 1,
  left: 2,
  right: 3,
  radar: 4,
};

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

  const sortedNodes = nodes
    ? [...nodes].sort((a, b) => {
        const rankA = orderMap[a.id] ?? 99;
        const rankB = orderMap[b.id] ?? 99;
        return rankA - rankB;
      })
    : null;

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

      {sortedNodes === null ? (
        <p className="text-faint text-xs py-2 font-mono">
          Node status not reported
        </p>
      ) : (
        <div className="space-y-1">
          {sortedNodes.map((node) => {
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
