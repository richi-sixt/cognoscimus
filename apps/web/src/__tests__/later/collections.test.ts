import { describe, expect, it } from 'vitest';
import {
  buildCollectionTree,
  collectionWithDescendants,
  flattenCollectionTree,
  type LaterCollection,
  subtreeCount,
} from '@/libs/later/collections';

const list: LaterCollection[] = [
  { id: 'b', name: 'Beta', parent_id: null },
  { id: 'a', name: 'Alpha', parent_id: null },
  { id: 'a2', name: 'Two', parent_id: 'a' },
  { id: 'a1', name: 'One', parent_id: 'a' },
  { id: 'a1x', name: 'Deep', parent_id: 'a1' },
  { id: 'orphan', name: 'Orphan', parent_id: 'gone' },
];

describe('collection tree', () => {
  const tree = buildCollectionTree(list);

  it('nests children, sorts siblings and sets depth', () => {
    expect(tree.map((n) => n.name)).toEqual(['Alpha', 'Beta', 'Orphan']);
    const alpha = tree[0]!;
    expect(alpha.children.map((n) => n.name)).toEqual(['One', 'Two']);
    expect(alpha.children[0]!.children[0]!.depth).toBe(2);
  });

  it('flattens in display order', () => {
    expect(flattenCollectionTree(tree).map((n) => n.id)).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
      'b',
      'orphan',
    ]);
  });

  it('collects a collection with everything below it', () => {
    expect(collectionWithDescendants(list, 'a').sort()).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect(collectionWithDescendants(list, 'b')).toEqual(['b']);
  });

  it('survives a loop in the data', () => {
    const loop = [
      { id: 'x', name: 'X', parent_id: 'y' },
      { id: 'y', name: 'Y', parent_id: 'x' },
    ];
    expect(collectionWithDescendants(loop, 'x').sort()).toEqual(['x', 'y']);
  });

  it('adds up counts over the subtree', () => {
    expect(subtreeCount(tree[0]!, { a: 1, a1: 2, a1x: 3, a2: 4 })).toBe(10);
  });
});
