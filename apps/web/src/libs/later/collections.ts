export interface LaterCollection {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface CollectionNode extends LaterCollection {
  children: CollectionNode[];
  depth: number;
}

const byName = (a: LaterCollection, b: LaterCollection) => a.name.localeCompare(b.name);

/** Nested tree, siblings sorted by name. A parent that is missing makes a root. */
export const buildCollectionTree = (collections: LaterCollection[]): CollectionNode[] => {
  const nodes = new Map<string, CollectionNode>(
    [...collections].sort(byName).map((c) => [c.id, { ...c, children: [], depth: 0 }]),
  );
  const roots: CollectionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: CollectionNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
};

/** The tree flattened in display order, for menus and indented lists. */
export const flattenCollectionTree = (roots: CollectionNode[]): CollectionNode[] =>
  roots.flatMap((node) => [node, ...flattenCollectionTree(node.children)]);

/** A collection's id together with the ids of everything below it. */
export const collectionWithDescendants = (collections: LaterCollection[], id: string): string[] => {
  const children = new Map<string, string[]>();
  for (const c of collections) {
    if (c.parent_id) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c.id]);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    result.push(current);
    for (const child of children.get(current) ?? []) visit(child);
  };
  visit(id);
  return result;
};

/** Articles in a collection plus all of its sub-collections. */
export const subtreeCount = (
  node: CollectionNode,
  counts: Record<string, number | undefined>,
): number =>
  (counts[node.id] ?? 0) +
  node.children.reduce((sum, child) => sum + subtreeCount(child, counts), 0);
