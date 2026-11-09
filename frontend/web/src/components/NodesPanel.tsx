import type { LinkState, NodeState } from '../lib/contract';

type NodesPanelProps = {
  nodes: NodeState[] | null;
  links: LinkState[] | null;
  isFresh: boolean;
  onSelect?: (id: string) => void;
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

function NodeRow({
  id,
  node,
  link,
  onSelect,
}: {
  id: string;
  node: NodeState | null;
  link: LinkState | undefined;
  onSelect?: (id: string) => void;
}) {
  const role = getNodeRole(id);
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect ? () => onSelect(id) : undefined}
      className={`w-full flex items-center justify-between py-0.5 text-xs font-mono text-left ${
        onSelect ? 'rounded-[4px] hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text' : ''
      }`}
      aria-label={onSelect ? `${id} node, click for details` : undefined}
    >
      <div className="flex items-center gap-2">
        {node === null ? (
          <span className="w-2 h-2 rounded-full border border-faint shrink-0" />
        ) : node.online ? (
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full border border-muted shrink-0" />
        )}
        <span className={`uppercase font-medium ${node === null ? 'text-faint' : 'text-text'}`}>{id}</span>
        {role && <span className={`text-[11px] ${node === null ? 'text-faint' : 'text-muted'}`}>{role}</span>}
      </div>
      <div className="flex items-center gap-2 text-muted tabular-nums text-[11px]">
        {node === null ? (
          <span className="text-faint">not installed</span>
        ) : !node.online ? (
          <span>offline</span>
        ) : (
          <>
            {link?.rssi !== null && link?.rssi !== undefined && <span>{link.rssi} dBm</span>}
            {link?.pps !== null && link?.pps !== undefined && <span>{link.pps}/s</span>}
          </>
        )}
      </div>
    </Tag>
  );
}

export function NodesPanel({ nodes, links, isFresh, onSelect, className }: NodesPanelProps) {
  const hasBase = links?.some((l) => l.id === 'base') ?? false;

  return (
    <div
      className={`p-3.5 rounded-[10px] border border-line bg-surface flex flex-col shrink-0 transition-opacity duration-200 ${
        !isFresh ? 'opacity-40' : ''
      } ${className ?? ''}`}
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-line mb-1.5 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Nodes</span>
      </div>

      {nodes === null ? (
        <p className="text-faint text-xs py-2 font-mono">Node status not reported</p>
      ) : (
        <div className="space-y-1">
          {STANDARD_NODES.map((id) => (
            <NodeRow key={id} id={id} node={nodes.find((n) => n.id === id) ?? null} link={links?.find((l) => l.id === id)} onSelect={onSelect} />
          ))}
          {nodes
            .filter((n) => !STANDARD_NODES.includes(n.id as (typeof STANDARD_NODES)[number]))
            .map((node) => (
              <NodeRow key={node.id} id={node.id} node={node} link={links?.find((l) => l.id === node.id)} onSelect={onSelect} />
            ))}
          {!hasBase && (
            <div className="pt-1.5 border-t border-line/40">
              <p className="text-[11px] text-faint font-mono">Front: no Wi-Fi link, covered by the radar</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
