import { Square } from "react-chessboard/dist/chessboard/types";

export type OverlayKind = "danger" | "defended" | "promotion";

export interface BoardOverlays {
    highlights: Partial<Record<Square, OverlayKind>>;
    tag?: {
        square: Square;
        label: string;
    };
    flipped?: boolean;
}
