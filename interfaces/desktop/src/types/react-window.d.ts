declare module "react-window" {
  import type { ComponentType, CSSProperties, Component } from "react";

  export interface ListChildComponentProps<T = unknown> {
    index: number;
    style: CSSProperties;
    data: T;
    isScrolling?: boolean;
  }

  export interface FixedSizeListProps<T = unknown> {
    height: number;
    width: number | string;
    itemCount: number;
    itemSize: number;
    itemData?: T;
    className?: string;
    style?: CSSProperties;
    overscanCount?: number;
    initialScrollOffset?: number;
    direction?: "ltr" | "rtl";
    layout?: "horizontal" | "vertical";
    useIsScrolling?: boolean;
    onItemsRendered?: (props: {
      overscanStartIndex: number;
      overscanStopIndex: number;
      visibleStartIndex: number;
      visibleStopIndex: number;
    }) => void;
    onScroll?: (props: {
      scrollDirection: "forward" | "backward";
      scrollOffset: number;
      scrollUpdateWasRequested: boolean;
    }) => void;
    children: ComponentType<ListChildComponentProps<T>>;
  }

  export class FixedSizeList<T = unknown> extends Component<FixedSizeListProps<T>> {
    scrollTo(scrollOffset: number): void;
    scrollToItem(index: number, align?: "auto" | "smart" | "center" | "end" | "start"): void;
  }

  export interface VariableSizeListProps<T = unknown>
    extends Omit<FixedSizeListProps<T>, "itemSize"> {
    itemSize: (index: number) => number;
    estimatedItemSize?: number;
  }

  export class VariableSizeList<T = unknown> extends Component<VariableSizeListProps<T>> {
    resetAfterIndex(index: number, shouldForceUpdate?: boolean): void;
    scrollTo(scrollOffset: number): void;
    scrollToItem(index: number, align?: "auto" | "smart" | "center" | "end" | "start"): void;
  }
}
