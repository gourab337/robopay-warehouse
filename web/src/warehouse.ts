export type Point = { x: number; y: number }

export const GRID = { cols: 20, rows: 12, cell: 36 }

export const SHELVES: Record<string, Point> = {
  A1: { x: 3, y: 2 }, A2: { x: 7, y: 2 }, A3: { x: 11, y: 2 },
  B1: { x: 3, y: 6 }, B2: { x: 7, y: 6 }, B3: { x: 11, y: 6 },
}
export const PACK: Point = { x: 17, y: 9 }
export const DOCK: Point = { x: 1, y: 10 }

export type OrderSpec = { sku: string; shelf: string }
export type CarrySpec = { from: string; to: 'PACK' }
